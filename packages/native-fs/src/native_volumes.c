/**
 * The disks mounted besides the startup disk, as Finder's sidebar lists them.
 *
 *   nativeListVolumes() → Array<{ path: string, name: string, isLocal: boolean,
 *                                 isReadOnly: boolean, fileSystem: string }>
 *
 * Read from the kernel's mount table with getmntinfo(3). Only mounts under /Volumes are
 * listed, and not those marked MNT_DONTBROWSE: Time Machine's snapshots, and the system's
 * own volumes, which Finder doesn't show either. MNT_NOWAIT returns the table as the
 * kernel has it, without asking each file system (a network share that stopped answering
 * would block), so it is quick enough to call on the main thread.
 *
 *   nativeListMounts() → Array<{ path: string, isLocal: boolean }>
 *
 * Every mount in the same table, wherever it is mounted and however it is marked: what
 * holds a path, to tell a network share from a local disk.
 */

#include <node_api.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/ucred.h>

#define VOLUMES_PREFIX "/Volumes/"

static void set_string(napi_env env, napi_value object, const char *key, const char *value) {
  napi_value string;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &string);
  napi_set_named_property(env, object, key, string);
}

static void set_boolean(napi_env env, napi_value object, const char *key, int value) {
  napi_value boolean;
  napi_get_boolean(env, value != 0, &boolean);
  napi_set_named_property(env, object, key, boolean);
}

static napi_value native_list_volumes(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_array(env, &result);

  struct statfs *mounts = NULL;
  int count = getmntinfo(&mounts, MNT_NOWAIT);
  uint32_t index = 0;
  for (int i = 0; i < count; i++) {
    const struct statfs *mount = &mounts[i];
    const char *path = mount->f_mntonname;
    if (strncmp(path, VOLUMES_PREFIX, strlen(VOLUMES_PREFIX)) != 0) {
      continue;
    }
    const char *name = path + strlen(VOLUMES_PREFIX);
    /* A disk mounted deeper than /Volumes/<name>, or with a hidden name. */
    if (name[0] == '\0' || name[0] == '.' || strchr(name, '/') != NULL) {
      continue;
    }
    if (mount->f_flags & MNT_DONTBROWSE) {
      continue;
    }

    napi_value volume;
    napi_create_object(env, &volume);
    set_string(env, volume, "path", path);
    set_string(env, volume, "name", name);
    set_boolean(env, volume, "isLocal", mount->f_flags & MNT_LOCAL);
    set_boolean(env, volume, "isReadOnly", mount->f_flags & MNT_RDONLY);
    set_string(env, volume, "fileSystem", mount->f_fstypename);
    napi_set_element(env, result, index++, volume);
  }
  return result;
}

static napi_value native_list_mounts(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_array(env, &result);

  struct statfs *mounts = NULL;
  int count = getmntinfo(&mounts, MNT_NOWAIT);
  for (int i = 0; i < count; i++) {
    napi_value mount;
    napi_create_object(env, &mount);
    set_string(env, mount, "path", mounts[i].f_mntonname);
    set_boolean(env, mount, "isLocal", mounts[i].f_flags & MNT_LOCAL);
    napi_set_element(env, result, (uint32_t)i, mount);
  }
  return result;
}

napi_value register_volumes(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeListVolumes", NAPI_AUTO_LENGTH, native_list_volumes, NULL,
                       &fn);
  napi_set_named_property(env, exports, "nativeListVolumes", fn);
  napi_create_function(env, "nativeListMounts", NAPI_AUTO_LENGTH, native_list_mounts, NULL,
                       &fn);
  napi_set_named_property(env, exports, "nativeListMounts", fn);
  return exports;
}
