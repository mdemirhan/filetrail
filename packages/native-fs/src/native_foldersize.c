/**
 * N-API async wrapper for recursive folder size calculation.
 *
 * Uses macOS getattrlistbulk(2) with 4 parallel worker threads for maximum
 * throughput. getattrlistbulk returns metadata for all entries in a directory
 * in one syscall (avoiding per-file stat), and parallelism lets us walk
 * independent subtrees concurrently.
 *
 * Tracks three metrics per directory:
 *   - logical size (ATTR_FILE_DATALENGTH)
 *   - allocated disk bytes (ATTR_FILE_ALLOCSIZE)
 *   - file count (regular files + symlinks)
 *
 * Exposes two functions:
 *   nativeFolderSize(path) -> Promise<string>  -- JSON with totals + per-dir stats
 *   nativeFolderSizeCancel() -> void           -- cancels active walk
 *
 * The walk runs on a libuv thread pool thread (which spawns worker pthreads
 * internally). At most one walk is active at a time (enforced by JS caller).
 * Cancel sets a volatile flag checked by all workers each iteration.
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

#define BULK_BUF_SIZE (256 * 1024)
#define NUM_THREADS 4

/* ── Per-directory stats (3 values) ──────────────────────────────── */

typedef struct {
  int64_t size_bytes;
  int64_t disk_bytes;
  int64_t file_count;
} dir_stats_t;

/* ── Output linked list (for JSON building) ──────────────────────── */

typedef struct dir_entry {
  char *path;
  dir_stats_t stats;
  struct dir_entry *next;
} dir_entry_t;

/* ── Per-directory record (thread-local collection) ──────────────── */

typedef struct {
  char *path;
  int64_t direct_bytes;      /* logical bytes of files directly in this directory */
  int64_t direct_disk_bytes; /* allocated bytes of files directly in this directory */
  int64_t direct_file_count; /* number of files directly in this directory */
} dir_record_t;

typedef struct {
  dir_record_t *items;
  int count;
  int capacity;
} dir_record_list_t;

static void drl_init(dir_record_list_t *l) {
  l->items = NULL;
  l->count = 0;
  l->capacity = 0;
}

static void drl_push(dir_record_list_t *l, const char *path,
                     int64_t bytes, int64_t disk_bytes, int64_t file_count) {
  if (l->count == l->capacity) {
    l->capacity = l->capacity ? l->capacity * 2 : 256;
    l->items = realloc(l->items, (size_t)l->capacity * sizeof(dir_record_t));
  }
  l->items[l->count].path = strdup(path);
  l->items[l->count].direct_bytes = bytes;
  l->items[l->count].direct_disk_bytes = disk_bytes;
  l->items[l->count].direct_file_count = file_count;
  l->count++;
}

static void drl_free_contents(dir_record_list_t *l) {
  for (int i = 0; i < l->count; i++) free(l->items[i].path);
  free(l->items);
}

/* ── Hash map for bottom-up aggregation ──────────────────────────── */

typedef struct hm_node {
  char *key;
  dir_stats_t value;
  struct hm_node *next;
} hm_node_t;

typedef struct {
  hm_node_t **buckets;
  int num_buckets;
} hash_map_t;

static uint64_t fnv1a(const char *s) {
  uint64_t h = 0xcbf29ce484222325ULL;
  while (*s) {
    h ^= (uint8_t)*s++;
    h *= 0x100000001b3ULL;
  }
  return h;
}

static void hm_init(hash_map_t *hm, int num_buckets) {
  hm->num_buckets = num_buckets;
  hm->buckets = calloc((size_t)num_buckets, sizeof(hm_node_t *));
}

static dir_stats_t *hm_get_or_insert(hash_map_t *hm, const char *key) {
  int idx = (int)(fnv1a(key) % (uint64_t)hm->num_buckets);
  hm_node_t *n = hm->buckets[idx];
  while (n) {
    if (strcmp(n->key, key) == 0) return &n->value;
    n = n->next;
  }
  n = malloc(sizeof(hm_node_t));
  n->key = strdup(key);
  n->value.size_bytes = 0;
  n->value.disk_bytes = 0;
  n->value.file_count = 0;
  n->next = hm->buckets[idx];
  hm->buckets[idx] = n;
  return &n->value;
}

static dir_stats_t *hm_get(hash_map_t *hm, const char *key) {
  int idx = (int)(fnv1a(key) % (uint64_t)hm->num_buckets);
  hm_node_t *n = hm->buckets[idx];
  while (n) {
    if (strcmp(n->key, key) == 0) return &n->value;
    n = n->next;
  }
  return NULL;
}

static void hm_free(hash_map_t *hm) {
  for (int i = 0; i < hm->num_buckets; i++) {
    hm_node_t *n = hm->buckets[i];
    while (n) {
      hm_node_t *next = n->next;
      free(n->key);
      free(n);
      n = next;
    }
  }
  free(hm->buckets);
}

/* ── Concurrent work queue ───────────────────────────────────────── */

typedef struct dir_node {
  int fd;
  char *path;
  struct dir_node *next;
} dir_node_t;

typedef struct {
  dir_node_t *head;
  pthread_mutex_t lock;
  atomic_int active;       /* threads currently processing a directory */
  pthread_cond_t cond;
  int finished;
  dev_t root_dev;
  volatile int *cancelled;
} work_queue_t;

static void wq_init(work_queue_t *wq, dev_t dev, volatile int *cancelled) {
  wq->head = NULL;
  pthread_mutex_init(&wq->lock, NULL);
  atomic_store(&wq->active, 0);
  pthread_cond_init(&wq->cond, NULL);
  wq->finished = 0;
  wq->root_dev = dev;
  wq->cancelled = cancelled;
}

static void wq_push(work_queue_t *wq, int fd, const char *path) {
  dir_node_t *node = malloc(sizeof(dir_node_t));
  node->fd = fd;
  node->path = strdup(path);
  pthread_mutex_lock(&wq->lock);
  node->next = wq->head;
  wq->head = node;
  pthread_cond_signal(&wq->cond);
  pthread_mutex_unlock(&wq->lock);
}

/* Returns 1 and fills fd_out/path_out on success, 0 when all work is done. */
static int wq_pop(work_queue_t *wq, int *fd_out, char **path_out) {
  pthread_mutex_lock(&wq->lock);
  for (;;) {
    if (*wq->cancelled || wq->finished) {
      pthread_mutex_unlock(&wq->lock);
      return 0;
    }
    if (wq->head) {
      dir_node_t *node = wq->head;
      wq->head = node->next;
      *fd_out = node->fd;
      *path_out = node->path; /* caller owns this allocation */
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
    free(n->path);
    free(n);
    n = next;
  }
  pthread_mutex_destroy(&wq->lock);
  pthread_cond_destroy(&wq->cond);
}

/* ── Shared attrlist (read-only, safe across threads) ────────────── */

static struct attrlist g_attrlist;
static int g_attrlist_ready = 0;

static void ensure_attrlist(void) {
  if (g_attrlist_ready) return;
  memset(&g_attrlist, 0, sizeof(g_attrlist));
  g_attrlist.bitmapcount = ATTR_BIT_MAP_COUNT;
  /* Attributes returned in bitmap bit order (lowest first):
     ATTR_CMN_NAME (bit 0), then ATTR_CMN_OBJTYPE (bit 3). */
  g_attrlist.commonattr = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_OBJTYPE;
  /* File attrs in bit order: ATTR_FILE_ALLOCSIZE (bit 2, 0x04)
     then ATTR_FILE_DATALENGTH (bit 9, 0x200). */
  g_attrlist.fileattr = ATTR_FILE_ALLOCSIZE | ATTR_FILE_DATALENGTH;
  g_attrlist_ready = 1;
}

/* ── Process one directory with getattrlistbulk ──────────────────── */

typedef struct {
  int64_t direct_bytes;
  int64_t direct_disk_bytes;
  int64_t direct_file_count;
} process_dir_result_t;

static process_dir_result_t process_dir(int dirfd, const char *dir_path,
                                        work_queue_t *wq, dir_record_list_t *local_dirs,
                                        char *buf) {
  int64_t direct_bytes = 0;
  int64_t direct_disk_bytes = 0;
  int64_t direct_file_count = 0;

  for (;;) {
    if (*wq->cancelled) break;

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
        int subfd = openat(dirfd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
        if (subfd >= 0) {
          struct stat sub_stat;
          if (fstat(subfd, &sub_stat) == 0 && sub_stat.st_dev == wq->root_dev) {
            /* Build child path: dir_path + "/" + name */
            size_t dir_len = strlen(dir_path);
            size_t name_len = strlen(name);
            char *child_path = malloc(dir_len + 1 + name_len + 1);
            memcpy(child_path, dir_path, dir_len);
            child_path[dir_len] = '/';
            memcpy(child_path + dir_len + 1, name, name_len + 1);
            wq_push(wq, subfd, child_path);
            free(child_path);
          } else {
            close(subfd);
          }
        }
      }

      ptr += entry_len;
    }
  }

  close(dirfd);
  drl_push(local_dirs, dir_path, direct_bytes, direct_disk_bytes, direct_file_count);

  process_dir_result_t result;
  result.direct_bytes = direct_bytes;
  result.direct_disk_bytes = direct_disk_bytes;
  result.direct_file_count = direct_file_count;
  return result;
}

/* ── Worker thread ───────────────────────────────────────────────── */

typedef struct {
  work_queue_t *wq;
  int64_t total_bytes;
  int64_t total_disk_bytes;
  int64_t total_file_count;
  dir_record_list_t dirs;
} thread_arg_t;

static void *worker_fn(void *arg) {
  thread_arg_t *ta = (thread_arg_t *)arg;
  char *buf = malloc(BULK_BUF_SIZE);
  if (!buf) return NULL;

  int fd;
  char *path;
  while (wq_pop(ta->wq, &fd, &path)) {
    process_dir_result_t r = process_dir(fd, path, ta->wq, &ta->dirs, buf);
    ta->total_bytes += r.direct_bytes;
    ta->total_disk_bytes += r.direct_disk_bytes;
    ta->total_file_count += r.direct_file_count;
    free(path);
    wq_done(ta->wq);
  }

  free(buf);
  return NULL;
}

/* ── Bottom-up aggregation of per-directory sizes ────────────────── */

static int cmp_record_path_len_desc(const void *a, const void *b) {
  size_t la = strlen(((const dir_record_t *)a)->path);
  size_t lb = strlen(((const dir_record_t *)b)->path);
  return (lb > la) - (lb < la);
}

/**
 * Merge thread-local dir records, aggregate recursive stats bottom-up,
 * and build the output linked list (excluding the root path).
 */
static void aggregate_dir_sizes(thread_arg_t *args, int num_threads,
                                const char *root_path,
                                dir_entry_t **out_dirs, int *out_count) {
  /* Count total records across all threads. */
  int total = 0;
  for (int i = 0; i < num_threads; i++) total += args[i].dirs.count;

  if (total == 0) {
    *out_dirs = NULL;
    *out_count = 0;
    return;
  }

  /* Merge into one flat array. */
  dir_record_t *all = malloc((size_t)total * sizeof(dir_record_t));
  int idx = 0;
  for (int i = 0; i < num_threads; i++) {
    for (int j = 0; j < args[i].dirs.count; j++) {
      all[idx].path = args[i].dirs.items[j].path;  /* borrow pointer */
      all[idx].direct_bytes = args[i].dirs.items[j].direct_bytes;
      all[idx].direct_disk_bytes = args[i].dirs.items[j].direct_disk_bytes;
      all[idx].direct_file_count = args[i].dirs.items[j].direct_file_count;
      idx++;
    }
  }

  /* Sort deepest paths first for bottom-up propagation. */
  qsort(all, (size_t)total, sizeof(dir_record_t), cmp_record_path_len_desc);

  /* Build hash map: path -> recursive stats (initialized to direct stats). */
  int hm_size = 1;
  while (hm_size < total * 2) hm_size <<= 1;
  hash_map_t hm;
  hm_init(&hm, hm_size);

  for (int i = 0; i < total; i++) {
    dir_stats_t *s = hm_get_or_insert(&hm, all[i].path);
    s->size_bytes = all[i].direct_bytes;
    s->disk_bytes = all[i].direct_disk_bytes;
    s->file_count = all[i].direct_file_count;
  }

  /* Propagate: for each directory (deepest first), add its recursive
     stats to its parent directory's accumulator. */
  size_t root_len = strlen(root_path);
  char *parent_buf = NULL;
  size_t parent_buf_cap = 0;

  for (int i = 0; i < total; i++) {
    const char *path = all[i].path;
    size_t path_len = strlen(path);

    /* Root has no parent to propagate to. */
    if (path_len == root_len && memcmp(path, root_path, root_len) == 0) {
      continue;
    }

    /* Find parent: strip last path component. */
    if (path_len + 1 > parent_buf_cap) {
      parent_buf_cap = path_len + 1;
      parent_buf = realloc(parent_buf, parent_buf_cap);
    }
    memcpy(parent_buf, path, path_len + 1);
    char *last_slash = strrchr(parent_buf, '/');
    if (last_slash && last_slash != parent_buf) {
      *last_slash = '\0';
    } else if (last_slash == parent_buf) {
      parent_buf[1] = '\0'; /* parent is "/" */
    }

    dir_stats_t *self_val = hm_get(&hm, path);
    dir_stats_t *parent_val = hm_get(&hm, parent_buf);
    if (self_val && parent_val) {
      parent_val->size_bytes += self_val->size_bytes;
      parent_val->disk_bytes += self_val->disk_bytes;
      parent_val->file_count += self_val->file_count;
    }
  }

  free(parent_buf);

  /* Build output linked list (excluding root). */
  dir_entry_t *dirs = NULL;
  int dir_count = 0;
  for (int i = 0; i < total; i++) {
    size_t path_len = strlen(all[i].path);
    if (path_len == root_len && memcmp(all[i].path, root_path, root_len) == 0) {
      continue;
    }
    dir_stats_t *recursive = hm_get(&hm, all[i].path);
    if (!recursive) continue;

    dir_entry_t *e = malloc(sizeof(dir_entry_t));
    e->path = strdup(all[i].path);
    e->stats = *recursive;
    e->next = dirs;
    dirs = e;
    dir_count++;
  }

  hm_free(&hm);
  free(all);

  *out_dirs = dirs;
  *out_count = dir_count;
}

/* ── Async work data ─────────────────────────────────────────────── */

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char *root_path;
  volatile int cancelled;
  int errnum;
  int64_t total_bytes;
  int64_t disk_total;
  int64_t total_file_count;
  dir_entry_t *dirs;
  int dir_count;
} folder_size_work_t;

static folder_size_work_t *active_work = NULL;

/* ── Execute on libuv thread pool (spawns worker pthreads) ───────── */

static void execute_folder_size(napi_env env, void *data) {
  (void)env;
  folder_size_work_t *w = (folder_size_work_t *)data;

  ensure_attrlist();

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

  work_queue_t wq;
  wq_init(&wq, root_stat.st_dev, &w->cancelled);
  wq_push(&wq, root_fd, w->root_path);

  /* Spawn worker threads. */
  thread_arg_t args[NUM_THREADS];
  pthread_t threads[NUM_THREADS];
  for (int i = 0; i < NUM_THREADS; i++) {
    args[i].wq = &wq;
    args[i].total_bytes = 0;
    args[i].total_disk_bytes = 0;
    args[i].total_file_count = 0;
    drl_init(&args[i].dirs);
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
  for (int i = 0; i < NUM_THREADS; i++) {
    w->total_bytes += args[i].total_bytes;
    w->disk_total += args[i].total_disk_bytes;
    w->total_file_count += args[i].total_file_count;
  }

  /* Aggregate per-directory recursive sizes and build output list. */
  if (!w->cancelled) {
    aggregate_dir_sizes(args, NUM_THREADS, w->root_path, &w->dirs, &w->dir_count);
  }

  /* Clean up thread-local dir records. */
  for (int i = 0; i < NUM_THREADS; i++) {
    drl_free_contents(&args[i].dirs);
  }
  wq_destroy(&wq);
}

/* ── Build JSON result string ────────────────────────────────────── */

static char *build_json_result(folder_size_work_t *w) {
  size_t buf_cap = 512 + (size_t)w->dir_count * 300;
  char *buf = (char *)malloc(buf_cap);
  if (!buf) return NULL;

  int written = snprintf(buf, buf_cap,
    "{\"total\":%lld,\"diskTotal\":%lld,\"fileCount\":%lld,\"dirs\":{",
    (long long)w->total_bytes,
    (long long)w->disk_total,
    (long long)w->total_file_count);
  size_t pos = (size_t)written;

  int first = 1;
  dir_entry_t *entry = w->dirs;
  while (entry) {
    size_t path_len = strlen(entry->path);
    /* Each dir entry: "path":[N,N,N] -- need space for path escaping + 3 numbers */
    size_t needed = pos + path_len * 2 + 100;
    if (needed >= buf_cap) {
      buf_cap = needed * 2;
      char *new_buf = (char *)realloc(buf, buf_cap);
      if (!new_buf) { free(buf); return NULL; }
      buf = new_buf;
    }

    if (!first) buf[pos++] = ',';
    first = 0;

    buf[pos++] = '"';
    for (size_t i = 0; i < path_len; i++) {
      char c = entry->path[i];
      if (c == '"' || c == '\\') buf[pos++] = '\\';
      buf[pos++] = c;
    }
    buf[pos++] = '"';
    buf[pos++] = ':';

    int num_written = snprintf(buf + pos, buf_cap - pos, "[%lld,%lld,%lld]",
      (long long)entry->stats.size_bytes,
      (long long)entry->stats.disk_bytes,
      (long long)entry->stats.file_count);
    pos += (size_t)num_written;

    entry = entry->next;
  }

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

/* ── JS entry: nativeFolderSizeCancel() -> void ───────────────────── */

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
