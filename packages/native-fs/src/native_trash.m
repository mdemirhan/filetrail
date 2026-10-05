/**
 * N-API async wrapper for the Trash that tells where the item went.
 *
 *   nativeTrashItem(path) → Promise<string>
 *     Moves the item to the Trash of its disk, as Finder's Move to Trash does, and resolves
 *     with the path it has there: the Trash renames it when its name is taken there
 *     ("notes 2.txt"), so the path is the only way to find it again. Rejects with an Error
 *     carrying the Trash's own sentence as its message and, when it can be told, an errno
 *     `code` ("EACCES", "ENOENT", "ENOTSUP" for a disk without a Trash).
 *
 * Runs on a libuv thread pool thread: the Trash of a network disk can be slow.
 */

#include <errno.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#import <Foundation/Foundation.h>

#include "native_errors.h"

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  /* The item's path in the Trash. */
  char *result;
  /* On failure: the Trash's sentence, and the errno it stands for (0 when unknown). */
  char *message;
  int errnum;
} trash_work_t;

static char *copy_utf8(NSString *text) {
  const char *utf8 = text.UTF8String;
  return utf8 ? strdup(utf8) : NULL;
}

/* The errno an NSError from the Trash stands for: the POSIX error under it when there is
 * one, otherwise what its Cocoa code means; 0 when it can't be told. */
static int errno_of(NSError *error) {
  if ([error.domain isEqualToString:NSPOSIXErrorDomain]) {
    return (int)error.code;
  }
  NSError *underlying = error.userInfo[NSUnderlyingErrorKey];
  if (underlying && [underlying.domain isEqualToString:NSPOSIXErrorDomain]) {
    return (int)underlying.code;
  }
  if ([error.domain isEqualToString:NSCocoaErrorDomain]) {
    switch (error.code) {
      case NSFeatureUnsupportedError:
        return ENOTSUP;
      case NSFileNoSuchFileError:
      case NSFileReadNoSuchFileError:
        return ENOENT;
      case NSFileWriteNoPermissionError:
      case NSFileReadNoPermissionError:
        return EACCES;
      case NSFileWriteVolumeReadOnlyError:
        return EROFS;
      default:
        break;
    }
  }
  return 0;
}

static void execute_trash_item(napi_env env, void *data) {
  (void)env;
  trash_work_t *w = (trash_work_t *)data;
  @autoreleasepool {
    NSString *path = [NSString stringWithUTF8String:w->path];
    if (!path) {
      w->errnum = EINVAL;
      return;
    }
    NSURL *url = [NSURL fileURLWithPath:path];
    NSURL *resulting = nil;
    NSError *error = nil;
    if ([[NSFileManager defaultManager] trashItemAtURL:url
                                      resultingItemURL:&resulting
                                                 error:&error]) {
      w->result = resulting ? copy_utf8(resulting.path) : NULL;
      if (!w->result) {
        /* Moved, but where to wasn't said: nothing can find it again. */
        w->message = strdup("The Trash didn't say where the item went.");
        w->errnum = EIO;
      }
      return;
    }
    w->errnum = error ? errno_of(error) : 0;
    w->message = error ? copy_utf8(error.localizedDescription) : NULL;
    if (!w->message && w->errnum == 0) {
      w->errnum = EIO;
    }
  }
}

static void free_work(napi_env env, trash_work_t *w) {
  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w->result);
  free(w->message);
  free(w);
}

/* The Trash's own sentence when it gave one, otherwise Node's errno wording. */
static napi_value trash_error(napi_env env, trash_work_t *w) {
  if (!w->message) {
    return native_errno_error(env, w->errnum, "trash", w->path, NULL);
  }
  napi_value message;
  napi_value error;
  napi_create_string_utf8(env, w->message, NAPI_AUTO_LENGTH, &message);
  napi_create_error(env, NULL, message, &error);
  napi_value value;
  if (w->errnum != 0) {
    napi_create_string_utf8(env, native_errno_code(w->errnum), NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, error, "code", value);
    napi_create_int32(env, w->errnum, &value);
    napi_set_named_property(env, error, "errno", value);
  }
  napi_create_string_utf8(env, "trash", NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, error, "syscall", value);
  napi_create_string_utf8(env, w->path, NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, error, "path", value);
  return error;
}

static void complete_trash_item(napi_env env, napi_status status, void *data) {
  trash_work_t *w = (trash_work_t *)data;
  if (status != napi_ok) {
    napi_value error = native_errno_error(env, EIO, "trash", w->path, NULL);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->result) {
    napi_value result;
    napi_create_string_utf8(env, w->result, NAPI_AUTO_LENGTH, &result);
    napi_resolve_deferred(env, w->deferred, result);
  } else {
    napi_reject_deferred(env, w->deferred, trash_error(env, w));
  }
  free_work(env, w);
}

static napi_value native_trash_item(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "path is required");
    return NULL;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  char *path = (char *)malloc(length + 1);
  trash_work_t *w = (trash_work_t *)calloc(1, sizeof(trash_work_t));
  if (!path || !w) {
    free(path);
    free(w);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], path, length + 1, NULL);
  w->path = path;

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeTrashItem", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_trash_item, complete_trash_item, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_trash(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeTrashItem", NAPI_AUTO_LENGTH, native_trash_item, NULL, &fn);
  napi_set_named_property(env, exports, "nativeTrashItem", fn);
  return exports;
}
