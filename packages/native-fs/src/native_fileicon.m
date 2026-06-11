/**
 * N-API async wrapper around NSWorkspace iconForFile:.
 *
 * Exposes a single function: nativeGetFileIcon(path, size) → Promise<Buffer>
 *
 * Uses NSWorkspace to get the macOS file icon for any path, renders it as PNG
 * at the requested pixel size. The async work item runs on a libuv thread pool
 * thread, but the AppKit work itself is dispatched to the main queue (see
 * execute_get_icon) — the pool thread only waits for the result.
 */

#include <node_api.h>
#include <dispatch/dispatch.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#import <AppKit/AppKit.h>

/* How long the pool thread waits for the main queue to render an icon. */
#define ICON_RENDER_TIMEOUT_SEC 10

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

/* ── Main-thread icon rendering ──────────────────────────────────── */

/* Context shared between the libuv pool thread and the main-queue block.
   Refcounted (initial count 2: waiter + block) so that if the timed wait
   gives up, the late-running block still has valid memory to write to and
   the last owner frees everything. */
typedef struct {
  atomic_int refs;
  char *path;        /* owned copy */
  int size;
  void *png_data;    /* malloc'd PNG bytes, set by the block */
  size_t png_length;
  dispatch_semaphore_t sem;
} icon_render_ctx_t;

static void icon_ctx_release(icon_render_ctx_t *ctx) {
  if (atomic_fetch_sub(&ctx->refs, 1) == 1) {
    free(ctx->path);
    free(ctx->png_data);
    dispatch_release(ctx->sem);
    free(ctx);
  }
}

/* Runs on the main queue. AppKit only. */
static void render_icon(icon_render_ctx_t *ctx) {
  @autoreleasepool {
    NSString *nsPath = [NSString stringWithUTF8String:ctx->path];
    if (!nsPath) {
      return;
    }
    NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:nsPath];
    if (!icon) {
      return;
    }

    NSSize targetSize = NSMakeSize(ctx->size, ctx->size);
    [icon setSize:targetSize];

    /* Render into a bitmap at the exact pixel dimensions requested. */
    NSBitmapImageRep *bitmapRep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL
                      pixelsWide:ctx->size
                      pixelsHigh:ctx->size
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
    [icon drawInRect:NSMakeRect(0, 0, ctx->size, ctx->size)
            fromRect:NSZeroRect
           operation:NSCompositingOperationSourceOver
            fraction:1.0];
    [NSGraphicsContext restoreGraphicsState];

    NSData *pngData = [bitmapRep representationUsingType:NSBitmapImageFileTypePNG
                                              properties:@{}];
    [bitmapRep release];
    if (!pngData || [pngData length] == 0) {
      return;
    }

    void *bytes = malloc([pngData length]);
    if (!bytes) {
      return;
    }
    memcpy(bytes, [pngData bytes], [pngData length]);
    ctx->png_data = bytes;
    ctx->png_length = [pngData length];
  }
}

/* ── Execute on libuv thread pool ────────────────────────────────── */

static void execute_get_icon(napi_env env, void *data) {
  (void)env;
  icon_work_t *work = (icon_work_t *)data;
  work->failed = 1;
  work->png_data = NULL;
  work->png_length = 0;

  /* AppKit (NSWorkspace, NSGraphicsContext drawing) is only safe on the main
     thread, so the rendering is dispatched to the main queue and awaited with
     a timed semaphore. A timed wait — not dispatch_sync — because the main
     queue is only drained when the main thread pumps a CFRunLoop (Electron
     does; plain Node does not): on timeout we resolve null instead of
     deadlocking, and the refcounted ctx keeps a late-running block from
     touching freed memory. */
  icon_render_ctx_t *ctx = (icon_render_ctx_t *)calloc(1, sizeof(icon_render_ctx_t));
  if (!ctx) {
    return;
  }
  ctx->path = strdup(work->path);
  if (!ctx->path) {
    free(ctx);
    return;
  }
  ctx->size = work->size;
  ctx->sem = dispatch_semaphore_create(0);
  atomic_init(&ctx->refs, 2); /* this thread + the block */

  dispatch_async(dispatch_get_main_queue(), ^{
    render_icon(ctx);
    dispatch_semaphore_signal(ctx->sem);
    icon_ctx_release(ctx);
  });

  long timed_out = dispatch_semaphore_wait(
      ctx->sem,
      dispatch_time(DISPATCH_TIME_NOW, ICON_RENDER_TIMEOUT_SEC * NSEC_PER_SEC));
  if (!timed_out && ctx->png_data) {
    /* Transfer PNG ownership to the work item. */
    work->png_data = ctx->png_data;
    work->png_length = ctx->png_length;
    ctx->png_data = NULL;
    work->failed = 0;
  }
  icon_ctx_release(ctx);
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
