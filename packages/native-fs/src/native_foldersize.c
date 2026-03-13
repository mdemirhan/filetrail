/**
 * N-API async wrapper for recursive folder size calculation using fts(3).
 *
 * Exposes two functions:
 *   nativeFolderSize(path) → Promise<string>  — JSON with total + per-dir sizes
 *   nativeFolderSizeCancel() → void           — cancels active walk
 *
 * The walk runs on a libuv thread pool thread. At most one walk is active at a
 * time (enforced by the JS caller). Cancel sets a volatile flag checked each
 * iteration so the walk aborts quickly.
 */

#include <node_api.h>
#include <errno.h>
#include <fts.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct dir_entry {
  char *path;
  int64_t size_bytes;
  struct dir_entry *next;
} dir_entry_t;

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *root_path;
  volatile int cancelled;
  int errnum;
  int64_t total_bytes;
  dir_entry_t *dirs;     /* linked list of per-directory sizes */
  int dir_count;
} folder_size_work_t;

static folder_size_work_t *active_work = NULL;

/* ── Execute on libuv thread pool ────────────────────────────────── */

static void execute_folder_size(napi_env env, void *data) {
  (void)env;
  folder_size_work_t *w = (folder_size_work_t *)data;

  char *paths[2] = { w->root_path, NULL };
  FTS *fts = fts_open(paths, FTS_PHYSICAL | FTS_NOCHDIR | FTS_XDEV, NULL);
  if (!fts) {
    w->errnum = errno;
    return;
  }

  /*
   * Per-directory size accumulation strategy:
   * fts_read visits directories twice: FTS_D (pre-order) and FTS_DP (post-order).
   * We accumulate file sizes into the directory's fts_number field as we encounter
   * FTS_F entries (they are children of the current directory). When we see FTS_DP,
   * we record the accumulated size and propagate it to the parent.
   */
  FTSENT *ent;
  while ((ent = fts_read(fts)) != NULL) {
    if (w->cancelled) {
      break;
    }

    switch (ent->fts_info) {
    case FTS_F:
    case FTS_SL:
    case FTS_SLNONE:
    case FTS_DEFAULT: {
      int64_t file_size = (int64_t)ent->fts_statp->st_size;
      w->total_bytes += file_size;
      /* Accumulate into parent directory's fts_number */
      if (ent->fts_parent) {
        ent->fts_parent->fts_number += file_size;
      }
      break;
    }

    case FTS_DP: {
      /* Post-order directory visit: record this directory's total size */
      int64_t dir_size = (int64_t)ent->fts_number;

      /* Don't record the root itself — its total is w->total_bytes */
      if (ent->fts_level > 0) {
        dir_entry_t *entry = (dir_entry_t *)malloc(sizeof(dir_entry_t));
        if (entry) {
          entry->path = strdup(ent->fts_path);
          entry->size_bytes = dir_size;
          entry->next = w->dirs;
          w->dirs = entry;
          w->dir_count++;
        }
      }

      /* Propagate this directory's size to its parent */
      if (ent->fts_parent) {
        ent->fts_parent->fts_number += dir_size;
      }
      break;
    }

    case FTS_D:
      /* Pre-order: reset accumulator */
      ent->fts_number = 0;
      break;

    case FTS_DNR:
    case FTS_ERR:
      /* Permission errors or read errors: skip silently */
      break;

    default:
      break;
    }
  }

  fts_close(fts);
}

/* ── Build JSON result string ────────────────────────────────────── */

static char *build_json_result(folder_size_work_t *w) {
  /*
   * Estimate buffer size: ~100 bytes overhead + ~(avg_path_len + 30) per dir.
   * We'll dynamically grow if needed.
   */
  size_t buf_cap = 256 + (size_t)w->dir_count * 200;
  char *buf = (char *)malloc(buf_cap);
  if (!buf) return NULL;

  int written = snprintf(buf, buf_cap, "{\"total\":%lld,\"dirs\":{", (long long)w->total_bytes);
  size_t pos = (size_t)written;

  int first = 1;
  dir_entry_t *entry = w->dirs;
  while (entry) {
    /* Escape the path for JSON (only backslash and double-quote need escaping) */
    size_t path_len = strlen(entry->path);
    /* Worst case: every char needs escaping = 2x, plus key overhead ~30 bytes */
    size_t needed = pos + path_len * 2 + 40;
    if (needed >= buf_cap) {
      buf_cap = needed * 2;
      char *new_buf = (char *)realloc(buf, buf_cap);
      if (!new_buf) { free(buf); return NULL; }
      buf = new_buf;
    }

    if (!first) {
      buf[pos++] = ',';
    }
    first = 0;

    buf[pos++] = '"';
    for (size_t i = 0; i < path_len; i++) {
      char c = entry->path[i];
      if (c == '"' || c == '\\') {
        buf[pos++] = '\\';
      }
      buf[pos++] = c;
    }
    buf[pos++] = '"';
    buf[pos++] = ':';

    int num_written = snprintf(buf + pos, buf_cap - pos, "%lld", (long long)entry->size_bytes);
    pos += (size_t)num_written;

    entry = entry->next;
  }

  /* Ensure space for closing */
  if (pos + 3 >= buf_cap) {
    buf_cap = pos + 16;
    char *new_buf = (char *)realloc(buf, buf_cap);
    if (!new_buf) { free(buf); return NULL; }
    buf = new_buf;
  }
  buf[pos++] = '}';
  buf[pos++] = '}';
  buf[pos] = '\0';

  return buf;
}

/* ── Free directory entries ──────────────────────────────────────── */

static void free_dir_entries(dir_entry_t *head) {
  while (head) {
    dir_entry_t *next = head->next;
    free(head->path);
    free(head);
    head = next;
  }
}

/* ── Completion callback on main thread ──────────────────────────── */

static void complete_folder_size(napi_env env, napi_status status, void *data) {
  folder_size_work_t *w = (folder_size_work_t *)data;

  if (active_work == w) {
    active_work = NULL;
  }

  if (status == napi_cancelled || w->cancelled) {
    napi_value err_msg;
    napi_create_string_utf8(env, "Folder size calculation cancelled", NAPI_AUTO_LENGTH, &err_msg);
    napi_value error;
    napi_create_error(env, NULL, err_msg, &error);

    napi_value code_val;
    napi_create_string_utf8(env, "ECANCELLED", NAPI_AUTO_LENGTH, &code_val);
    napi_set_named_property(env, error, "code", code_val);

    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    const char *code;
    switch (w->errnum) {
    case ENOENT:  code = "ENOENT";  break;
    case EACCES:  code = "EACCES";  break;
    case EPERM:   code = "EPERM";   break;
    case ENOTDIR: code = "ENOTDIR"; break;
    default:      code = "UNKNOWN"; break;
    }

    char msg[512];
    snprintf(msg, sizeof(msg), "%s: folder size '%s'", code, w->root_path);

    napi_value err_msg;
    napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &err_msg);
    napi_value error;
    napi_create_error(env, NULL, err_msg, &error);

    napi_value code_val;
    napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_val);
    napi_set_named_property(env, error, "code", code_val);

    napi_value path_val;
    napi_create_string_utf8(env, w->root_path, NAPI_AUTO_LENGTH, &path_val);
    napi_set_named_property(env, error, "path", path_val);

    napi_reject_deferred(env, w->deferred, error);
  } else {
    char *json = build_json_result(w);
    if (json) {
      napi_value result;
      napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result);
      napi_resolve_deferred(env, w->deferred, result);
      free(json);
    } else {
      napi_value err_msg;
      napi_create_string_utf8(env, "Out of memory building result", NAPI_AUTO_LENGTH, &err_msg);
      napi_value error;
      napi_create_error(env, NULL, err_msg, &error);
      napi_reject_deferred(env, w->deferred, error);
    }
  }

  napi_delete_async_work(env, w->work);
  free_dir_entries(w->dirs);
  free(w->root_path);
  free(w);
}

/* ── JS entry: nativeFolderSize(path) → Promise<string> ──────────── */

static napi_value native_folder_size(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (argc < 1) {
    napi_throw_type_error(env, NULL, "nativeFolderSize requires 1 argument: path");
    return NULL;
  }

  size_t path_len;
  napi_get_value_string_utf8(env, argv[0], NULL, 0, &path_len);
  char *root_path = (char *)malloc(path_len + 1);
  if (!root_path) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], root_path, path_len + 1, NULL);

  folder_size_work_t *w = (folder_size_work_t *)calloc(1, sizeof(folder_size_work_t));
  if (!w) {
    free(root_path);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->root_path = root_path;
  w->cancelled = 0;
  w->errnum = 0;
  w->total_bytes = 0;
  w->dirs = NULL;
  w->dir_count = 0;

  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);

  napi_value resource_name;
  napi_create_string_utf8(env, "nativeFolderSize", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_folder_size,
                         complete_folder_size, w, &w->work);

  active_work = w;
  napi_queue_async_work(env, w->work);

  return promise;
}

/* ── JS entry: nativeFolderSizeCancel() → void ───────────────────── */

static napi_value native_folder_size_cancel(napi_env env, napi_callback_info info) {
  (void)info;
  (void)env;
  if (active_work) {
    active_work->cancelled = 1;
  }
  return NULL;
}

/* ── Registration (called from init in native_copyfile.c) ────────── */

napi_value register_folder_size(napi_env env, napi_value exports) {
  napi_value fn;

  napi_create_function(env, "nativeFolderSize", NAPI_AUTO_LENGTH,
                       native_folder_size, NULL, &fn);
  napi_set_named_property(env, exports, "nativeFolderSize", fn);

  napi_create_function(env, "nativeFolderSizeCancel", NAPI_AUTO_LENGTH,
                       native_folder_size_cancel, NULL, &fn);
  napi_set_named_property(env, exports, "nativeFolderSizeCancel", fn);

  return exports;
}
