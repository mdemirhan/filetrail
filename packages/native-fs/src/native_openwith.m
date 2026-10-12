/**
 * N-API async wrappers around the apps Launch Services knows can open a file.
 *
 *   nativeOpenWithApplications(paths, appPaths) → Promise<string>
 *     JSON: {"defaultApp":App|null,"apps":[App…],"kinds":[Kind…],"appInfo":[App|null…]}
 *     - apps: the apps that can open every one of `paths` (NSWorkspace
 *       URLsForApplicationsToOpenURL:, asked once per type), the default among them.
 *     - defaultApp: the app each of `paths` opens in, when they all open in the same one.
 *     - kinds: the types of `paths`, once each: {"contentType","name","isFolder"}, where
 *       name is what Finder's Kind column says ("Markdown Document").
 *     - appInfo: one answer per entry of `appPaths`, null when there is no app there.
 *     App: {"path","name","bundleId","version"}.
 *
 *   nativeSetDefaultApplication(appPath, contentType) → Promise<void>
 *     Makes the app the one every file of the type opens in (NSWorkspace
 *     setDefaultApplicationAtURL:toOpenContentType:), for Finder and every other app.
 *     Refused for folders, packages and apps.
 *
 * Both run on a libuv thread pool thread: Launch Services can be slow on a cold start.
 */

#include <node_api.h>
#include <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>

#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/* How long setting a default app may take before it is given up on. */
#define SET_DEFAULT_TIMEOUT_SEC 10

/* ── Helpers ─────────────────────────────────────────────────────── */

static char **copy_string_array(napi_env env, napi_value array, uint32_t *count_out) {
  bool is_array = false;
  *count_out = 0;
  if (napi_is_array(env, array, &is_array) != napi_ok || !is_array) {
    return NULL;
  }
  uint32_t count = 0;
  napi_get_array_length(env, array, &count);
  char **strings = (char **)calloc(count == 0 ? 1 : count, sizeof(char *));
  if (!strings) {
    return NULL;
  }
  for (uint32_t index = 0; index < count; index += 1) {
    napi_value element;
    size_t length = 0;
    napi_get_element(env, array, index, &element);
    if (napi_get_value_string_utf8(env, element, NULL, 0, &length) != napi_ok) {
      strings[index] = strdup("");
      continue;
    }
    strings[index] = (char *)malloc(length + 1);
    if (strings[index]) {
      napi_get_value_string_utf8(env, element, strings[index], length + 1, NULL);
    }
  }
  *count_out = count;
  return strings;
}

static void free_string_array(char **strings, uint32_t count) {
  if (!strings) {
    return;
  }
  for (uint32_t index = 0; index < count; index += 1) {
    free(strings[index]);
  }
  free(strings);
}

static char *copy_string_arg(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    return NULL;
  }
  char *string = (char *)malloc(length + 1);
  if (string) {
    napi_get_value_string_utf8(env, value, string, length + 1, NULL);
  }
  return string;
}

/* An app's path without a trailing slash, so the same app always has the same key. */
static NSString *app_key(NSURL *url) {
  NSString *path = url.URLByStandardizingPath.path;
  while (path.length > 1 && [path hasSuffix:@"/"]) {
    path = [path substringToIndex:path.length - 1];
  }
  return path;
}

/* The name Finder shows for an app, its version and bundle id; nil when there is no app. */
static NSDictionary *app_info(NSURL *url) {
  NSNumber *isDirectory = nil;
  if (![url getResourceValue:&isDirectory forKey:NSURLIsDirectoryKey error:NULL] ||
      !isDirectory.boolValue) {
    return nil;
  }
  NSBundle *bundle = [NSBundle bundleWithURL:url];
  NSString *name = nil;
  [url getResourceValue:&name forKey:NSURLLocalizedNameKey error:NULL];
  if (name.length == 0) {
    name = url.lastPathComponent;
  }
  if ([name.lowercaseString hasSuffix:@".app"] && name.length > 4) {
    name = [name substringToIndex:name.length - 4];
  }
  id version = [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
  NSString *bundleId = bundle.bundleIdentifier;
  return @{
    @"path" : app_key(url),
    @"name" : name ?: @"",
    @"bundleId" : bundleId.length > 0 ? bundleId : [NSNull null],
    @"version" : [version isKindOfClass:[NSString class]] && [version length] > 0
        ? version
        : [NSNull null],
  };
}

/* What Finder's Kind column says for the file ("Markdown Document", "Plain Text Document"):
   Spotlight's kind, else the type's own description ("Markdown", "text"). */
static NSString *kind_name(NSString *path, UTType *type) {
  MDItemRef item = MDItemCreate(kCFAllocatorDefault, (CFStringRef)path);
  if (item) {
    CFTypeRef value = MDItemCopyAttribute(item, kMDItemKind);
    CFRelease(item);
    if (value) {
      NSString *kind = nil;
      if (CFGetTypeID(value) == CFStringGetTypeID() && CFStringGetLength((CFStringRef)value) > 0) {
        kind = [[(NSString *)value copy] autorelease];
      }
      CFRelease(value);
      if (kind) {
        return kind;
      }
    }
  }
  return type.localizedDescription.length > 0 ? type.localizedDescription : nil;
}

/* ── nativeOpenWithApplications ──────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char **paths;
  uint32_t path_count;
  char **app_paths;
  uint32_t app_path_count;
  char *json; /* malloc'd result */
} open_with_work_t;

static void execute_open_with(napi_env env, void *data) {
  (void)env;
  open_with_work_t *w = (open_with_work_t *)data;
  @autoreleasepool {
    NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
    NSMutableArray *kinds = [NSMutableArray array];
    NSMutableSet *seenTypes = [NSMutableSet set];
    /* The apps that can open every path so far, by key, in Launch Services' order. */
    NSMutableArray<NSString *> *commonKeys = nil;
    NSMutableDictionary<NSString *, NSURL *> *urlsByKey = [NSMutableDictionary dictionary];
    NSString *defaultKey = nil;
    BOOL defaultsAgree = YES;

    for (uint32_t index = 0; index < w->path_count; index += 1) {
      NSString *path = w->paths[index] ? [NSString stringWithUTF8String:w->paths[index]] : nil;
      if (path.length == 0) {
        continue;
      }
      NSURL *url = [NSURL fileURLWithPath:path];

      /* Each file can have its own default (Finder's Get Info sets one), so it is asked
         for each, until two differ. */
      if (defaultsAgree) {
        NSURL *defaultURL = [workspace URLForApplicationToOpenURL:url];
        NSString *key = defaultURL ? app_key(defaultURL) : nil;
        if (!key || (defaultKey && ![defaultKey isEqualToString:key])) {
          defaultsAgree = NO;
          defaultKey = nil;
        } else {
          defaultKey = key;
          urlsByKey[key] = defaultURL;
        }
      }

      /* The apps that can open a file depend only on its type: asked once per type. */
      UTType *type = nil;
      [url getResourceValue:&type forKey:NSURLContentTypeKey error:NULL];
      NSString *typeId = type.identifier ?: [@"path:" stringByAppendingString:path];
      if ([seenTypes containsObject:typeId]) {
        continue;
      }
      [seenTypes addObject:typeId];
      if (type) {
        NSString *name = kind_name(path, type);
        [kinds addObject:@{
          @"contentType" : type.identifier,
          @"name" : name ?: [NSNull null],
          @"isFolder" : @([type conformsToType:UTTypeDirectory]),
        }];
      }
      NSArray<NSURL *> *appURLs = [workspace URLsForApplicationsToOpenURL:url];
      NSMutableArray<NSString *> *keys = [NSMutableArray arrayWithCapacity:appURLs.count];
      for (NSURL *appURL in appURLs) {
        NSString *key = app_key(appURL);
        if (![keys containsObject:key]) {
          [keys addObject:key];
          urlsByKey[key] = appURL;
        }
      }
      if (!commonKeys) {
        commonKeys = keys;
      } else {
        NSSet *keySet = [NSSet setWithArray:keys];
        [commonKeys filterUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(
                                                          NSString *key, NSDictionary *bindings) {
                      (void)bindings;
                      return [keySet containsObject:key];
                    }]];
      }
    }

    NSMutableArray *apps = [NSMutableArray array];
    for (NSString *key in commonKeys ?: @[]) {
      NSDictionary *info = app_info(urlsByKey[key]);
      if (info) {
        [apps addObject:info];
      }
    }
    NSDictionary *defaultApp = defaultKey ? app_info(urlsByKey[defaultKey]) : nil;

    NSMutableArray *appInfo = [NSMutableArray arrayWithCapacity:w->app_path_count];
    for (uint32_t index = 0; index < w->app_path_count; index += 1) {
      NSString *path =
          w->app_paths[index] ? [NSString stringWithUTF8String:w->app_paths[index]] : nil;
      NSDictionary *info = path.length > 0 ? app_info([NSURL fileURLWithPath:path]) : nil;
      [appInfo addObject:info ?: [NSNull null]];
    }

    NSDictionary *result = @{
      @"defaultApp" : defaultApp ?: [NSNull null],
      @"apps" : apps,
      @"kinds" : kinds,
      @"appInfo" : appInfo,
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
    if (data) {
      w->json = (char *)malloc(data.length + 1);
      if (w->json) {
        memcpy(w->json, data.bytes, data.length);
        w->json[data.length] = '\0';
      }
    }
  }
}

static void complete_open_with(napi_env env, napi_status status, void *data) {
  open_with_work_t *w = (open_with_work_t *)data;
  if (status == napi_ok && w->json) {
    napi_value result;
    napi_create_string_utf8(env, w->json, NAPI_AUTO_LENGTH, &result);
    napi_resolve_deferred(env, w->deferred, result);
  } else {
    napi_value message;
    napi_value error;
    napi_create_string_utf8(env, "Launch Services didn't answer", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  }
  napi_delete_async_work(env, w->work);
  free_string_array(w->paths, w->path_count);
  free_string_array(w->app_paths, w->app_path_count);
  free(w->json);
  free(w);
}

static napi_value native_open_with_applications(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    napi_throw_type_error(env, NULL,
                          "nativeOpenWithApplications requires 2 arguments: paths, appPaths");
    return NULL;
  }
  open_with_work_t *w = (open_with_work_t *)calloc(1, sizeof(open_with_work_t));
  if (!w) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->paths = copy_string_array(env, argv[0], &w->path_count);
  w->app_paths = copy_string_array(env, argv[1], &w->app_path_count);
  if (!w->paths || !w->app_paths) {
    free_string_array(w->paths, w->path_count);
    free_string_array(w->app_paths, w->app_path_count);
    free(w);
    napi_throw_type_error(env, NULL, "paths and appPaths must be arrays of strings");
    return NULL;
  }

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeOpenWithApplications", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_open_with, complete_open_with, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* ── nativeSetDefaultApplication ─────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *app_path;
  char *content_type;
  char *error; /* malloc'd message on failure */
} set_default_work_t;

static void execute_set_default(napi_env env, void *data) {
  (void)env;
  set_default_work_t *w = (set_default_work_t *)data;
  @autoreleasepool {
    NSString *appPath = [NSString stringWithUTF8String:w->app_path];
    UTType *type = [UTType typeWithIdentifier:[NSString stringWithUTF8String:w->content_type]];
    if (!appPath || !type) {
      w->error = strdup("That kind of file isn't known to macOS.");
      return;
    }
    /* Folders, packages and apps are left as they are: changing what opens every folder
       would take them all away from Finder. */
    if ([type conformsToType:UTTypeDirectory]) {
      w->error = strdup("Folders, apps and packages keep the app they open in.");
      return;
    }
    __block NSString *failure = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [[NSWorkspace sharedWorkspace]
        setDefaultApplicationAtURL:[NSURL fileURLWithPath:appPath]
                 toOpenContentType:type
                 completionHandler:^(NSError *error) {
                   if (error) {
                     failure = [error.localizedDescription copy];
                   }
                   dispatch_semaphore_signal(done);
                 }];
    long timedOut = dispatch_semaphore_wait(
        done, dispatch_time(DISPATCH_TIME_NOW, (int64_t)SET_DEFAULT_TIMEOUT_SEC * NSEC_PER_SEC));
    dispatch_release(done);
    if (timedOut) {
      w->error = strdup("macOS didn't answer.");
    } else if (failure) {
      w->error = strdup(failure.UTF8String ?: "macOS refused the change.");
    }
    [failure release];
  }
}

static void complete_set_default(napi_env env, napi_status status, void *data) {
  set_default_work_t *w = (set_default_work_t *)data;
  if (status == napi_ok && !w->error) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, w->deferred, undefined);
  } else {
    napi_value message;
    napi_value error;
    napi_create_string_utf8(env, w->error ?: "macOS refused the change.", NAPI_AUTO_LENGTH,
                            &message);
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  }
  napi_delete_async_work(env, w->work);
  free(w->app_path);
  free(w->content_type);
  free(w->error);
  free(w);
}

static napi_value native_set_default_application(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 2) {
    napi_throw_type_error(
        env, NULL, "nativeSetDefaultApplication requires 2 arguments: appPath, contentType");
    return NULL;
  }
  set_default_work_t *w = (set_default_work_t *)calloc(1, sizeof(set_default_work_t));
  if (!w) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->app_path = copy_string_arg(env, argv[0]);
  w->content_type = copy_string_arg(env, argv[1]);
  if (!w->app_path || !w->content_type) {
    free(w->app_path);
    free(w->content_type);
    free(w);
    napi_throw_type_error(env, NULL, "appPath and contentType must be strings");
    return NULL;
  }

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeSetDefaultApplication", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_set_default, complete_set_default, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_open_with(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeOpenWithApplications", NAPI_AUTO_LENGTH,
                       native_open_with_applications, NULL, &fn);
  napi_set_named_property(env, exports, "nativeOpenWithApplications", fn);
  napi_create_function(env, "nativeSetDefaultApplication", NAPI_AUTO_LENGTH,
                       native_set_default_application, NULL, &fn);
  napi_set_named_property(env, exports, "nativeSetDefaultApplication", fn);
  return exports;
}
