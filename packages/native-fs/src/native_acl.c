/**
 * N-API async wrappers for an item's access control list (ACL), the permissions Finder's
 * Get Info shows beyond the owner, group and everyone. A symlink's own ACL is read and
 * written, never its target's.
 *
 *   nativeGetAcl(path) → Promise<string | null>
 *     The item's ACL as text (acl_to_text(3)), or null when it has none.
 *
 *   nativeSetAcl(path, acl: string | null) → Promise<void>
 *     Gives the item the ACL `acl` (text from nativeGetAcl), or none at all for null.
 *
 * A copy of ~/Documents carries its "group:everyone deny delete" entry, which keeps the
 * Trash from taking it: Undo takes the entry off an item it made, and puts it back once
 * the item is in the Trash.
 */

#include <node_api.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>

#include "native_errors.h"

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  char *acl_text; /* in: the ACL to set (NULL: none); out: the ACL read (NULL: none) */
  int errnum;
  const char *syscall;
} acl_work_t;

static char *copy_string(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    return NULL;
  }
  char *buffer = (char *)malloc(length + 1);
  if (buffer) {
    napi_get_value_string_utf8(env, value, buffer, length + 1, NULL);
  }
  return buffer;
}

static void free_work(napi_env env, acl_work_t *w) {
  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w->acl_text);
  free(w);
}

static void execute_get_acl(napi_env env, void *data) {
  (void)env;
  acl_work_t *w = (acl_work_t *)data;
  acl_t acl = acl_get_link_np(w->path, ACL_TYPE_EXTENDED);
  if (acl == NULL) {
    /* ENOENT from acl_get_link_np also means an item with no ACL: told apart by looking
       for the item itself. */
    int errnum = errno;
    struct stat item;
    if (errnum != ENOENT) {
      w->errnum = errnum;
      w->syscall = "acl_get_link_np";
    } else if (lstat(w->path, &item) != 0) {
      w->errnum = errno;
      w->syscall = "lstat";
    }
    return;
  }
  char *text = acl_to_text(acl, NULL);
  if (text == NULL) {
    w->errnum = errno;
    w->syscall = "acl_to_text";
  } else {
    w->acl_text = strdup(text);
    acl_free(text);
  }
  acl_free(acl);
}

static void complete_get_acl(napi_env env, napi_status status, void *data) {
  acl_work_t *w = (acl_work_t *)data;
  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(env, w->deferred,
                         native_errno_error(env, w->errnum, w->syscall, w->path, NULL));
  } else {
    napi_value result;
    if (w->acl_text == NULL) {
      napi_get_null(env, &result);
    } else {
      napi_create_string_utf8(env, w->acl_text, NAPI_AUTO_LENGTH, &result);
    }
    napi_resolve_deferred(env, w->deferred, result);
  }
  free_work(env, w);
}

static void execute_set_acl(napi_env env, void *data) {
  (void)env;
  acl_work_t *w = (acl_work_t *)data;
  acl_t acl = w->acl_text == NULL ? acl_init(0) : acl_from_text(w->acl_text);
  if (acl == NULL) {
    w->errnum = errno;
    w->syscall = w->acl_text == NULL ? "acl_init" : "acl_from_text";
    return;
  }
  if (acl_set_link_np(w->path, ACL_TYPE_EXTENDED, acl) != 0) {
    w->errnum = errno;
    w->syscall = "acl_set_link_np";
  }
  acl_free(acl);
}

static void complete_set_acl(napi_env env, napi_status status, void *data) {
  acl_work_t *w = (acl_work_t *)data;
  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(env, w->deferred,
                         native_errno_error(env, w->errnum, w->syscall, w->path, NULL));
  } else {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, w->deferred, undefined);
  }
  free_work(env, w);
}

static napi_value queue_acl_work(napi_env env, acl_work_t *w, const char *name,
                                 napi_async_execute_callback execute,
                                 napi_async_complete_callback complete) {
  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute, complete, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

static napi_value native_get_acl(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char *path = argc < 1 ? NULL : copy_string(env, argv[0]);
  if (!path) {
    napi_throw_type_error(env, NULL, "nativeGetAcl requires a path");
    return NULL;
  }
  acl_work_t *w = (acl_work_t *)calloc(1, sizeof(acl_work_t));
  if (!w) {
    free(path);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->path = path;
  return queue_acl_work(env, w, "nativeGetAcl", execute_get_acl, complete_get_acl);
}

static napi_value native_set_acl(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  char *path = argc < 2 ? NULL : copy_string(env, argv[0]);
  if (!path) {
    napi_throw_type_error(env, NULL, "nativeSetAcl requires 2 arguments: path, acl");
    return NULL;
  }
  napi_valuetype type;
  napi_typeof(env, argv[1], &type);
  char *acl_text = NULL;
  if (type == napi_string) {
    acl_text = copy_string(env, argv[1]);
  } else if (type != napi_null) {
    free(path);
    napi_throw_type_error(env, NULL, "acl must be a string or null");
    return NULL;
  }
  acl_work_t *w = (acl_work_t *)calloc(1, sizeof(acl_work_t));
  if (!w) {
    free(path);
    free(acl_text);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->path = path;
  w->acl_text = acl_text;
  return queue_acl_work(env, w, "nativeSetAcl", execute_set_acl, complete_set_acl);
}

napi_value register_acl(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeGetAcl", NAPI_AUTO_LENGTH, native_get_acl, NULL, &fn);
  napi_set_named_property(env, exports, "nativeGetAcl", fn);
  napi_create_function(env, "nativeSetAcl", NAPI_AUTO_LENGTH, native_set_acl, NULL, &fn);
  napi_set_named_property(env, exports, "nativeSetAcl", fn);
  return exports;
}
