/**
 * N-API async wrappers for moving items without replacing anything and for asking a
 * volume whether it tells names apart by letter case.
 *
 *   nativeRenameExclusive(from, to) → Promise<void>
 *     renamex_np(2) with RENAME_EXCL: fails with EEXIST instead of replacing an item
 *     that appeared at `to`. Volumes that don't support RENAME_EXCL (some network
 *     and FAT volumes) fall back to checking for `to` first, then rename(2).
 *
 *   nativeIsCaseSensitive(path) → Promise<boolean | null>
 *     pathconf(2) _PC_CASE_SENSITIVE for the volume holding `path`; null when the
 *     volume doesn't say.
 *
 * Both run on a libuv thread pool thread: network volumes can be slow to answer.
 */

#include <node_api.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "native_errors.h"

/* ── Argument helpers ────────────────────────────────────────────── */

/* Copies a JS string argument into a new heap buffer; NULL (with a pending JS
   exception) on failure. */
static char *copy_string_argument(napi_env env, napi_value value, const char *name) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    char message[96];
    snprintf(message, sizeof(message), "%s must be a string", name);
    napi_throw_type_error(env, NULL, message);
    return NULL;
  }
  char *buffer = (char *)malloc(length + 1);
  if (!buffer) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, value, buffer, length + 1, NULL);
  return buffer;
}

/* ── nativeRenameExclusive ───────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *from;
  char *to;
  int errnum;
} rename_work_t;

static void execute_rename(napi_env env, void *data) {
  (void)env;
  rename_work_t *w = (rename_work_t *)data;

  if (renamex_np(w->from, w->to, RENAME_EXCL) == 0) {
    w->errnum = 0;
    return;
  }
  if (errno != ENOTSUP) {
    w->errnum = errno;
    return;
  }

  /* The volume can't do an exclusive rename. Checking first leaves a tiny window,
     but still never replaces an item that was there before the move started. */
  struct stat existing;
  if (lstat(w->to, &existing) == 0) {
    w->errnum = EEXIST;
    return;
  }
  if (errno != ENOENT) {
    w->errnum = errno;
    return;
  }
  w->errnum = rename(w->from, w->to) == 0 ? 0 : errno;
}

static void complete_rename(napi_env env, napi_status status, void *data) {
  rename_work_t *w = (rename_work_t *)data;

  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(env, w->deferred,
                         native_errno_error(env, w->errnum, "rename", w->from, w->to));
  } else {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, w->deferred, undefined);
  }

  napi_delete_async_work(env, w->work);
  free(w->from);
  free(w->to);
  free(w);
}

static napi_value native_rename_exclusive(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    napi_throw_type_error(env, NULL, "nativeRenameExclusive requires 2 arguments: from, to");
    return NULL;
  }

  char *from = copy_string_argument(env, argv[0], "from");
  if (!from) {
    return NULL;
  }
  char *to = copy_string_argument(env, argv[1], "to");
  if (!to) {
    free(from);
    return NULL;
  }
  rename_work_t *w = (rename_work_t *)calloc(1, sizeof(rename_work_t));
  if (!w) {
    free(from);
    free(to);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->from = from;
  w->to = to;

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeRenameExclusive", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_rename, complete_rename, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* ── nativeIsCaseSensitive ───────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  long answer; /* 1 case-sensitive, 0 case-insensitive, -1 unknown */
  int errnum;
} case_work_t;

static void execute_case_sensitive(napi_env env, void *data) {
  (void)env;
  case_work_t *w = (case_work_t *)data;

  errno = 0;
  long answer = pathconf(w->path, _PC_CASE_SENSITIVE);
  if (answer >= 0) {
    w->answer = answer > 0 ? 1 : 0;
    return;
  }
  /* EINVAL: the volume doesn't answer this question. The caller decides another way. */
  w->answer = -1;
  w->errnum = errno == EINVAL ? 0 : errno;
}

static void complete_case_sensitive(napi_env env, napi_status status, void *data) {
  case_work_t *w = (case_work_t *)data;

  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(env, w->deferred,
                         native_errno_error(env, w->errnum, "pathconf", w->path, NULL));
  } else {
    napi_value result;
    if (w->answer < 0) {
      napi_get_null(env, &result);
    } else {
      napi_get_boolean(env, w->answer == 1, &result);
    }
    napi_resolve_deferred(env, w->deferred, result);
  }

  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w);
}

static napi_value native_is_case_sensitive(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "nativeIsCaseSensitive requires 1 argument: path");
    return NULL;
  }

  char *path = copy_string_argument(env, argv[0], "path");
  if (!path) {
    return NULL;
  }
  case_work_t *w = (case_work_t *)calloc(1, sizeof(case_work_t));
  if (!w) {
    free(path);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->path = path;

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeIsCaseSensitive", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_case_sensitive,
                         complete_case_sensitive, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* ── Registration ────────────────────────────────────────────────── */

napi_value register_rename(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeRenameExclusive", NAPI_AUTO_LENGTH,
                       native_rename_exclusive, NULL, &fn);
  napi_set_named_property(env, exports, "nativeRenameExclusive", fn);

  napi_create_function(env, "nativeIsCaseSensitive", NAPI_AUTO_LENGTH,
                       native_is_case_sensitive, NULL, &fn);
  napi_set_named_property(env, exports, "nativeIsCaseSensitive", fn);
  return exports;
}
