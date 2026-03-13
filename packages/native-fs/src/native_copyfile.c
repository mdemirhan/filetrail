/**
 * N-API async wrapper around macOS copyfile(3).
 *
 * Exposes a single function: nativeCopyFile(src, dst) → Promise<void>
 *
 * Uses COPYFILE_ALL (preserve stat, xattrs, ACLs) | COPYFILE_CLONE (attempt
 * CoW clone on APFS, fall back to full copy). The copy runs on a libuv thread
 * pool thread so the main thread is never blocked.
 */

#include <node_api.h>
#include <copyfile.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

  int rc = copyfile(w->source, w->destination, NULL,
                    COPYFILE_ALL | COPYFILE_CLONE);
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
    /* Build a Node.js-style error with a `code` property. */
    const char *code;
    switch (w->errnum) {
    case ENOENT:
      code = "ENOENT";
      break;
    case EACCES:
      code = "EACCES";
      break;
    case EPERM:
      code = "EPERM";
      break;
    case ENOSPC:
      code = "ENOSPC";
      break;
    case EISDIR:
      code = "EISDIR";
      break;
    case EEXIST:
      code = "EEXIST";
      break;
    case EXDEV:
      code = "EXDEV";
      break;
    default:
      code = "UNKNOWN";
      break;
    }

    char msg[512];
    snprintf(msg, sizeof(msg), "%s: copyfile '%s' -> '%s'", code, w->source,
             w->destination);

    napi_value err_msg;
    napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &err_msg);
    napi_value error;
    napi_create_error(env, NULL, err_msg, &error);

    /* Attach .code */
    napi_value code_val;
    napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_val);
    napi_set_named_property(env, error, "code", code_val);

    /* Attach .path (source) */
    napi_value path_val;
    napi_create_string_utf8(env, w->source, NAPI_AUTO_LENGTH, &path_val);
    napi_set_named_property(env, error, "path", path_val);

    /* Attach .dest */
    napi_value dest_val;
    napi_create_string_utf8(env, w->destination, NAPI_AUTO_LENGTH, &dest_val);
    napi_set_named_property(env, error, "dest", dest_val);

    /* Attach .errno */
    napi_value errno_val;
    napi_create_int32(env, w->errnum, &errno_val);
    napi_set_named_property(env, error, "errno", errno_val);

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

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeCopyFile", NAPI_AUTO_LENGTH,
                       native_copy_file, NULL, &fn);
  napi_set_named_property(env, exports, "nativeCopyFile", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
