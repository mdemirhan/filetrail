/**
 * N-API wrapper around QLThumbnailGenerator.
 *
 * Exposes a single function: nativeGetFileThumbnail(path, size) → Promise<Buffer|null>
 *
 * Asks Quick Look for a picture of the file's content (an image, a PDF page, a video
 * frame, a document page) that fits in a square of `size` pixels, keeping its
 * proportions. Resolves null when Quick Look has no preview for the file; the system
 * icon is not returned as a stand-in (see nativeGetFileIcon for that).
 *
 * Pictures and videos come back as they are. Everything else (text, PDFs, documents) is
 * drawn the way Finder draws its icons: a page with its own outline and shadow on a
 * clear background, so a white page stays visible on a white window.
 *
 * Nothing here waits on the JS thread or on a libuv pool thread: the file's type is read
 * on a dispatch queue, Quick Look does the work out of process and calls back on a queue
 * of its own, and the callback hands the encoded picture back to the JS thread through a
 * thread-safe function.
 */

#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <QuickLookThumbnailing/QuickLookThumbnailing.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/* JPEG quality for pictures without transparency. */
#define THUMBNAIL_JPEG_QUALITY 0.82

typedef struct {
  napi_deferred deferred;
  napi_threadsafe_function tsfn;
  void *bytes;   /* malloc'd JPEG or PNG data; NULL when there is no thumbnail */
  size_t length;
} thumbnail_call_t;

/* Whether every pixel of the image is fully opaque. */
static int image_is_opaque(CGImageRef image) {
  CGImageAlphaInfo alpha = CGImageGetAlphaInfo(image);
  if (alpha == kCGImageAlphaNone || alpha == kCGImageAlphaNoneSkipFirst ||
      alpha == kCGImageAlphaNoneSkipLast) {
    return 1;
  }
  size_t width = CGImageGetWidth(image);
  size_t height = CGImageGetHeight(image);
  if (width == 0 || height == 0) {
    return 0;
  }
  uint8_t *pixels = (uint8_t *)calloc(width * height, 4);
  if (!pixels) {
    return 0;
  }
  int opaque = 0;
  CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      pixels, width, height, 8, width * 4, color_space,
      (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(color_space);
  if (context) {
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
    CGContextRelease(context);
    opaque = 1;
    size_t count = width * height;
    for (size_t i = 0; i < count; i += 1) {
      if (pixels[i * 4 + 3] != 255) {
        opaque = 0;
        break;
      }
    }
  }
  free(pixels);
  return opaque;
}

/* Encodes the image as JPEG when it has no transparency (photos, pages, video frames:
   a fraction of the PNG size) and as PNG otherwise. Returns malloc'd bytes or NULL. */
static void *encode_thumbnail(CGImageRef image, size_t *out_length) {
  int opaque = image_is_opaque(image);
  CFMutableDataRef data = CFDataCreateMutable(kCFAllocatorDefault, 0);
  if (!data) {
    return NULL;
  }
  CGImageDestinationRef destination = CGImageDestinationCreateWithData(
      data, opaque ? CFSTR("public.jpeg") : CFSTR("public.png"), 1, NULL);
  if (!destination) {
    CFRelease(data);
    return NULL;
  }
  NSDictionary *properties =
      opaque ? @{(id)kCGImageDestinationLossyCompressionQuality : @(THUMBNAIL_JPEG_QUALITY)}
             : @{};
  CGImageDestinationAddImage(destination, image, (CFDictionaryRef)properties);
  bool finalized = CGImageDestinationFinalize(destination);
  CFRelease(destination);

  void *bytes = NULL;
  size_t length = (size_t)CFDataGetLength(data);
  if (finalized && length > 0) {
    bytes = malloc(length);
    if (bytes) {
      memcpy(bytes, CFDataGetBytePtr(data), length);
      *out_length = length;
    }
  }
  CFRelease(data);
  return bytes;
}

/* Whether the file is a picture or a video, whose preview is the content itself. A
   symlink counts as what it points to. */
static BOOL shows_picture(NSURL *url) {
  if (@available(macOS 11.0, *)) {
    UTType *type = nil;
    NSURL *target = [url URLByResolvingSymlinksInPath];
    if ([target getResourceValue:&type forKey:NSURLContentTypeKey error:NULL] && type) {
      return [type conformsToType:UTTypeImage] || [type conformsToType:UTTypeAudiovisualContent];
    }
  }
  return YES;
}

/* Runs on the JS thread once Quick Look has answered. `env` is NULL when the
   environment is shutting down; the promise is then left unsettled. */
static void settle_thumbnail(napi_env env, napi_value js_callback, void *context, void *data) {
  (void)js_callback;
  (void)context;
  thumbnail_call_t *call = (thumbnail_call_t *)data;
  if (env) {
    napi_value result;
    void *copy;
    if (!call->bytes ||
        napi_create_buffer_copy(env, call->length, call->bytes, &copy, &result) != napi_ok) {
      napi_get_null(env, &result);
    }
    napi_resolve_deferred(env, call->deferred, result);
  }
  napi_release_threadsafe_function(call->tsfn, napi_tsfn_release);
  free(call->bytes);
  free(call);
}

static napi_value resolved_null(napi_env env, napi_deferred deferred, napi_value promise) {
  napi_value null_value;
  napi_get_null(env, &null_value);
  napi_resolve_deferred(env, deferred, null_value);
  return promise;
}

/* ── JS entry point: nativeGetFileThumbnail(path, size) → Promise<Buffer|null> ── */

static napi_value js_get_file_thumbnail(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 2) {
    napi_throw_error(env, NULL, "nativeGetFileThumbnail requires (path, size)");
    return NULL;
  }

  size_t path_length;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &path_length) != napi_ok) {
    napi_throw_type_error(env, NULL, "nativeGetFileThumbnail: path must be a string");
    return NULL;
  }
  char *path = (char *)malloc(path_length + 1);
  if (!path) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  if (napi_get_value_string_utf8(env, argv[0], path, path_length + 1, NULL) != napi_ok) {
    free(path);
    napi_throw_type_error(env, NULL, "nativeGetFileThumbnail: path must be a string");
    return NULL;
  }

  int32_t size;
  if (napi_get_value_int32(env, argv[1], &size) != napi_ok) {
    free(path);
    napi_throw_type_error(env, NULL, "nativeGetFileThumbnail: size must be a number");
    return NULL;
  }
  if (size < 16) size = 16;
  if (size > 1024) size = 1024;

  napi_deferred deferred;
  napi_value promise;
  if (napi_create_promise(env, &deferred, &promise) != napi_ok) {
    free(path);
    napi_throw_error(env, NULL, "nativeGetFileThumbnail: failed to create promise");
    return NULL;
  }

  thumbnail_call_t *call = (thumbnail_call_t *)calloc(1, sizeof(thumbnail_call_t));
  napi_value resource_name;
  if (!call ||
      napi_create_string_utf8(env, "nativeGetFileThumbnail", NAPI_AUTO_LENGTH, &resource_name) !=
          napi_ok ||
      napi_create_threadsafe_function(env, NULL, NULL, resource_name, 0, 1, NULL, NULL, NULL,
                                      settle_thumbnail, &call->tsfn) != napi_ok) {
    free(call);
    free(path);
    return resolved_null(env, deferred, promise);
  }
  call->deferred = deferred;

  @autoreleasepool {
    NSString *ns_path = [NSString stringWithUTF8String:path];
    free(path);
    if (!ns_path) {
      napi_release_threadsafe_function(call->tsfn, napi_tsfn_release);
      free(call);
      return resolved_null(env, deferred, promise);
    }
    NSURL *url = [NSURL fileURLWithPath:ns_path];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      @autoreleasepool {
        QLThumbnailGenerationRequest *request = [[QLThumbnailGenerationRequest alloc]
            initWithFileAtURL:url
                         size:CGSizeMake(size, size)
                        scale:1.0
          representationTypes:QLThumbnailGenerationRequestRepresentationTypeThumbnail];
        request.iconMode = !shows_picture(url);
        [[QLThumbnailGenerator sharedGenerator]
            generateBestRepresentationForRequest:request
                               completionHandler:^(QLThumbnailRepresentation *thumbnail,
                                                   NSError *error) {
                                 (void)error;
                                 CGImageRef image = thumbnail ? thumbnail.CGImage : NULL;
                                 if (image) {
                                   call->bytes = encode_thumbnail(image, &call->length);
                                 }
                                 napi_call_threadsafe_function(call->tsfn, call,
                                                               napi_tsfn_blocking);
                               }];
        [request release];
      }
    });
  }

  return promise;
}

/* nativeKindForPath(path) → string | null
   What Finder shows in its Kind column for this file ("Markdown Document", "PNG image",
   "Plain Text Document"). null when there is none. Fast and synchronous: callers cache it per
   extension, since files with the same extension share it. */
static napi_value js_kind_for_path(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_value result;
  napi_get_null(env, &result);
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 1) {
    return result;
  }
  char path[4096];
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], path, sizeof(path), &length) != napi_ok ||
      length == 0) {
    return result;
  }
  @autoreleasepool {
    NSString *string = [NSString stringWithUTF8String:path];
    NSURL *url = string ? [NSURL fileURLWithPath:string] : nil;
    /* Spotlight's kind (kMDItemKind) is the one Finder's Kind column shows: "Markdown
       Document", "Plain Text Document", where the type's own description is "Markdown"
       or "text". It is worked out from the file when asked, indexed or not. */
    MDItemRef item = MDItemCreate(kCFAllocatorDefault, (CFStringRef)string);
    if (item) {
      CFTypeRef value = MDItemCopyAttribute(item, kMDItemKind);
      CFRelease(item);
      if (value) {
        BOOL found = CFGetTypeID(value) == CFStringGetTypeID() &&
                     CFStringGetLength((CFStringRef)value) > 0;
        if (found) {
          napi_create_string_utf8(env, [(NSString *)value UTF8String], NAPI_AUTO_LENGTH, &result);
        }
        CFRelease(value);
        if (found) {
          return result;
        }
      }
    }
    /* Then Launch Services' kind string, deprecated but without a replacement in the same
       words, then the type's own description. */
    CFStringRef kind = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    if (url && LSCopyKindStringForURL((CFURLRef)url, &kind) == noErr && kind) {
#pragma clang diagnostic pop
      NSString *string = (NSString *)kind;
      BOOL found = string.length > 0;
      if (found) {
        napi_create_string_utf8(env, string.UTF8String, NAPI_AUTO_LENGTH, &result);
      }
      CFRelease(kind);
      if (found) {
        return result;
      }
    }
    NSString *description = nil;
    if (url && [url getResourceValue:&description
                              forKey:NSURLLocalizedTypeDescriptionKey
                               error:NULL] &&
        description.length > 0) {
      napi_create_string_utf8(env, description.UTF8String, NAPI_AUTO_LENGTH, &result);
    }
  }
  return result;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_file_thumbnail(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeGetFileThumbnail", NAPI_AUTO_LENGTH, js_get_file_thumbnail,
                       NULL, &fn);
  napi_set_named_property(env, exports, "nativeGetFileThumbnail", fn);
  napi_value kind_fn;
  napi_create_function(env, "nativeKindForPath", NAPI_AUTO_LENGTH, js_kind_for_path, NULL,
                       &kind_fn);
  napi_set_named_property(env, exports, "nativeKindForPath", kind_fn);
  return exports;
}
