/**
 * N-API async wrapper around macOS copyfile(3).
 *
 * Exposes nativeCopyFile(src, dst) → Promise<void>.
 *
 * Uses COPYFILE_ALL (preserve stat, xattrs, ACLs) | COPYFILE_CLONE (attempt
 * CoW clone on APFS, fall back to full copy) | COPYFILE_EXCL (never replace an
 * existing destination). The copy runs on a libuv thread pool thread so the
 * main thread is never blocked.
 */

#include <node_api.h>
#include <copyfile.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "native_errors.h"

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *source;
  char *destination;
  int errnum; /* 0 on success, errno on failure */
} copy_work_t;

/* ── Execute on libuv thread pool ────────────────────────────────── */

static void execute_copy(napi_env env, void *data) {
  (void)env;
  copy_work_t *w = (copy_work_t *)data;

  /* NOFOLLOW_SRC copies a symlink as a symlink instead of its target's data.
     Callers recreate symlinks themselves today; this keeps the addon safe if
     one is ever passed through.
     EXCL fails with EEXIST instead of writing over an item that appeared at the
     destination: callers always copy to a name they expect to be free. */
  int rc = copyfile(w->source, w->destination, NULL,
                    COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_NOFOLLOW_SRC |
                        COPYFILE_EXCL);
  w->errnum = (rc == 0) ? 0 : errno;
}

/* ── Completion callback on main thread ──────────────────────────── */

static void complete_copy(napi_env env, napi_status status, void *data) {
  copy_work_t *w = (copy_work_t *)data;

  if (status == napi_cancelled) {
    napi_value err_msg;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH,
                            &err_msg);
    napi_value error;
    napi_create_error(env, NULL, err_msg, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_value error =
        native_errno_error(env, w->errnum, "copyfile", w->source, w->destination);
    napi_reject_deferred(env, w->deferred, error);
  } else {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, w->deferred, undefined);
  }

  napi_delete_async_work(env, w->work);
  free(w->source);
  free(w->destination);
  free(w);
}

/* ── JS entry point: nativeCopyFile(src, dst) → Promise<void> ──── */

static napi_value native_copy_file(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (argc < 2) {
    napi_throw_type_error(env, NULL,
                          "nativeCopyFile requires 2 arguments: source, destination");
    return NULL;
  }

  /* Extract source string. */
  size_t src_len;
  napi_get_value_string_utf8(env, argv[0], NULL, 0, &src_len);
  char *source = (char *)malloc(src_len + 1);
  if (!source) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], source, src_len + 1, NULL);

  /* Extract destination string. */
  size_t dst_len;
  napi_get_value_string_utf8(env, argv[1], NULL, 0, &dst_len);
  char *destination = (char *)malloc(dst_len + 1);
  if (!destination) {
    free(source);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[1], destination, dst_len + 1, NULL);

  /* Allocate work struct. */
  copy_work_t *w = (copy_work_t *)calloc(1, sizeof(copy_work_t));
  if (!w) {
    free(source);
    free(destination);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->source = source;
  w->destination = destination;
  w->errnum = 0;

  /* Create promise. */
  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);

  /* Create and queue async work. */
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeCopyFile", NAPI_AUTO_LENGTH,
                          &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_copy, complete_copy,
                         w, &w->work);
  napi_queue_async_work(env, w->work);

  return promise;
}

/* ── Module initialization ───────────────────────────────────────── */

/* Defined in native_fileicon.m — registers nativeGetFileIcon on exports. */
extern napi_value register_file_icon(napi_env env, napi_value exports);

/* Defined in native_foldersize.c — registers nativeFolderSize/Cancel on exports. */
extern napi_value register_folder_size(napi_env env, napi_value exports);

/* Defined in native_rename.c — registers nativeRenameExclusive/nativeIsCaseSensitive. */
extern napi_value register_rename(napi_env env, napi_value exports);

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeCopyFile", NAPI_AUTO_LENGTH,
                       native_copy_file, NULL, &fn);
  napi_set_named_property(env, exports, "nativeCopyFile", fn);

  register_file_icon(env, exports);
  register_folder_size(env, exports);
  register_rename(env, exports);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
