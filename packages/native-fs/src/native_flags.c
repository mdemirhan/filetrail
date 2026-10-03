/**
 * N-API async wrappers for an item's BSD flags (st_flags), which Node's fs doesn't expose.
 * Finder's "Locked" checkbox is UF_IMMUTABLE: a locked item can't be renamed, moved,
 * changed or deleted until it is unlocked.
 *
 *   nativeGetFlags(path) → Promise<number>
 *     lstat(2) st_flags of the item itself (a symlink is not followed).
 *
 *   nativeSetFlags(path, flags) → Promise<void>
 *     lchflags(2): sets the item's flags (a symlink is not followed). Only the owner can
 *     change the user flags (UF_*); the system flags (SF_*) need root.
 *
 * Both run on a libuv thread pool thread: network volumes can be slow to answer.
 */

#include <node_api.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

#include "native_errors.h"

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  uint32_t flags; /* read by get, written by set */
  int set;        /* 1 for nativeSetFlags */
  int errnum;
} flags_work_t;

static void execute_flags(napi_env env, void *data) {
  (void)env;
  flags_work_t *w = (flags_work_t *)data;
  if (w->set) {
    w->errnum = lchflags(w->path, w->flags) == 0 ? 0 : errno;
    return;
  }
  struct stat info;
  if (lstat(w->path, &info) != 0) {
    w->errnum = errno;
    return;
  }
  w->flags = info.st_flags;
  w->errnum = 0;
}

static void complete_flags(napi_env env, napi_status status, void *data) {
  flags_work_t *w = (flags_work_t *)data;

  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(
        env, w->deferred,
        native_errno_error(env, w->errnum, w->set ? "lchflags" : "lstat", w->path, NULL));
  } else {
    napi_value result;
    if (w->set) {
      napi_get_undefined(env, &result);
    } else {
      napi_create_uint32(env, w->flags, &result);
    }
    napi_resolve_deferred(env, w->deferred, result);
  }

  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w);
}

static napi_value queue_flags_work(napi_env env, napi_callback_info info, int set) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  const char *name = set ? "nativeSetFlags" : "nativeGetFlags";
  if (argc < (size_t)(set ? 2 : 1)) {
    napi_throw_type_error(env, NULL,
                          set ? "nativeSetFlags requires 2 arguments: path, flags"
                              : "nativeGetFlags requires 1 argument: path");
    return NULL;
  }

  size_t length;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  uint32_t flags = 0;
  if (set && napi_get_value_uint32(env, argv[1], &flags) != napi_ok) {
    napi_throw_type_error(env, NULL, "flags must be a number");
    return NULL;
  }
  char *path = (char *)malloc(length + 1);
  if (!path) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], path, length + 1, NULL);

  flags_work_t *w = (flags_work_t *)calloc(1, sizeof(flags_work_t));
  if (!w) {
    free(path);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->path = path;
  w->flags = flags;
  w->set = set;

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_flags, complete_flags, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

static napi_value native_get_flags(napi_env env, napi_callback_info info) {
  return queue_flags_work(env, info, 0);
}

static napi_value native_set_flags(napi_env env, napi_callback_info info) {
  return queue_flags_work(env, info, 1);
}

napi_value register_flags(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeGetFlags", NAPI_AUTO_LENGTH, native_get_flags, NULL,
                       &fn);
  napi_set_named_property(env, exports, "nativeGetFlags", fn);

  napi_create_function(env, "nativeSetFlags", NAPI_AUTO_LENGTH, native_set_flags, NULL,
                       &fn);
  napi_set_named_property(env, exports, "nativeSetFlags", fn);
  return exports;
}
