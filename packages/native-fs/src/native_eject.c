/**
 * Eject, as Finder's sidebar button and File ▸ Eject do it.
 *
 *   nativeEjectVolume(path, { force?: boolean, wholeDisk?: boolean }) → Promise<void>
 *
 * With `wholeDisk`, every volume mounted from the same physical disk (see
 * `volume_physical_disk`) is unmounted, then the disk itself is ejected: a disk image is
 * detached, a drive spun down and let go. Without it only the volume at `path` is unmounted
 * and its disk stays attached (Finder's "Eject" for one volume of a partitioned drive). A
 * network share, or another mount not on a device, is unmounted either way.
 *
 * Unmounting goes through Disk Arbitration, which asks the apps that registered to hear of
 * it (they may refuse) and refuses itself while a file on the volume is open. `force`
 * unmounts anyway, as Finder's Force Eject does.
 *
 * Rejects with a Node-style errno error: `code` "EBUSY" while the volume is in use,
 * "ENOENT" when nothing is mounted at the path any more, "ETIMEDOUT" when Disk Arbitration
 * didn't answer, or another errno name. `path` names the volume that failed, which with
 * `wholeDisk` may be another volume of the disk; `reason` carries Disk Arbitration's own
 * sentence when it gave one.
 *
 * Runs on a libuv thread pool thread: an unmount waits for the file system to finish
 * writing, and a network share that stopped answering can take long.
 */

#include <errno.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/ucred.h>

#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <dispatch/dispatch.h>

#include "native_errors.h"
#include "native_volumes.h"

#define DEV_PREFIX "/dev/"
/* Long enough for a slow disk to finish writing; a network share that stopped answering
 * fails rather than holding a thread forever. */
#define DA_TIMEOUT_SECONDS 120

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  int force;
  int whole_disk;
  /* On failure: the errno, the volume (or disk) that failed, and Disk Arbitration's
   * sentence when it gave one. */
  int errnum;
  char failed_path[MAXPATHLEN];
  char reason[512];
} eject_work_t;

typedef struct {
  dispatch_semaphore_t done;
  DAReturn status;
  char reason[512];
} da_result_t;

static void da_callback(DADiskRef disk, DADissenterRef dissenter, void *context) {
  (void)disk;
  da_result_t *result = (da_result_t *)context;
  result->status = dissenter ? DADissenterGetStatus(dissenter) : kDAReturnSuccess;
  result->reason[0] = '\0';
  if (dissenter) {
    CFStringRef text = DADissenterGetStatusString(dissenter);
    if (text) {
      CFStringGetCString(text, result->reason, sizeof result->reason, kCFStringEncodingUTF8);
    }
  }
  dispatch_semaphore_signal(result->done);
}

/* The errno a Disk Arbitration status stands for. A refusal for an open file comes as
 * unix_err(EBUSY), the system's errno wrapped. */
static int errno_of_status(DAReturn status) {
  if ((status & ~0x3fff) == 0xc000) {
    return status & 0x3fff;
  }
  switch (status) {
    case kDAReturnBusy:
    case kDAReturnExclusiveAccess:
      return EBUSY;
    case kDAReturnNotFound:
      return ENOENT;
    case kDAReturnNotPermitted:
      return EPERM;
    case kDAReturnNotPrivileged:
      return EACCES;
    case kDAReturnNotReady:
      return EAGAIN;
    case kDAReturnUnsupported:
      return ENOTSUP;
    default:
      return EIO;
  }
}

static void fail(eject_work_t *w, int errnum, const char *path, const char *reason) {
  w->errnum = errnum;
  strlcpy(w->failed_path, path, sizeof w->failed_path);
  strlcpy(w->reason, reason ? reason : "", sizeof w->reason);
}

static da_result_t *new_result(void) {
  da_result_t *result = (da_result_t *)calloc(1, sizeof(da_result_t));
  if (result) {
    result->done = dispatch_semaphore_create(0);
  }
  return result;
}

/* Waits for a request's callback; 0 on success, otherwise the failure is recorded. The
 * result is freed, except after a timeout: then the callback may still come and write to
 * it, so it is left to it. */
static int wait_for(eject_work_t *w, da_result_t *result, const char *path) {
  if (dispatch_semaphore_wait(result->done,
                              dispatch_time(DISPATCH_TIME_NOW,
                                            (int64_t)DA_TIMEOUT_SECONDS * NSEC_PER_SEC)) != 0) {
    fail(w, ETIMEDOUT, path, NULL);
    return -1;
  }
  int status = 0;
  if (result->status != kDAReturnSuccess) {
    fail(w, errno_of_status(result->status), path, result->reason);
    status = -1;
  }
  dispatch_release(result->done);
  free(result);
  return status;
}

static int unmount_volume(eject_work_t *w, DASessionRef session, const char *path) {
  CFURLRef url =
      CFURLCreateFromFileSystemRepresentation(kCFAllocatorDefault, (const UInt8 *)path,
                                              (CFIndex)strlen(path), true);
  DADiskRef disk = url ? DADiskCreateFromVolumePath(kCFAllocatorDefault, session, url) : NULL;
  if (url) {
    CFRelease(url);
  }
  if (!disk) {
    /* A mount Disk Arbitration doesn't know of. */
    if (unmount(path, w->force ? MNT_FORCE : 0) != 0) {
      fail(w, errno, path, NULL);
      return -1;
    }
    return 0;
  }
  da_result_t *result = new_result();
  if (!result) {
    CFRelease(disk);
    fail(w, ENOMEM, path, NULL);
    return -1;
  }
  DADiskUnmount(disk, w->force ? kDADiskUnmountOptionForce : kDADiskUnmountOptionDefault,
                da_callback, result);
  int status = wait_for(w, result, path);
  CFRelease(disk);
  return status;
}

static int eject_disk(eject_work_t *w, DASessionRef session, const char *bsd_name) {
  DADiskRef disk = DADiskCreateFromBSDName(kCFAllocatorDefault, session, bsd_name);
  if (!disk) {
    /* Gone with its volumes (a disk image can detach on its own). */
    return 0;
  }
  char path[MAXPATHLEN];
  snprintf(path, sizeof path, DEV_PREFIX "%s", bsd_name);
  da_result_t *result = new_result();
  if (!result) {
    CFRelease(disk);
    fail(w, ENOMEM, path, NULL);
    return -1;
  }
  DADiskEject(disk, kDADiskEjectOptionDefault, da_callback, result);
  int status = wait_for(w, result, path);
  CFRelease(disk);
  /* A drive that can't be ejected is let go of once its volumes are unmounted, as Finder
   * leaves it. */
  if (status != 0 && w->errnum == ENOTSUP) {
    w->errnum = 0;
    return 0;
  }
  return status;
}

static void eject(eject_work_t *w, DASessionRef session) {
  struct statfs mount;
  if (statfs(w->path, &mount) != 0 || strcmp(mount.f_mntonname, w->path) != 0) {
    fail(w, ENOENT, w->path, NULL);
    return;
  }
  const char *source = mount.f_mntfromname;
  char disk[64] = "";
  int ejectable = 0;
  if (!w->whole_disk || strncmp(source, DEV_PREFIX, strlen(DEV_PREFIX)) != 0 ||
      !volume_physical_disk(source + strlen(DEV_PREFIX), disk, sizeof disk, &ejectable)) {
    unmount_volume(w, session, w->path);
    return;
  }

  /* This volume first, so that a refusal names it when it is the one in use; then the
   * rest on its disk, wherever they are mounted. */
  if (unmount_volume(w, session, w->path) != 0) {
    return;
  }
  struct statfs *mounts = NULL;
  int count = getmntinfo(&mounts, MNT_NOWAIT);
  /* getmntinfo's buffer is reused by the next call: the paths are copied first. */
  char(*others)[MAXPATHLEN] = count > 0 ? calloc((size_t)count, MAXPATHLEN) : NULL;
  int other_count = 0;
  for (int i = 0; i < count && others; i++) {
    const char *other_source = mounts[i].f_mntfromname;
    char other_disk[64] = "";
    int other_ejectable = 0;
    if (strncmp(other_source, DEV_PREFIX, strlen(DEV_PREFIX)) == 0 &&
        volume_physical_disk(other_source + strlen(DEV_PREFIX), other_disk, sizeof other_disk,
                             &other_ejectable) &&
        strcmp(other_disk, disk) == 0) {
      strlcpy(others[other_count++], mounts[i].f_mntonname, MAXPATHLEN);
    }
  }
  for (int i = 0; i < other_count; i++) {
    if (unmount_volume(w, session, others[i]) != 0) {
      free(others);
      return;
    }
  }
  free(others);
  eject_disk(w, session, disk);
}

static void execute_eject(napi_env env, void *data) {
  (void)env;
  eject_work_t *w = (eject_work_t *)data;
  DASessionRef session = DASessionCreate(kCFAllocatorDefault);
  if (!session) {
    fail(w, EIO, w->path, NULL);
    return;
  }
  dispatch_queue_t queue = dispatch_queue_create("filetrail.eject", DISPATCH_QUEUE_SERIAL);
  DASessionSetDispatchQueue(session, queue);
  eject(w, session);
  DASessionSetDispatchQueue(session, NULL);
  CFRelease(session);
  dispatch_release(queue);
}

static void complete_eject(napi_env env, napi_status status, void *data) {
  eject_work_t *w = (eject_work_t *)data;
  if (status != napi_ok) {
    napi_reject_deferred(env, w->deferred, native_errno_error(env, EIO, "eject", w->path, NULL));
  } else if (w->errnum == 0) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, w->deferred, undefined);
  } else {
    napi_value error = native_errno_error(env, w->errnum, "eject", w->failed_path, NULL);
    if (w->reason[0] != '\0') {
      napi_value reason;
      napi_create_string_utf8(env, w->reason, NAPI_AUTO_LENGTH, &reason);
      napi_set_named_property(env, error, "reason", reason);
    }
    napi_reject_deferred(env, w->deferred, error);
  }
  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w);
}

static int option(napi_env env, napi_value options, const char *key) {
  napi_valuetype type;
  if (napi_typeof(env, options, &type) != napi_ok || type != napi_object) {
    return 0;
  }
  napi_value value;
  bool result = false;
  if (napi_get_named_property(env, options, key, &value) == napi_ok) {
    napi_get_value_bool(env, value, &result);
  }
  return result ? 1 : 0;
}

static napi_value native_eject_volume(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
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
  eject_work_t *w = (eject_work_t *)calloc(1, sizeof(eject_work_t));
  if (!path || !w) {
    free(path);
    free(w);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], path, length + 1, NULL);
  w->path = path;
  if (argc > 1) {
    w->force = option(env, argv[1], "force");
    w->whole_disk = option(env, argv[1], "wholeDisk");
  }

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeEjectVolume", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_eject, complete_eject, w, &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
}

napi_value register_eject(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "nativeEjectVolume", NAPI_AUTO_LENGTH, native_eject_volume, NULL,
                       &fn);
  napi_set_named_property(env, exports, "nativeEjectVolume", fn);
  return exports;
}
