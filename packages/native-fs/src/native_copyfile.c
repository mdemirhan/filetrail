/**
 * N-API async wrapper around macOS copyfile(3).
 *
 * Exposes nativeCopyFile(src, dst, stopFlag?) → Promise<void>, and
 * nativeCopyMetadata(src, dst) → Promise<void>, which copies a folder's own metadata
 * onto an existing folder.
 *
 * `stopFlag` is an Int32Array whose first element the caller sets to 1 to stop a copy
 * part way through a file: copyfile's progress callback checks it between chunks and
 * the copy fails with ECANCELED. Without it a large file can only be stopped once it
 * has been copied in full.
 *
 * Uses COPYFILE_ALL (preserve stat, xattrs, ACLs) | COPYFILE_CLONE (attempt
 * CoW clone on APFS, fall back to full copy) | COPYFILE_EXCL (never replace an
 * existing destination) | COPYFILE_DATA_SPARSE (keep the holes of sparse files). The copy runs on a libuv thread pool thread so the
 * main thread is never blocked.
 */

#include <node_api.h>
#include <copyfile.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/xattr.h>

#include "native_errors.h"

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *source;
  char *destination;
  /* 0 on success, errno on failure. Also set by copy_status when it ends the copy over a
     resource fork that couldn't be written. */
  int errnum;
  /* The caller's stop flag (an Int32Array's first element), kept alive by stop_ref;
     NULL when the copy can't be stopped part way. */
  int32_t *stop;
  napi_ref stop_ref;
} copy_work_t;

/* Whether the extended attribute copyfile is at is the resource fork. */
static bool at_resource_fork(copyfile_state_t state) {
  const char *name = NULL;
  return copyfile_state_get(state, COPYFILE_STATE_XATTRNAME, &name) == 0 && name != NULL &&
         strcmp(name, XATTR_RESOURCEFORK_NAME) == 0;
}

/* Called by copyfile(3) between chunks of data and between the parts of a file (data,
   extended attributes, ...): stops the copy once the caller has asked it to, but only
   while the data is being copied. copyfile removes the file it created when told to quit
   there; told to quit at the extended attributes, which it copies first (most files have
   com.apple.provenance), it leaves an empty file behind. A stop asked for then is seen
   at the first chunk of data.
   copyfile also calls it when a step fails (stage COPYFILE_ERR), and there CONTINUE means
   "try that again": a write that keeps failing (the disk is full, or was unplugged) would
   be retried forever. A failed data write ends the copy with its error instead; a failed
   extended attribute is skipped, as metadata the destination may not take (a disk that
   refuses com.apple.provenance). Except the resource fork: that is the file's content for
   old Mac files, and copyfile goes on as if it had been copied whole unless told to quit,
   so a move would then remove the original. The copy fails there as it does without a
   callback, with the write's own errno (quitting makes copyfile report ECANCELED), and
   leaves the file it made behind: callers remove a copy that failed. */
static int copy_status(int what, int stage, copyfile_state_t state, const char *src,
                       const char *dst, void *ctx) {
  (void)src;
  (void)dst;
  copy_work_t *w = (copy_work_t *)ctx;
  if (what == COPYFILE_COPY_DATA && __atomic_load_n(w->stop, __ATOMIC_RELAXED) != 0) {
    return COPYFILE_QUIT;
  }
  if (stage == COPYFILE_ERR) {
    if (what == COPYFILE_COPY_XATTR && !at_resource_fork(state)) {
      return COPYFILE_SKIP;
    }
    if (what == COPYFILE_COPY_XATTR) {
      w->errnum = errno != 0 ? errno : EIO;
    }
    return COPYFILE_QUIT;
  }
  return COPYFILE_CONTINUE;
}

/* ── Execute on libuv thread pool ────────────────────────────────── */

static void execute_copy(napi_env env, void *data) {
  (void)env;
  copy_work_t *w = (copy_work_t *)data;

  /* NOFOLLOW_SRC copies a symlink as a symlink instead of its target's data.
     Callers recreate symlinks themselves today; this keeps the addon safe if
     one is ever passed through.
     EXCL fails with EEXIST instead of writing over an item that appeared at the
     destination: callers always copy to a name they expect to be free.
     DATA_SPARSE keeps the holes of a sparse file (disk images, VM disks) instead of
     writing them out as zeros, which can fill the destination disk. */
  const copyfile_flags_t flags = COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_NOFOLLOW_SRC |
                                 COPYFILE_EXCL | COPYFILE_DATA_SPARSE;
  if (w->stop == NULL) {
    int rc = copyfile(w->source, w->destination, NULL, flags);
    w->errnum = (rc == 0) ? 0 : errno;
    return;
  }
  if (__atomic_load_n(w->stop, __ATOMIC_RELAXED) != 0) {
    w->errnum = ECANCELED;
    return;
  }
  copyfile_state_t state = copyfile_state_alloc();
  if (state == NULL) {
    w->errnum = ENOMEM;
    return;
  }
  copyfile_state_set(state, COPYFILE_STATE_STATUS_CB, (const void *)&copy_status);
  copyfile_state_set(state, COPYFILE_STATE_STATUS_CTX, (const void *)w);
  int rc = copyfile(w->source, w->destination, state, flags);
  int saved = errno;
  copyfile_state_free(state);
  if (rc == 0) {
    w->errnum = 0;
  } else if (__atomic_load_n(w->stop, __ATOMIC_RELAXED) != 0) {
    /* A copy told to quit reports ECANCELED, though some versions leave errno as
       it was: a stop asked for is a stop. */
    w->errnum = ECANCELED;
  } else if (w->errnum == 0) {
    /* Unless copy_status ended it over the resource fork and kept that write's errno. */
    w->errnum = saved;
  }
}

/* Copies only a folder's own metadata (mode, flags, dates, extended attributes such as
   Finder tags and custom-icon flags, ACLs) onto a folder that already exists. Its contents
   are copied item by item by the caller; COPYFILE_RECURSIVE is deliberately not used. */
static void execute_copy_metadata(napi_env env, void *data) {
  (void)env;
  copy_work_t *w = (copy_work_t *)data;
  int rc = copyfile(w->source, w->destination, NULL,
                    COPYFILE_METADATA | COPYFILE_NOFOLLOW_SRC);
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
  if (w->stop_ref != NULL) {
    napi_delete_reference(env, w->stop_ref);
  }
  free(w->source);
  free(w->destination);
  free(w);
}

/* ── JS entry points: nativeCopyFile / nativeCopyMetadata(src, dst) → Promise<void> ── */

static napi_value queue_copy_work(napi_env env, napi_callback_info info,
                                  const char *name, napi_async_execute_callback execute,
                                  int accepts_stop_flag);

static napi_value native_copy_file(napi_env env, napi_callback_info info) {
  return queue_copy_work(env, info, "nativeCopyFile", execute_copy, 1);
}

static napi_value native_copy_metadata(napi_env env, napi_callback_info info) {
  return queue_copy_work(env, info, "nativeCopyMetadata", execute_copy_metadata, 0);
}

static napi_value queue_copy_work(napi_env env, napi_callback_info info,
                                  const char *name, napi_async_execute_callback execute,
                                  int accepts_stop_flag) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (argc < 2) {
    char message[96];
    snprintf(message, sizeof(message), "%s requires 2 arguments: source, destination", name);
    napi_throw_type_error(env, NULL, message);
    return NULL;
  }

  /* Extract source string. */
  size_t src_len;
  size_t dst_len;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &src_len) != napi_ok ||
      napi_get_value_string_utf8(env, argv[1], NULL, 0, &dst_len) != napi_ok) {
    char message[96];
    snprintf(message, sizeof(message), "%s: source and destination must be strings", name);
    napi_throw_type_error(env, NULL, message);
    return NULL;
  }
  char *source = (char *)malloc(src_len + 1);
  if (!source) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], source, src_len + 1, NULL);

  /* Extract destination string. */
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

  /* The optional stop flag: an Int32Array, referenced until the copy completes so its
     memory stays where the copy thread reads it. */
  if (accepts_stop_flag && argc >= 3) {
    napi_valuetype type;
    napi_typeof(env, argv[2], &type);
    if (type != napi_undefined && type != napi_null) {
      bool is_typedarray = false;
      napi_is_typedarray(env, argv[2], &is_typedarray);
      napi_typedarray_type array_type;
      size_t length = 0;
      void *data = NULL;
      if (is_typedarray) {
        napi_get_typedarray_info(env, argv[2], &array_type, &length, &data, NULL, NULL);
      }
      if (!is_typedarray || array_type != napi_int32_array || length < 1 || data == NULL) {
        free(source);
        free(destination);
        free(w);
        napi_throw_type_error(env, NULL, "The stop flag must be an Int32Array of length 1 or more");
        return NULL;
      }
      w->stop = (int32_t *)data;
      napi_create_reference(env, argv[2], 1, &w->stop_ref);
    }
  }

  /* Create promise. */
  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);

  /* Create and queue async work. */
  napi_value resource_name;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute, complete_copy, w,
                         &w->work);
  napi_queue_async_work(env, w->work);

  return promise;
}

/* ── Module initialization ───────────────────────────────────────── */

/* Defined in native_fileicon.m — registers nativeGetFileIcon on exports. */
extern napi_value register_file_icon(napi_env env, napi_value exports);

/* Defined in native_thumbnail.m — registers nativeGetFileThumbnail on exports. */
extern napi_value register_file_thumbnail(napi_env env, napi_value exports);

/* Defined in native_foldersize.c — registers nativeFolderSize/Cancel on exports. */
extern napi_value register_folder_size(napi_env env, napi_value exports);

/* Defined in native_rename.c — registers nativeRenameExclusive/nativeIsCaseSensitive. */
extern napi_value register_rename(napi_env env, napi_value exports);

/* Defined in native_flags.c — registers nativeGetFlags/nativeSetFlags. */
extern napi_value register_flags(napi_env env, napi_value exports);

/* Defined in native_package.m — registers nativeIsPackage. */
extern napi_value register_package(napi_env env, napi_value exports);

/* Defined in native_datestaken.m — registers nativeDatesTaken. */
extern napi_value register_dates_taken(napi_env env, napi_value exports);

/* Defined in native_volumes.c — registers nativeListVolumes. */
extern napi_value register_volumes(napi_env env, napi_value exports);

/* Defined in native_trash.m — registers nativeTrashItem. */
extern napi_value register_trash(napi_env env, napi_value exports);

/* Defined in native_filedrag.m — registers nativeStartFileDrag. */
extern napi_value register_file_drag(napi_env env, napi_value exports);

/* Defined in native_acl.c — registers nativeGetAcl and nativeSetAcl. */
extern napi_value register_acl(napi_env env, napi_value exports);

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeCopyFile", NAPI_AUTO_LENGTH,
                       native_copy_file, NULL, &fn);
  napi_set_named_property(env, exports, "nativeCopyFile", fn);
  napi_create_function(env, "nativeCopyMetadata", NAPI_AUTO_LENGTH,
                       native_copy_metadata, NULL, &fn);
  napi_set_named_property(env, exports, "nativeCopyMetadata", fn);

  register_file_icon(env, exports);
  register_file_thumbnail(env, exports);
  register_folder_size(env, exports);
  register_rename(env, exports);
  register_flags(env, exports);
  register_package(env, exports);
  register_dates_taken(env, exports);
  register_volumes(env, exports);
  register_trash(env, exports);
  register_file_drag(env, exports);
  register_acl(env, exports);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
