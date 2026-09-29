/**
 * errno → Node.js-style error conversion shared by the addon's functions.
 *
 * The addon can't rely on libuv's uv_err_name (Electron doesn't guarantee the symbol
 * is exported to addons), so the names are listed here. Every errno macOS defines is
 * covered, which keeps codes such as ENOTSUP or EDQUOT from turning into "UNKNOWN".
 */

#include "native_errors.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ERRNO_NAME(name)                                                        \
  case name:                                                                    \
    return #name;

const char *native_errno_code(int errnum) {
  switch (errnum) {
    ERRNO_NAME(EPERM)
    ERRNO_NAME(ENOENT)
    ERRNO_NAME(ESRCH)
    ERRNO_NAME(EINTR)
    ERRNO_NAME(EIO)
    ERRNO_NAME(ENXIO)
    ERRNO_NAME(E2BIG)
    ERRNO_NAME(ENOEXEC)
    ERRNO_NAME(EBADF)
    ERRNO_NAME(ECHILD)
    ERRNO_NAME(EDEADLK)
    ERRNO_NAME(ENOMEM)
    ERRNO_NAME(EACCES)
    ERRNO_NAME(EFAULT)
    ERRNO_NAME(EBUSY)
    ERRNO_NAME(EEXIST)
    ERRNO_NAME(EXDEV)
    ERRNO_NAME(ENODEV)
    ERRNO_NAME(ENOTDIR)
    ERRNO_NAME(EISDIR)
    ERRNO_NAME(EINVAL)
    ERRNO_NAME(ENFILE)
    ERRNO_NAME(EMFILE)
    ERRNO_NAME(ENOTTY)
    ERRNO_NAME(ETXTBSY)
    ERRNO_NAME(EFBIG)
    ERRNO_NAME(ENOSPC)
    ERRNO_NAME(ESPIPE)
    ERRNO_NAME(EROFS)
    ERRNO_NAME(EMLINK)
    ERRNO_NAME(EPIPE)
    ERRNO_NAME(EDOM)
    ERRNO_NAME(ERANGE)
    ERRNO_NAME(EAGAIN)
    ERRNO_NAME(EINPROGRESS)
    ERRNO_NAME(EALREADY)
    ERRNO_NAME(ENOTSOCK)
    ERRNO_NAME(EDESTADDRREQ)
    ERRNO_NAME(EMSGSIZE)
    ERRNO_NAME(EPROTOTYPE)
    ERRNO_NAME(ENOPROTOOPT)
    ERRNO_NAME(EPROTONOSUPPORT)
    ERRNO_NAME(ENOTSUP)
    ERRNO_NAME(EAFNOSUPPORT)
    ERRNO_NAME(EADDRINUSE)
    ERRNO_NAME(EADDRNOTAVAIL)
    ERRNO_NAME(ENETDOWN)
    ERRNO_NAME(ENETUNREACH)
    ERRNO_NAME(ENETRESET)
    ERRNO_NAME(ECONNABORTED)
    ERRNO_NAME(ECONNRESET)
    ERRNO_NAME(ENOBUFS)
    ERRNO_NAME(EISCONN)
    ERRNO_NAME(ENOTCONN)
    ERRNO_NAME(ETIMEDOUT)
    ERRNO_NAME(ECONNREFUSED)
    ERRNO_NAME(ELOOP)
    ERRNO_NAME(ENAMETOOLONG)
    ERRNO_NAME(EHOSTDOWN)
    ERRNO_NAME(EHOSTUNREACH)
    ERRNO_NAME(ENOTEMPTY)
    ERRNO_NAME(EUSERS)
    ERRNO_NAME(EDQUOT)
    ERRNO_NAME(ESTALE)
    ERRNO_NAME(EREMOTE)
    ERRNO_NAME(ENOLCK)
    ERRNO_NAME(ENOSYS)
    ERRNO_NAME(EOVERFLOW)
    ERRNO_NAME(ECANCELED)
    ERRNO_NAME(EIDRM)
    ERRNO_NAME(ENOMSG)
    ERRNO_NAME(EILSEQ)
    ERRNO_NAME(EBADMSG)
    ERRNO_NAME(ENOLINK)
    ERRNO_NAME(EPROTO)
    ERRNO_NAME(EOPNOTSUPP)
#ifdef ENOTBLK
    ERRNO_NAME(ENOTBLK)
#endif
#ifdef ESOCKTNOSUPPORT
    ERRNO_NAME(ESOCKTNOSUPPORT)
#endif
#ifdef EPFNOSUPPORT
    ERRNO_NAME(EPFNOSUPPORT)
#endif
#ifdef ESHUTDOWN
    ERRNO_NAME(ESHUTDOWN)
#endif
#ifdef ETOOMANYREFS
    ERRNO_NAME(ETOOMANYREFS)
#endif
#ifdef EPROCLIM
    ERRNO_NAME(EPROCLIM)
#endif
#ifdef EBADRPC
    ERRNO_NAME(EBADRPC)
#endif
#ifdef ERPCMISMATCH
    ERRNO_NAME(ERPCMISMATCH)
#endif
#ifdef EPROGUNAVAIL
    ERRNO_NAME(EPROGUNAVAIL)
#endif
#ifdef EPROGMISMATCH
    ERRNO_NAME(EPROGMISMATCH)
#endif
#ifdef EPROCUNAVAIL
    ERRNO_NAME(EPROCUNAVAIL)
#endif
#ifdef EFTYPE
    ERRNO_NAME(EFTYPE)
#endif
#ifdef EAUTH
    ERRNO_NAME(EAUTH)
#endif
#ifdef ENEEDAUTH
    ERRNO_NAME(ENEEDAUTH)
#endif
#ifdef EPWROFF
    ERRNO_NAME(EPWROFF)
#endif
#ifdef EDEVERR
    ERRNO_NAME(EDEVERR)
#endif
#ifdef EBADEXEC
    ERRNO_NAME(EBADEXEC)
#endif
#ifdef EBADARCH
    ERRNO_NAME(EBADARCH)
#endif
#ifdef ESHLIBVERS
    ERRNO_NAME(ESHLIBVERS)
#endif
#ifdef EBADMACHO
    ERRNO_NAME(EBADMACHO)
#endif
#ifdef ENOATTR
    ERRNO_NAME(ENOATTR)
#endif
#ifdef EMULTIHOP
    ERRNO_NAME(EMULTIHOP)
#endif
#ifdef ENODATA
    ERRNO_NAME(ENODATA)
#endif
#ifdef ENOSR
    ERRNO_NAME(ENOSR)
#endif
#ifdef ENOSTR
    ERRNO_NAME(ENOSTR)
#endif
#ifdef ETIME
    ERRNO_NAME(ETIME)
#endif
#ifdef ENOPOLICY
    ERRNO_NAME(ENOPOLICY)
#endif
#ifdef ENOTRECOVERABLE
    ERRNO_NAME(ENOTRECOVERABLE)
#endif
#ifdef EOWNERDEAD
    ERRNO_NAME(EOWNERDEAD)
#endif
#ifdef EQFULL
    ERRNO_NAME(EQFULL)
#endif
  default:
    return "UNKNOWN";
  }
}

#undef ERRNO_NAME

static void set_string_property(napi_env env, napi_value object, const char *name,
                                const char *value) {
  napi_value js_value;
  if (napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &js_value) == napi_ok) {
    napi_set_named_property(env, object, name, js_value);
  }
}

napi_value native_errno_error(napi_env env, int errnum, const char *syscall,
                              const char *path, const char *dest) {
  const char *code = native_errno_code(errnum);
  const char *description = strerror(errnum);

  /* Sized from the actual strings: paths can be far longer than any fixed buffer. */
  int length = dest != NULL
                   ? snprintf(NULL, 0, "%s: %s, %s '%s' -> '%s'", code, description,
                              syscall, path, dest)
                   : snprintf(NULL, 0, "%s: %s, %s '%s'", code, description, syscall, path);
  char *message = length >= 0 ? (char *)malloc((size_t)length + 1) : NULL;
  if (message != NULL) {
    if (dest != NULL) {
      snprintf(message, (size_t)length + 1, "%s: %s, %s '%s' -> '%s'", code, description,
               syscall, path, dest);
    } else {
      snprintf(message, (size_t)length + 1, "%s: %s, %s '%s'", code, description, syscall,
               path);
    }
  }

  napi_value js_message;
  napi_create_string_utf8(env, message != NULL ? message : code, NAPI_AUTO_LENGTH,
                          &js_message);
  free(message);

  napi_value error;
  napi_create_error(env, NULL, js_message, &error);
  set_string_property(env, error, "code", code);
  set_string_property(env, error, "syscall", syscall);
  set_string_property(env, error, "path", path);
  if (dest != NULL) {
    set_string_property(env, error, "dest", dest);
  }
  napi_value errno_value;
  if (napi_create_int32(env, errnum, &errno_value) == napi_ok) {
    napi_set_named_property(env, error, "errno", errno_value);
  }
  return error;
}
