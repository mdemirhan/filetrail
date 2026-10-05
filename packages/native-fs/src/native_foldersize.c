/**
 * N-API async wrapper for recursive folder size calculation.
 *
 * Uses macOS getattrlistbulk(2) with 4 parallel worker threads for maximum
 * throughput. getattrlistbulk returns metadata for all entries in a directory
 * in one syscall (avoiding per-file stat), and parallelism lets us walk
 * independent subtrees concurrently.
 *
 * Tracks four metrics per directory:
 *   - logical size (ATTR_FILE_DATALENGTH)
 *   - allocated disk bytes (ATTR_FILE_ALLOCSIZE)
 *   - file count (regular files + symlinks)
 *   - folder count (subfolders at any depth, packages included; a package's
 *     contents count too, as they are walked like any folder)
 *
 * Each folder is finished as soon as everything inside it has been walked: it
 * counts its own listing and each sub-folder not finished yet, and whichever
 * thread brings that count to zero adds the folder's totals into its parent's
 * and puts the folder on the finished list. JS takes from that list while the
 * walk runs; whatever is left on it when the walk ends comes with the result.
 *
 * Exposes four functions:
 *   nativeFolderSize(path) -> Promise<string>  -- JSON with totals + finished dirs not yet taken
 *   nativeFolderSizeTakeFinished() -> string | null -- JSON of dirs finished since the last take
 *   nativeFolderSizeCancel() -> void           -- cancels active walk
 *   nativeItemSize(path) -> Promise<object>    -- one item, counted as the walk counts it
 *
 * The walk runs on a libuv thread pool thread (which spawns worker pthreads
 * internally). At most one walk is active at a time (enforced by JS caller).
 * Cancel sets an atomic flag checked by all workers each iteration.
 */

#include <node_api.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/attr.h>
#include <sys/stat.h>
#include <sys/vnode.h>
#include <unistd.h>

#include "native_errors.h"

#define BULK_BUF_SIZE (256 * 1024)
#define NUM_THREADS 4

/* ── Per-directory stats (4 values) ──────────────────────────────── */

typedef struct {
  int64_t size_bytes;
  int64_t disk_bytes;
  int64_t file_count;
  int64_t folder_count;
} dir_stats_t;

/* ── Finished directories (for JSON building) ────────────────────── */

typedef struct dir_entry {
  char *path;
  dir_stats_t stats;
  struct dir_entry *next;
} dir_entry_t;

/* Folders finished and not yet handed to JS: workers add, the JS thread takes. */
typedef struct {
  pthread_mutex_t lock;
  dir_entry_t *head;
} finished_list_t;

/* Takes ownership of `path`. Returns 1 on success, 0 on allocation failure. */
static int finished_push(finished_list_t *list, char *path, dir_stats_t stats) {
  dir_entry_t *entry = malloc(sizeof(dir_entry_t));
  if (!entry) return 0;
  entry->path = path;
  entry->stats = stats;
  pthread_mutex_lock(&list->lock);
  entry->next = list->head;
  list->head = entry;
  pthread_mutex_unlock(&list->lock);
  return 1;
}

/* Everything on the list, which is left empty; the caller frees it. */
static dir_entry_t *finished_take(finished_list_t *list) {
  pthread_mutex_lock(&list->lock);
  dir_entry_t *head = list->head;
  list->head = NULL;
  pthread_mutex_unlock(&list->lock);
  return head;
}

static void free_dir_entries(dir_entry_t *head) {
  while (head) {
    dir_entry_t *next = head->next;
    free(head->path);
    free(head);
    head = next;
  }
}

/* ── A folder being walked ───────────────────────────────────────── */

typedef struct walk_dir {
  char *path;              /* owned until the folder is finished, then the finished list's */
  struct walk_dir *parent; /* NULL for the root */
  /* Its own listing, plus each sub-folder not finished yet: zero once all is counted. */
  atomic_int pending;
  /* Its own files and folders, plus the totals of each finished sub-folder. */
  _Atomic int64_t size_bytes;
  _Atomic int64_t disk_bytes;
  _Atomic int64_t file_count;
  _Atomic int64_t folder_count;
  /* The list of folders the creating thread made, all freed when the walk ends: one
     that never finishes (the walk stopped) has no one else to free it. */
  struct walk_dir *next_allocated;
} walk_dir_t;

/* Takes ownership of `path` (freed here on failure). NULL on allocation failure. */
static walk_dir_t *walk_dir_new(char *path, walk_dir_t *parent) {
  walk_dir_t *dir = malloc(sizeof(walk_dir_t));
  if (!dir) {
    free(path);
    return NULL;
  }
  dir->path = path;
  dir->parent = parent;
  atomic_init(&dir->pending, 1);
  atomic_init(&dir->size_bytes, 0);
  atomic_init(&dir->disk_bytes, 0);
  atomic_init(&dir->file_count, 0);
  atomic_init(&dir->folder_count, 0);
  dir->next_allocated = NULL;
  return dir;
}

static void walk_dirs_free(walk_dir_t *head) {
  while (head) {
    walk_dir_t *next = head->next_allocated;
    free(head->path);
    free(head);
    head = next;
  }
}

/* ── Concurrent work queue ───────────────────────────────────────── */

typedef struct dir_node {
  int fd;
  walk_dir_t *dir; /* not owned: freed with its thread's allocations */
  struct dir_node *next;
} dir_node_t;

typedef struct {
  dir_node_t *head;
  pthread_mutex_t lock;
  atomic_int active;       /* threads currently processing a directory */
  pthread_cond_t cond;
  int finished;
  dev_t root_dev;
  atomic_int *cancelled;
  atomic_int failed;       /* set on allocation failure; walk aborts with ENOMEM */
} work_queue_t;

static void wq_init(work_queue_t *wq, dev_t dev, atomic_int *cancelled) {
  wq->head = NULL;
  pthread_mutex_init(&wq->lock, NULL);
  atomic_store(&wq->active, 0);
  pthread_cond_init(&wq->cond, NULL);
  wq->finished = 0;
  wq->root_dev = dev;
  wq->cancelled = cancelled;
  atomic_store(&wq->failed, 0);
}

/* Abort the walk: all workers stop at the next cancelled/failed check. */
static void wq_fail(work_queue_t *wq) {
  atomic_store(&wq->failed, 1);
  pthread_mutex_lock(&wq->lock);
  pthread_cond_broadcast(&wq->cond);
  pthread_mutex_unlock(&wq->lock);
}

/* Whether the walk was cancelled or failed: what it has counted since may be partial. */
static int wq_stopped(work_queue_t *wq) {
  return atomic_load(wq->cancelled) || atomic_load(&wq->failed);
}

/* Returns 1 on success (queue owns fd), 0 on allocation failure. */
static int wq_push(work_queue_t *wq, int fd, walk_dir_t *dir) {
  dir_node_t *node = malloc(sizeof(dir_node_t));
  if (!node) return 0;
  node->fd = fd;
  node->dir = dir;
  pthread_mutex_lock(&wq->lock);
  node->next = wq->head;
  wq->head = node;
  pthread_cond_signal(&wq->cond);
  pthread_mutex_unlock(&wq->lock);
  return 1;
}

/* Returns 1 and fills fd_out/dir_out on success, 0 when all work is done. */
static int wq_pop(work_queue_t *wq, int *fd_out, walk_dir_t **dir_out) {
  pthread_mutex_lock(&wq->lock);
  for (;;) {
    if (wq_stopped(wq) || wq->finished) {
      pthread_mutex_unlock(&wq->lock);
      return 0;
    }
    if (wq->head) {
      dir_node_t *node = wq->head;
      wq->head = node->next;
      *fd_out = node->fd;
      *dir_out = node->dir;
      free(node);
      atomic_fetch_add(&wq->active, 1);
      pthread_mutex_unlock(&wq->lock);
      return 1;
    }
    if (atomic_load(&wq->active) == 0) {
      wq->finished = 1;
      pthread_cond_broadcast(&wq->cond);
      pthread_mutex_unlock(&wq->lock);
      return 0;
    }
    pthread_cond_wait(&wq->cond, &wq->lock);
  }
}

static void wq_done(work_queue_t *wq) {
  if (atomic_fetch_sub(&wq->active, 1) == 1) {
    pthread_mutex_lock(&wq->lock);
    pthread_cond_broadcast(&wq->cond);
    pthread_mutex_unlock(&wq->lock);
  }
}

static void wq_destroy(work_queue_t *wq) {
  dir_node_t *n = wq->head;
  while (n) {
    dir_node_t *next = n->next;
    close(n->fd);
    free(n);
    n = next;
  }
  pthread_mutex_destroy(&wq->lock);
  pthread_cond_destroy(&wq->cond);
}

/* ── Shared attrlist (read-only, safe across threads) ────────────── */

static struct attrlist g_attrlist;
static pthread_once_t g_attrlist_once = PTHREAD_ONCE_INIT;

static void init_attrlist(void) {
  memset(&g_attrlist, 0, sizeof(g_attrlist));
  g_attrlist.bitmapcount = ATTR_BIT_MAP_COUNT;
  /* Attributes returned in bitmap bit order (lowest first):
     ATTR_CMN_NAME (bit 0), then ATTR_CMN_OBJTYPE (bit 3). */
  g_attrlist.commonattr = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_OBJTYPE;
  /* File attrs in bit order: ATTR_FILE_ALLOCSIZE (bit 2, 0x04)
     then ATTR_FILE_DATALENGTH (bit 9, 0x200). */
  g_attrlist.fileattr = ATTR_FILE_ALLOCSIZE | ATTR_FILE_DATALENGTH;
}

/* ── Worker thread state ─────────────────────────────────────────── */

typedef struct {
  work_queue_t *wq;
  finished_list_t *finished;
  int64_t total_bytes;
  int64_t total_disk_bytes;
  int64_t total_file_count;
  int64_t total_folder_count;
  walk_dir_t *allocated; /* the folders this thread made */
} thread_arg_t;

/* ── Process one directory with getattrlistbulk ──────────────────── */

typedef struct {
  int64_t direct_bytes;
  int64_t direct_disk_bytes;
  int64_t direct_file_count;
  int64_t direct_folder_count;
} process_dir_result_t;

/* Lists `dir` and queues its sub-folders on the same disk; adds what is directly in it
   to its totals. */
static process_dir_result_t process_dir(int dirfd, walk_dir_t *dir, thread_arg_t *ta,
                                        char *buf) {
  work_queue_t *wq = ta->wq;
  const char *dir_path = dir->path;
  int64_t direct_bytes = 0;
  int64_t direct_disk_bytes = 0;
  int64_t direct_file_count = 0;
  int64_t direct_folder_count = 0;

  for (;;) {
    if (wq_stopped(wq)) break;

    int count = getattrlistbulk(dirfd, &g_attrlist, buf, BULK_BUF_SIZE, 0);
    if (count <= 0) break;

    char *ptr = buf;
    for (int i = 0; i < count; i++) {
      uint32_t entry_len = *(uint32_t *)ptr;
      char *p = ptr + sizeof(uint32_t);

      /* attribute_set_t (20 bytes, always first) */
      attribute_set_t returned;
      memcpy(&returned, p, sizeof(returned));
      p += sizeof(returned);

      /* ATTR_CMN_NAME (bit 0) -- attrreference_t (8 bytes) */
      const char *name = NULL;
      char *name_ref_start = p;
      if (returned.commonattr & ATTR_CMN_NAME) {
        attrreference_t name_ref;
        memcpy(&name_ref, p, sizeof(name_ref));
        name = name_ref_start + name_ref.attr_dataoffset;
        p += sizeof(name_ref);
      }

      /* ATTR_CMN_OBJTYPE (bit 3) -- uint32_t */
      uint32_t obj_type = 0;
      if (returned.commonattr & ATTR_CMN_OBJTYPE) {
        memcpy(&obj_type, p, sizeof(obj_type));
        p += sizeof(obj_type);
      }

      /* File attrs in bit order: ALLOCSIZE (bit 2) then DATALENGTH (bit 9) */
      int64_t alloc_size = 0;
      if (returned.fileattr & ATTR_FILE_ALLOCSIZE) {
        memcpy(&alloc_size, p, sizeof(alloc_size));
        p += sizeof(alloc_size);
      }

      int64_t data_size = 0;
      if (returned.fileattr & ATTR_FILE_DATALENGTH) {
        memcpy(&data_size, p, sizeof(data_size));
        p += sizeof(data_size);
      }

      /* Skip . and .. */
      if (name && name[0] == '.' &&
          (name[1] == '\0' || (name[1] == '.' && name[2] == '\0'))) {
        ptr += entry_len;
        continue;
      }

      if (obj_type == VREG || obj_type == VLNK) {
        direct_bytes += data_size;
        direct_disk_bytes += alloc_size;
        direct_file_count++;
      } else if (obj_type == VDIR && name) {
        /* Counted even when it isn't walked (another volume, no access). */
        direct_folder_count++;
        int subfd = openat(dirfd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (subfd >= 0) {
          struct stat sub_stat;
          if (fstat(subfd, &sub_stat) == 0 && sub_stat.st_dev == wq->root_dev) {
            /* Build child path: dir_path + "/" + name */
            size_t dir_len = strlen(dir_path);
            size_t name_len = strlen(name);
            char *child_path = malloc(dir_len + 1 + name_len + 1);
            walk_dir_t *child = NULL;
            if (child_path) {
              memcpy(child_path, dir_path, dir_len);
              child_path[dir_len] = '/';
              memcpy(child_path + dir_len + 1, name, name_len + 1);
              child = walk_dir_new(child_path, dir);
            }
            if (!child) {
              close(subfd);
              wq_fail(wq);
            } else {
              child->next_allocated = ta->allocated;
              ta->allocated = child;
              /* Counted before it is queued, so it can't finish before it is waited for. */
              atomic_fetch_add(&dir->pending, 1);
              if (!wq_push(wq, subfd, child)) {
                close(subfd);
                wq_fail(wq);
              }
            }
          } else {
            close(subfd);
          }
        }
      }

      ptr += entry_len;
    }
  }

  close(dirfd);
  atomic_fetch_add(&dir->size_bytes, direct_bytes);
  atomic_fetch_add(&dir->disk_bytes, direct_disk_bytes);
  atomic_fetch_add(&dir->file_count, direct_file_count);
  atomic_fetch_add(&dir->folder_count, direct_folder_count);

  process_dir_result_t result;
  result.direct_bytes = direct_bytes;
  result.direct_disk_bytes = direct_disk_bytes;
  result.direct_file_count = direct_file_count;
  result.direct_folder_count = direct_folder_count;
  return result;
}

/* Marks one part of `dir` done: its own listing, or a sub-folder. The part that finishes
   the folder puts it on the finished list and adds its totals into its parent's, which
   is one part of the parent done in turn. Once the walk has stopped nothing more is
   finished, as a listing cut short may have counted only part of a folder. */
static void finish_part(thread_arg_t *ta, walk_dir_t *dir) {
  while (atomic_fetch_sub(&dir->pending, 1) == 1) {
    walk_dir_t *parent = dir->parent;
    /* The root's totals are the result. */
    if (!parent || wq_stopped(ta->wq)) {
      return;
    }
    dir_stats_t stats;
    stats.size_bytes = atomic_load(&dir->size_bytes);
    stats.disk_bytes = atomic_load(&dir->disk_bytes);
    stats.file_count = atomic_load(&dir->file_count);
    stats.folder_count = atomic_load(&dir->folder_count);
    if (!finished_push(ta->finished, dir->path, stats)) {
      wq_fail(ta->wq);
      return;
    }
    dir->path = NULL;
    atomic_fetch_add(&parent->size_bytes, stats.size_bytes);
    atomic_fetch_add(&parent->disk_bytes, stats.disk_bytes);
    atomic_fetch_add(&parent->file_count, stats.file_count);
    atomic_fetch_add(&parent->folder_count, stats.folder_count);
    dir = parent;
  }
}

/* ── Worker thread ───────────────────────────────────────────────── */

static void *worker_fn(void *arg) {
  thread_arg_t *ta = (thread_arg_t *)arg;
  char *buf = malloc(BULK_BUF_SIZE);
  if (!buf) {
    /* Never popped anything, so queue accounting is untouched; flag the
       failure so the whole walk aborts with ENOMEM instead of silently
       running with fewer workers. */
    wq_fail(ta->wq);
    return NULL;
  }

  int fd;
  walk_dir_t *dir;
  while (wq_pop(ta->wq, &fd, &dir)) {
    process_dir_result_t r = process_dir(fd, dir, ta, buf);
    ta->total_bytes += r.direct_bytes;
    ta->total_disk_bytes += r.direct_disk_bytes;
    ta->total_file_count += r.direct_file_count;
    ta->total_folder_count += r.direct_folder_count;
    finish_part(ta, dir);
    wq_done(ta->wq);
  }

  free(buf);
  return NULL;
}

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *root_path;
  atomic_int cancelled; /* written from the JS thread, read by worker pthreads */
  int errnum;
  int64_t total_bytes;
  int64_t disk_total;
  int64_t total_file_count;
  int64_t total_folder_count;
  /* The disk walked: the walk never leaves it. Set before any worker starts, so a
     folder on the finished list was put there after it was set. */
  int64_t dev;
  finished_list_t finished;
} folder_size_work_t;

static folder_size_work_t *active_work = NULL;

/* ── Execute on libuv thread pool (spawns worker pthreads) ───────── */

static void execute_folder_size(napi_env env, void *data) {
  (void)env;
  folder_size_work_t *w = (folder_size_work_t *)data;

  pthread_once(&g_attrlist_once, init_attrlist);

  int root_fd = open(w->root_path, O_RDONLY | O_DIRECTORY);
  if (root_fd < 0) {
    w->errnum = errno;
    return;
  }

  struct stat root_stat;
  if (fstat(root_fd, &root_stat) != 0) {
    w->errnum = errno;
    close(root_fd);
    return;
  }

  w->dev = (int64_t)root_stat.st_dev;
  char *root_path = strdup(w->root_path);
  walk_dir_t *root = root_path ? walk_dir_new(root_path, NULL) : NULL;
  if (!root) {
    w->errnum = ENOMEM;
    close(root_fd);
    return;
  }
  work_queue_t wq;
  wq_init(&wq, root_stat.st_dev, &w->cancelled);
  if (!wq_push(&wq, root_fd, root)) {
    w->errnum = ENOMEM;
    close(root_fd);
    wq_destroy(&wq);
    walk_dirs_free(root);
    return;
  }

  /* Spawn worker threads. */
  thread_arg_t args[NUM_THREADS];
  pthread_t threads[NUM_THREADS];
  for (int i = 0; i < NUM_THREADS; i++) {
    args[i].wq = &wq;
    args[i].finished = &w->finished;
    args[i].total_bytes = 0;
    args[i].total_disk_bytes = 0;
    args[i].total_file_count = 0;
    args[i].total_folder_count = 0;
    args[i].allocated = NULL;
    pthread_create(&threads[i], NULL, worker_fn, &args[i]);
  }

  /* Wait for all workers to finish. */
  for (int i = 0; i < NUM_THREADS; i++) {
    pthread_join(threads[i], NULL);
  }

  /* Sum totals from all threads. */
  w->total_bytes = 0;
  w->disk_total = 0;
  w->total_file_count = 0;
  w->total_folder_count = 0;
  for (int i = 0; i < NUM_THREADS; i++) {
    w->total_bytes += args[i].total_bytes;
    w->disk_total += args[i].total_disk_bytes;
    w->total_file_count += args[i].total_file_count;
    w->total_folder_count += args[i].total_folder_count;
  }

  if (atomic_load(&wq.failed)) {
    w->errnum = ENOMEM;
  }

  for (int i = 0; i < NUM_THREADS; i++) {
    walk_dirs_free(args[i].allocated);
  }
  walk_dirs_free(root);
  wq_destroy(&wq);
}

/* ── Build JSON ──────────────────────────────────────────────────── */

typedef struct {
  char *data;
  size_t length;
  size_t capacity;
} json_buf_t;

/* Returns 1 on success, 0 on allocation failure (the buffer is then freed). */
static int jb_reserve(json_buf_t *b, size_t extra) {
  if (b->length + extra < b->capacity) return 1;
  size_t capacity = (b->length + extra) * 2;
  char *data = realloc(b->data, capacity);
  if (!data) {
    free(b->data);
    b->data = NULL;
    return 0;
  }
  b->data = data;
  b->capacity = capacity;
  return 1;
}

/* Appends `"dirs":{"path":[N,N,N,N],...}` and the closing brace of the object. */
static int jb_append_dirs_and_close(json_buf_t *b, const dir_entry_t *entry) {
  static const char hex[] = "0123456789abcdef";
  if (!jb_reserve(b, 16)) return 0;
  b->length += (size_t)snprintf(b->data + b->length, b->capacity - b->length, "\"dirs\":{");
  int first = 1;
  for (; entry; entry = entry->next) {
    size_t path_len = strlen(entry->path);
    /* Every byte may need a 6-byte \u00XX escape; then 4 numbers. */
    if (!jb_reserve(b, path_len * 6 + 120)) return 0;
    if (!first) b->data[b->length++] = ',';
    first = 0;
    b->data[b->length++] = '"';
    for (size_t i = 0; i < path_len; i++) {
      unsigned char c = (unsigned char)entry->path[i];
      if (c == '"' || c == '\\') {
        b->data[b->length++] = '\\';
        b->data[b->length++] = (char)c;
      } else if (c < 0x20) {
        /* A newline or other control character in a name. */
        memcpy(b->data + b->length, "\\u00", 4);
        b->data[b->length + 4] = hex[c >> 4];
        b->data[b->length + 5] = hex[c & 0xf];
        b->length += 6;
      } else {
        b->data[b->length++] = (char)c;
      }
    }
    b->length += (size_t)snprintf(b->data + b->length, b->capacity - b->length,
                                  "\":[%lld,%lld,%lld,%lld]",
                                  (long long)entry->stats.size_bytes,
                                  (long long)entry->stats.disk_bytes,
                                  (long long)entry->stats.file_count,
                                  (long long)entry->stats.folder_count);
  }
  if (!jb_reserve(b, 3)) return 0;
  b->data[b->length++] = '}';
  b->data[b->length++] = '}';
  b->data[b->length] = '\0';
  return 1;
}

/* `{"total":N,"diskTotal":N,"fileCount":N,"folderCount":N,"dev":N,"dirs":{...}}`, with
   the finished folders not yet taken. NULL on allocation failure. */
static char *build_result_json(folder_size_work_t *w, const dir_entry_t *dirs) {
  json_buf_t b = {NULL, 0, 0};
  if (!jb_reserve(&b, 512)) return NULL;
  b.length = (size_t)snprintf(b.data, b.capacity,
    "{\"total\":%lld,\"diskTotal\":%lld,\"fileCount\":%lld,\"folderCount\":%lld,\"dev\":%lld,",
    (long long)w->total_bytes,
    (long long)w->disk_total,
    (long long)w->total_file_count,
    (long long)w->total_folder_count,
    (long long)w->dev);
  return jb_append_dirs_and_close(&b, dirs) ? b.data : NULL;
}

/* `{"dev":N,"dirs":{...}}`. NULL on allocation failure. */
static char *build_finished_json(int64_t dev, const dir_entry_t *dirs) {
  json_buf_t b = {NULL, 0, 0};
  if (!jb_reserve(&b, 64)) return NULL;
  b.length = (size_t)snprintf(b.data, b.capacity, "{\"dev\":%lld,", (long long)dev);
  return jb_append_dirs_and_close(&b, dirs) ? b.data : NULL;
}

/* ── Completion callback on main thread ──────────────────────────── */

static void complete_folder_size(napi_env env, napi_status status, void *data) {
  folder_size_work_t *w = (folder_size_work_t *)data;

  if (active_work == w) {
    active_work = NULL;
  }

  /* Folders finished and not taken yet: every one was finished before the walk stopped,
     so each is whole even when the walk was cancelled. */
  dir_entry_t *leftover = finished_take(&w->finished);

  if (status == napi_cancelled || atomic_load(&w->cancelled)) {
    napi_value err_msg;
    napi_create_string_utf8(env, "Folder size calculation cancelled", NAPI_AUTO_LENGTH, &err_msg);
    napi_value error;
    napi_create_error(env, NULL, err_msg, &error);

    napi_value code_val;
    napi_create_string_utf8(env, "ECANCELLED", NAPI_AUTO_LENGTH, &code_val);
    napi_set_named_property(env, error, "code", code_val);

    if (leftover && w->errnum == 0) {
      char *json = build_finished_json(w->dev, leftover);
      if (json) {
        napi_value dirs_val;
        napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &dirs_val);
        napi_set_named_property(env, error, "finished", dirs_val);
        free(json);
      }
    }

    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_value error = native_errno_error(env, w->errnum, "folder size", w->root_path, NULL);

    napi_reject_deferred(env, w->deferred, error);
  } else {
    char *json = build_result_json(w, leftover);
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
  free_dir_entries(leftover);
  pthread_mutex_destroy(&w->finished.lock);
  free(w->root_path);
  free(w);
}

/* ── JS entry: nativeFolderSize(path) -> Promise<string> ──────────── */

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
  atomic_init(&w->cancelled, 0);
  pthread_mutex_init(&w->finished.lock, NULL);
  w->finished.head = NULL;

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

/* ── JS entry: nativeFolderSizeTakeFinished() -> string | null ────── */

/* The folders the active walk has finished since the last take, as
   `{"dev":N,"dirs":{...}}`, or null when there are none (or no walk is active). */
static napi_value native_folder_size_take_finished(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_get_null(env, &result);
  if (!active_work) {
    return result;
  }
  dir_entry_t *dirs = finished_take(&active_work->finished);
  if (!dirs) {
    return result;
  }
  char *json = build_finished_json(active_work->dev, dirs);
  free_dir_entries(dirs);
  if (!json) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result);
  free(json);
  return result;
}

/* ── JS entry: nativeFolderSizeCancel() -> void ───────────────────── */

static napi_value native_folder_size_cancel(napi_env env, napi_callback_info info) {
  (void)info;
  (void)env;
  if (active_work) {
    atomic_store(&active_work->cancelled, 1);
  }
  return NULL;
}

/* ── JS entry: nativeItemSize(path) -> Promise<object> ─────────────── */

/*
 * One item as the walk counts it inside its folder, so a folder's size can be adjusted
 * when the item is removed: a file or symlink (not followed) by its data length and
 * allocated size, a folder only as one (its contents are the walk's), anything else not
 * at all. Resolves { kind: "file" | "folder" | "other", sizeBytes, diskBytes, dev }.
 */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *path;
  int errnum;
  int kind; /* 0 other, 1 file, 2 folder */
  int64_t size_bytes;
  int64_t disk_bytes;
  int64_t dev;
} item_size_work_t;

static void execute_item_size(napi_env env, void *data) {
  (void)env;
  item_size_work_t *w = (item_size_work_t *)data;
  struct stat info;
  if (lstat(w->path, &info) != 0) {
    w->errnum = errno;
    return;
  }
  w->dev = (int64_t)info.st_dev;
  if (S_ISDIR(info.st_mode)) {
    w->kind = 2;
    return;
  }
  if (!S_ISREG(info.st_mode) && !S_ISLNK(info.st_mode)) {
    w->kind = 0;
    return;
  }
  w->kind = 1;
  /* The same attributes the walk reads, in bitmap bit order: ALLOCSIZE, then DATALENGTH. */
  struct attrlist list;
  memset(&list, 0, sizeof(list));
  list.bitmapcount = ATTR_BIT_MAP_COUNT;
  list.fileattr = ATTR_FILE_ALLOCSIZE | ATTR_FILE_DATALENGTH;
  struct {
    uint32_t length;
    off_t alloc_size;
    off_t data_length;
  } __attribute__((aligned(4), packed)) buf;
  if (getattrlist(w->path, &list, &buf, sizeof(buf), FSOPT_NOFOLLOW) != 0) {
    w->errnum = errno;
    return;
  }
  w->disk_bytes = (int64_t)buf.alloc_size;
  w->size_bytes = (int64_t)buf.data_length;
}

static void complete_item_size(napi_env env, napi_status status, void *data) {
  item_size_work_t *w = (item_size_work_t *)data;
  if (status == napi_cancelled) {
    napi_value message;
    napi_create_string_utf8(env, "Operation cancelled", NAPI_AUTO_LENGTH, &message);
    napi_value error;
    napi_create_error(env, NULL, message, &error);
    napi_reject_deferred(env, w->deferred, error);
  } else if (w->errnum != 0) {
    napi_reject_deferred(env, w->deferred,
                         native_errno_error(env, w->errnum, "item size", w->path, NULL));
  } else {
    static const char *kinds[] = {"other", "file", "folder"};
    napi_value result;
    napi_value value;
    napi_create_object(env, &result);
    napi_create_string_utf8(env, kinds[w->kind], NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, result, "kind", value);
    napi_create_int64(env, w->size_bytes, &value);
    napi_set_named_property(env, result, "sizeBytes", value);
    napi_create_int64(env, w->disk_bytes, &value);
    napi_set_named_property(env, result, "diskBytes", value);
    napi_create_int64(env, w->dev, &value);
    napi_set_named_property(env, result, "dev", value);
    napi_resolve_deferred(env, w->deferred, result);
  }
  napi_delete_async_work(env, w->work);
  free(w->path);
  free(w);
}

static napi_value native_item_size(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "nativeItemSize requires 1 argument: path");
    return NULL;
  }
  size_t length;
  if (napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
    napi_throw_type_error(env, NULL, "path must be a string");
    return NULL;
  }
  char *path = (char *)malloc(length + 1);
  if (!path) {
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  napi_get_value_string_utf8(env, argv[0], path, length + 1, NULL);
  item_size_work_t *w = (item_size_work_t *)calloc(1, sizeof(item_size_work_t));
  if (!w) {
    free(path);
    napi_throw_error(env, NULL, "Out of memory");
    return NULL;
  }
  w->path = path;
  napi_value promise;
  napi_create_promise(env, &w->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "nativeItemSize", NAPI_AUTO_LENGTH, &resource_name);
  napi_create_async_work(env, NULL, resource_name, execute_item_size, complete_item_size, w,
                         &w->work);
  napi_queue_async_work(env, w->work);
  return promise;
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

  napi_create_function(env, "nativeFolderSizeTakeFinished", NAPI_AUTO_LENGTH,
                       native_folder_size_take_finished, NULL, &fn);
  napi_set_named_property(env, exports, "nativeFolderSizeTakeFinished", fn);

  napi_create_function(env, "nativeItemSize", NAPI_AUTO_LENGTH, native_item_size, NULL, &fn);
  napi_set_named_property(env, exports, "nativeItemSize", fn);

  return exports;
}
