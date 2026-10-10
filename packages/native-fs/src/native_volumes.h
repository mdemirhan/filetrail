/**
 * What the disk a volume is on can tell, shared by the volume list and Eject.
 */

#ifndef FILETRAIL_NATIVE_VOLUMES_H
#define FILETRAIL_NATIVE_VOLUMES_H

#include <stddef.h>

/*
 * The physical disk under `bsd_name` (a volume's device, "disk6s1"), as Finder ejects it:
 * the whole disk at the top of the media stack, past an APFS container's synthesized disk
 * to the disk holding its physical store ("disk5"). Writes its BSD name to `whole` and
 * whether Finder would offer to eject it to `*ejectable`: a disk that can be ejected or
 * removed, or one that isn't inside the Mac (an external drive, a disk image). Returns 0
 * when the device isn't found.
 */
int volume_physical_disk(const char *bsd_name, char *whole, size_t whole_size, int *ejectable);

#endif
