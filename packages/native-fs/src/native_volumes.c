/**
 * The disks mounted besides the startup disk, as Finder's sidebar lists them.
 *
 *   nativeListVolumes() → Array<{ path: string, name: string, isLocal: boolean,
 *                                 isReadOnly: boolean, fileSystem: string,
 *                                 canEject: boolean, disk: string | null }>
 *
 * Read from the kernel's mount table with getmntinfo(3). Only mounts under /Volumes are
 * listed, and not those marked MNT_DONTBROWSE: Time Machine's snapshots, and the system's
 * own volumes, which Finder doesn't show either. MNT_NOWAIT returns the table as the
 * kernel has it, without asking each file system (a network share that stopped answering
 * would block), so it is quick enough to call on the main thread.
 *
 * `disk` is the physical disk the volume is on ("disk5"), the same for every volume of a
 * partitioned drive or an APFS container; null for a network share or anything else that
 * isn't on a device. `canEject` is whether Finder shows an Eject button for it: a network
 * share, or a disk that can be ejected or removed or isn't inside the Mac. Both come from
 * the I/O Registry, which the kernel answers without asking the disk.
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

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOBSD.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/storage/IOMedia.h>

#include "native_volumes.h"

#define VOLUMES_PREFIX "/Volumes/"
#define DEV_PREFIX "/dev/"

static int registry_bool(io_registry_entry_t entry, CFStringRef key) {
  CFTypeRef value = IORegistryEntryCreateCFProperty(entry, key, kCFAllocatorDefault, 0);
  int result = value && CFGetTypeID(value) == CFBooleanGetTypeID() &&
               CFBooleanGetValue((CFBooleanRef)value);
  if (value) {
    CFRelease(value);
  }
  return result;
}

int volume_physical_disk(const char *bsd_name, char *whole, size_t whole_size, int *ejectable) {
  io_service_t media = IOServiceGetMatchingService(
      kIOMainPortDefault, IOBSDNameMatching(kIOMainPortDefault, 0, bsd_name));
  if (!media) {
    return 0;
  }
  /* The last whole disk going up the stack: the volume's own device may be one (a disk
   * without partitions, an APFS container's synthesized disk); the physical disk is the
   * last. */
  io_registry_entry_t top = IO_OBJECT_NULL;
  if (registry_bool(media, CFSTR(kIOMediaWholeKey))) {
    IOObjectRetain(media);
    top = media;
  }
  io_iterator_t parents = IO_OBJECT_NULL;
  if (IORegistryEntryCreateIterator(media, kIOServicePlane,
                                    kIORegistryIterateParents | kIORegistryIterateRecursively,
                                    &parents) == KERN_SUCCESS) {
    io_registry_entry_t entry;
    while ((entry = IOIteratorNext(parents)) != IO_OBJECT_NULL) {
      if (IOObjectConformsTo(entry, kIOMediaClass) &&
          registry_bool(entry, CFSTR(kIOMediaWholeKey))) {
        if (top != IO_OBJECT_NULL) {
          IOObjectRelease(top);
        }
        top = entry;
      } else {
        IOObjectRelease(entry);
      }
    }
    IOObjectRelease(parents);
  }
  IOObjectRelease(media);
  if (top == IO_OBJECT_NULL) {
    return 0;
  }

  int found = 0;
  CFTypeRef name = IORegistryEntryCreateCFProperty(top, CFSTR(kIOBSDNameKey), kCFAllocatorDefault, 0);
  if (name && CFGetTypeID(name) == CFStringGetTypeID() &&
      CFStringGetCString((CFStringRef)name, whole, (CFIndex)whole_size, kCFStringEncodingUTF8)) {
    found = 1;
  }
  if (name) {
    CFRelease(name);
  }

  int is_internal = 0;
  CFTypeRef characteristics = IORegistryEntrySearchCFProperty(
      top, kIOServicePlane, CFSTR("Protocol Characteristics"), kCFAllocatorDefault,
      kIORegistryIterateParents | kIORegistryIterateRecursively);
  if (characteristics && CFGetTypeID(characteristics) == CFDictionaryGetTypeID()) {
    CFTypeRef location = CFDictionaryGetValue((CFDictionaryRef)characteristics,
                                              CFSTR("Physical Interconnect Location"));
    is_internal = location && CFGetTypeID(location) == CFStringGetTypeID() &&
                  CFEqual(location, CFSTR("Internal"));
  }
  if (characteristics) {
    CFRelease(characteristics);
  }
  *ejectable = registry_bool(top, CFSTR(kIOMediaEjectableKey)) ||
               registry_bool(top, CFSTR(kIOMediaRemovableKey)) || !is_internal;
  IOObjectRelease(top);
  return found;
}

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

    const char *source = mount->f_mntfromname;
    char disk[64] = "";
    int ejectable = 0;
    int on_device = strncmp(source, DEV_PREFIX, strlen(DEV_PREFIX)) == 0 &&
                    volume_physical_disk(source + strlen(DEV_PREFIX), disk, sizeof disk,
                                         &ejectable);
    /* A network share, or another mount not on a device, is unmounted as Finder ejects it. */
    set_boolean(env, volume, "canEject", on_device ? ejectable : 1);
    napi_value disk_value;
    if (on_device) {
      napi_create_string_utf8(env, disk, NAPI_AUTO_LENGTH, &disk_value);
    } else {
      napi_get_null(env, &disk_value);
    }
    napi_set_named_property(env, volume, "disk", disk_value);
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
