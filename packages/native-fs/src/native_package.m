/**
 * N-API async wrapper asking macOS whether a folder is a package.
 *
 *   nativeIsPackage(path) → Promise<boolean | null>
 *     NSURLIsPackageKey: true for folders Finder shows as one item, whether by their type
 *     (apps, Keynote and Pages documents, photo libraries, anything an installed app
 *     declares as a package) or by the folder's own package bit. null when it can't be
 *     told (the item is gone, say).
 *
 * Runs on a libuv thread pool thread: Launch Services and network volumes can be slow.
 */

#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#import <Foundation/Foundation.h>

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  int answer; /* 1 package, 0 not, -1 unknown */
} package_work_t;

static void execute_is_package(napi_env env, void *data) {
  (void)env;
  package_work_t *w = (package_work_t *)data;
  w->answer = -1;
  @autoreleasepool {
    NSString *path = [NSString stringWithUTF8String:w->path];
    if (!path) {
      return;
    }
    NSURL *url = [NSURL fileURLWithPath:path];
    NSNumber *isPackage = nil;
    if ([url getResourceValue:&isPackage forKey:NSURLIsPackageKey error:NULL] && isPackage) {
      w->answer = isPackage.boolValue ? 1 : 0;
    }
  }
}

static void complete_is_package(napi_env env, napi_status status, void *data) {
  package_work_t *w = (package_work_t *)data;
  napi_value result;
  if (status != napi_ok || w->answer < 0) {
    napi_get_null(env, &result);
  } else {
    napi_get_boolean(env, w->answer == 1, &result);
  }
  napi_resolve_deferred(env, w->deferred, result);
  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w);
}

static napi_value native_is_package(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "nativeIsPackage requires 1 argument: path");
    return NULL;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  char *path = (char *)malloc(length + 1);
  package_work_t *w = (package_work_t *)calloc(1, sizeof(package_work_t));
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
  napi_create_string_utf8(env, "nativeIsPackage", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_is_package, complete_is_package, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

/* Called from the main module init in native_copyfile.c. */
napi_value register_package(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeIsPackage", NAPI_AUTO_LENGTH, native_is_package, NULL, &fn);
  napi_set_named_property(env, exports, "nativeIsPackage", fn);
  return exports;
}
