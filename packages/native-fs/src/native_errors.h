/**
 * Node.js-style errors for the native addon: `code` is the errno name ("ENOENT",
 * "ENOTSUP", ...), the same one Node's own fs functions would report, so callers can
 * treat native and JS failures alike.
 */

#ifndef FILETRAIL_NATIVE_ERRORS_H
#define FILETRAIL_NATIVE_ERRORS_H

#include <node_api.h>

/* The errno name for `errnum`, or "UNKNOWN" for a value this platform doesn't name. */
const char *native_errno_code(int errnum);

/*
 * Creates `Error("<CODE>: <strerror>, <syscall> '<path>'[ -> '<dest>']")` with `code`,
 * `errno`, `syscall`, `path` and (when given) `dest` properties. `dest` may be NULL.
 */
napi_value native_errno_error(napi_env env, int errnum, const char *syscall,
                              const char *path, const char *dest);

#endif
