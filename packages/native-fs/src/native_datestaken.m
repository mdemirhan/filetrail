/**
 * N-API async wrapper reading when photos and videos were taken, for renaming by date.
 *
 *   nativeDatesTaken(paths: string[]) → Promise<Array<string | null>>
 *     One answer per path, in order: "2026-05-14T18:02:11" on the clock of this Mac, or
 *     null when the item has no such date (it isn't a photo or video, has no metadata, or
 *     can't be read).
 *
 *   Photos: ImageIO reads the date the camera wrote into the file (EXIF DateTimeOriginal,
 *   else DateTimeDigitized). It is a local time without a zone, and is passed on as it is.
 *   Videos: AVFoundation reads the movie's creation date, a moment, shown on this Mac's
 *   clock.
 *
 * Runs on a libuv thread pool thread: reading many files takes a while.
 */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/* How long a video's metadata may take to load before it counts as having none. */
static const int64_t VIDEO_LOAD_TIMEOUT_SECONDS = 5;

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char **paths;
  char **answers; /* NULL where there is no date */
  size_t count;
} dates_work_t;

/* "2026:05:14 18:02:11" (EXIF) → "2026-05-14T18:02:11"; nil for anything else. */
static NSString *local_date_from_exif(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length < 19) {
    return nil;
  }
  const char *text = value.UTF8String;
  if (!text) {
    return nil;
  }
  static const int digit_positions[] = {0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18};
  for (size_t i = 0; i < sizeof(digit_positions) / sizeof(digit_positions[0]); i++) {
    char c = text[digit_positions[i]];
    if (c < '0' || c > '9') {
      return nil;
    }
  }
  /* Cameras that don't know the date write zeros, or spaces. */
  if (strncmp(text, "0000", 4) == 0) {
    return nil;
  }
  return [NSString stringWithFormat:@"%.4s-%.2s-%.2sT%.2s:%.2s:%.2s", text, text + 5, text + 8,
                                    text + 11, text + 14, text + 17];
}

static NSString *local_date_from_moment(NSDate *date) {
  if (!date) {
    return nil;
  }
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
  formatter.timeZone = [NSTimeZone localTimeZone];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss";
  return [formatter stringFromDate:date];
}

static NSString *photo_date(NSURL *url) {
  NSDictionary *options = @{(__bridge id)kCGImageSourceShouldCache : @NO};
  CGImageSourceRef source =
      CGImageSourceCreateWithURL((__bridge CFURLRef)url, (__bridge CFDictionaryRef)options);
  if (!source) {
    return nil;
  }
  CFDictionaryRef copied =
      CGImageSourceCopyPropertiesAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (!copied) {
    return nil;
  }
  NSDictionary *properties = CFBridgingRelease(copied);
  NSDictionary *exif = properties[(__bridge id)kCGImagePropertyExifDictionary];
  if (![exif isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  NSString *taken = local_date_from_exif(exif[(__bridge id)kCGImagePropertyExifDateTimeOriginal]);
  if (taken) {
    return taken;
  }
  return local_date_from_exif(exif[(__bridge id)kCGImagePropertyExifDateTimeDigitized]);
}

static NSString *video_date(NSURL *url) {
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  if (!asset) {
    return nil;
  }
  dispatch_semaphore_t loaded = dispatch_semaphore_create(0);
  [asset loadValuesAsynchronouslyForKeys:@[ @"creationDate" ]
                       completionHandler:^{
                         dispatch_semaphore_signal(loaded);
                       }];
  if (dispatch_semaphore_wait(loaded, dispatch_time(DISPATCH_TIME_NOW,
                                                    VIDEO_LOAD_TIMEOUT_SECONDS * NSEC_PER_SEC)) !=
      0) {
    [asset cancelLoading];
    return nil;
  }
  NSError *error = nil;
  if ([asset statusOfValueForKey:@"creationDate" error:&error] != AVKeyValueStatusLoaded) {
    return nil;
  }
  return local_date_from_moment(asset.creationDate.dateValue);
}

static NSString *date_taken(const char *rawPath) {
  NSString *path = [NSString stringWithUTF8String:rawPath];
  if (!path) {
    return nil;
  }
  NSURL *url = [NSURL fileURLWithPath:path];
  NSString *extension = url.pathExtension;
  UTType *type = extension.length > 0 ? [UTType typeWithFilenameExtension:extension] : nil;
  if (!type) {
    return nil;
  }
  if ([type conformsToType:UTTypeImage]) {
    return photo_date(url);
  }
  if ([type conformsToType:UTTypeAudiovisualContent]) {
    return video_date(url);
  }
  return nil;
}

static void execute_dates_taken(napi_env env, void *data) {
  (void)env;
  dates_work_t *w = (dates_work_t *)data;
  for (size_t i = 0; i < w->count; i++) {
    @autoreleasepool {
      NSString *answer = date_taken(w->paths[i]);
      w->answers[i] = answer ? strdup(answer.UTF8String) : NULL;
    }
  }
}

static void free_work(dates_work_t *w) {
  for (size_t i = 0; i < w->count; i++) {
    free(w->paths ? w->paths[i] : NULL);
    free(w->answers ? w->answers[i] : NULL);
  }
  free(w->paths);
  free(w->answers);
  free(w);
}

static void complete_dates_taken(napi_env env, napi_status status, void *data) {
  dates_work_t *w = (dates_work_t *)data;
  napi_value result;
  napi_create_array_with_length(env, w->count, &result);
  for (size_t i = 0; i < w->count; i++) {
    napi_value value;
    if (status == napi_ok && w->answers[i]) {
      napi_create_string_utf8(env, w->answers[i], NAPI_AUTO_LENGTH, &value);
    } else {
      napi_get_null(env, &value);
    }
    napi_set_element(env, result, (uint32_t)i, value);
  }
  napi_resolve_deferred(env, w->deferred, result);
  napi_delete_async_work(env, w->work);
  free_work(w);
}

static napi_value native_dates_taken(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  bool is_array = false;
  if (argc < 1 || napi_is_array(env, argv[0], &is_array) != napi_ok || !is_array) {
    napi_throw_type_error(env, NULL, "nativeDatesTaken requires an array of paths");
    return NULL;
  }
  uint32_t count = 0;
  napi_get_array_length(env, argv[0], &count);
  dates_work_t *w = (dates_work_t *)calloc(1, sizeof(dates_work_t));
  if (!w) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->count = count;
  w->paths = (char **)calloc(count > 0 ? count : 1, sizeof(char *));
  w->answers = (char **)calloc(count > 0 ? count : 1, sizeof(char *));
  if (!w->paths || !w->answers) {
    free_work(w);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  for (uint32_t i = 0; i < count; i++) {
    napi_value element;
    size_t length = 0;
    napi_get_element(env, argv[0], i, &element);
    if (napi_get_value_string_utf8(env, element, NULL, 0, &length) != napi_ok) {
      free_work(w);
      napi_throw_type_error(env, NULL, "every path must be a string");
      return NULL;
    }
    w->paths[i] = (char *)malloc(length + 1);
    if (!w->paths[i]) {
      free_work(w);
      napi_throw_error(env, NULL, "Out of memory");
      return NULL;
    }
    napi_get_value_string_utf8(env, element, w->paths[i], length + 1, NULL);
  }

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeDatesTaken", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_dates_taken, complete_dates_taken, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_dates_taken(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeDatesTaken", NAPI_AUTO_LENGTH, native_dates_taken, NULL, &fn);
  napi_set_named_property(env, exports, "nativeDatesTaken", fn);
  return exports;
}
