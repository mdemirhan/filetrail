/**
 * N-API async wrapper around NSWorkspace iconForFile:.
 *
 * Exposes a single function: nativeGetFileIcon(path, size) → Promise<Buffer>
 *
 * Uses NSWorkspace to get the macOS file icon for any path, renders it as PNG
 * at the requested pixel size. The work runs on a libuv thread pool thread so
 * the main thread is never blocked.
 */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#import <AppKit/AppKit.h>

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  int size;
  void *png_data;    /* malloc'd PNG bytes on success */
  size_t png_length;
  int failed;        /* non-zero on error */
} icon_work_t;

/* ── Execute on libuv thread pool ────────────────────────────────── */

static void execute_get_icon(napi_env env, void *data) {
  (void)env;
  icon_work_t *work = (icon_work_t *)data;
  work->failed = 1;
  work->png_data = NULL;
  work->png_length = 0;

  @autoreleasepool {
    NSString *nsPath = [NSString stringWithUTF8String:work->path];
    if (!nsPath) {
      return;
    }
    NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:nsPath];
    if (!icon) {
      return;
    }

    NSSize targetSize = NSMakeSize(work->size, work->size);
    [icon setSize:targetSize];

    /* Render into a bitmap at the exact pixel dimensions requested. */
    NSBitmapImageRep *bitmapRep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL
                      pixelsWide:work->size
                      pixelsHigh:work->size
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSCalibratedRGBColorSpace
                     bytesPerRow:0
                    bitsPerPixel:0];
    if (!bitmapRep) {
      return;
    }
    bitmapRep.size = targetSize;

    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:
        [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmapRep]];
    [icon drawInRect:NSMakeRect(0, 0, work->size, work->size)
            fromRect:NSZeroRect
           operation:NSCompositingOperationSourceOver
            fraction:1.0];
    [NSGraphicsContext restoreGraphicsState];

    NSData *pngData = [bitmapRep representationUsingType:NSBitmapImageFileTypePNG
                                              properties:@{}];
    if (!pngData || [pngData length] == 0) {
      return;
    }

    work->png_length = [pngData length];
    work->png_data = malloc(work->png_length);
    if (!work->png_data) {
      work->png_length = 0;
      return;
    }
    memcpy(work->png_data, [pngData bytes], work->png_length);
    work->failed = 0;
  }
}

/* ── Resolve back on the main thread ─────────────────────────────── */

static void complete_get_icon(napi_env env, napi_status status, void *data) {
  icon_work_t *work = (icon_work_t *)data;

  if (status != napi_ok || work->failed) {
    /* Resolve with null (no icon available) rather than rejecting. */
    napi_value null_val;
    napi_get_null(env, &null_val);
    napi_resolve_deferred(env, work->deferred, null_val);
  } else {
    napi_value buffer;
    void *buf_data;
    napi_create_buffer_copy(env, work->png_length, work->png_data, &buf_data, &buffer);
    napi_resolve_deferred(env, work->deferred, buffer);
  }

  napi_delete_async_work(env, work->work);
  free(work->path);
  free(work->png_data);
  free(work);
}

/* ── JS entry point: nativeGetFileIcon(path, size) → Promise<Buffer|null> ── */

static napi_value js_get_file_icon(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (argc < 2) {
    napi_throw_error(env, NULL, "nativeGetFileIcon requires (path, size)");
    return NULL;
  }

  /* Extract path string. */
  size_t path_len;
  napi_get_value_string_utf8(env, argv[0], NULL, 0, &path_len);
  char *path = (char *)malloc(path_len + 1);
  napi_get_value_string_utf8(env, argv[0], path, path_len + 1, NULL);

  /* Extract size number. */
  int32_t size;
  napi_get_value_int32(env, argv[1], &size);
  if (size < 16) size = 16;
  if (size > 512) size = 512;

  /* Create async work. */
  icon_work_t *work = (icon_work_t *)calloc(1, sizeof(icon_work_t));
  work->path = path;
  work->size = size;

  napi_value promise;
  napi_create_promise(env, &work->deferred, &promise);

  napi_value resource_name;
  napi_create_string_utf8(env, "nativeGetFileIcon", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_get_icon, complete_get_icon, work,
                         &work->work);
  napi_queue_async_work(env, work->work);

  return promise;
}

/* ── Module initialization ───────────────────────────────────────── */

/* This is called from the main module init alongside nativeCopyFile. The
   actual NAPI_MODULE registration happens in native_copyfile.c. We export
   a helper that the main init can call. */

napi_value register_file_icon(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeGetFileIcon", NAPI_AUTO_LENGTH, js_get_file_icon, NULL, &fn);
  napi_set_named_property(env, exports, "nativeGetFileIcon", fn);
  return exports;
}
