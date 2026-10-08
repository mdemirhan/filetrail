import { useEffect, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";
import { FileIcon } from "./fileIcons";
import { useFiletrailClient } from "./filetrailClient";

type Entry = IpcResponse<"directory:getSnapshot">["entries"][number];

// Longest side previews are asked for in: the 64-point icon of icon view on a Retina
// display. Compact icon view draws the same picture smaller, so both share one cache.
const THUMBNAIL_PIXEL_SIZE = 128;
// Previews are kept in memory only (Quick Look has its own cache on disk), most recently
// used last. This many cover several screens of icon view; older ones are asked for again.
const THUMBNAIL_CACHE_MAX = 500;
// Previews wanted at once are loaded a few at a time, so one scrolled past before its turn
// can still be dropped from the queue.
const MAX_CONCURRENT_THUMBNAIL_LOADS = 4;

type CachedThumbnail = {
  /** The file's state the preview was made from; null when the file could not be read. */
  version: string | null;
  /** Null when Quick Look has no preview for the file. */
  dataUrl: string | null;
  /** The listing the preview was last checked against the file for (see `listing`). */
  checkedFor: object;
};

const thumbnailCache = new Map<string, CachedThumbnail>();

function readThumbnail(path: string): CachedThumbnail | undefined {
  const cached = thumbnailCache.get(path);
  if (cached !== undefined) {
    thumbnailCache.delete(path);
    thumbnailCache.set(path, cached);
  }
  return cached;
}

function rememberThumbnail(path: string, thumbnail: CachedThumbnail) {
  thumbnailCache.delete(path);
  if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
    const oldestPath = thumbnailCache.keys().next().value;
    if (oldestPath !== undefined) thumbnailCache.delete(oldestPath);
  }
  thumbnailCache.set(path, thumbnail);
}

type ThumbnailLoad = () => Promise<void>;
const queuedLoads: ThumbnailLoad[] = [];
let activeLoadCount = 0;

function startQueuedLoads() {
  while (activeLoadCount < MAX_CONCURRENT_THUMBNAIL_LOADS) {
    const load = queuedLoads.shift();
    if (!load) {
      return;
    }
    activeLoadCount += 1;
    void load()
      .catch(() => undefined)
      .finally(() => {
        activeLoadCount -= 1;
        startQueuedLoads();
      });
  }
}

// Queues `load`; the returned function takes it out of the queue again if it has not
// started yet.
function queueThumbnailLoad(load: ThumbnailLoad): () => void {
  queuedLoads.push(load);
  startQueuedLoads();
  return () => {
    const index = queuedLoads.indexOf(load);
    if (index >= 0) {
      queuedLoads.splice(index, 1);
    }
  };
}

// Only files have previews of their content; folders, apps and other bundles keep the
// icons macOS draws for them.
function canHaveThumbnail(entry: Entry): boolean {
  return entry.kind === "file" || entry.kind === "symlink_file";
}

// The item's Quick Look preview as a data URL, or null while it is loading or when there
// is none. A cached preview is shown at once and checked against the file once per
// `listing`, so a file that changed gets a new preview the next time its folder is read.
function useFileThumbnail(entry: Entry, listing: object): string | null {
  const client = useFiletrailClient();
  const { path } = entry;
  const eligible = canHaveThumbnail(entry);
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    eligible ? (thumbnailCache.get(path)?.dataUrl ?? null) : null,
  );

  useEffect(() => {
    if (!eligible) {
      setDataUrl(null);
      return;
    }
    const cached = readThumbnail(path);
    setDataUrl(cached?.dataUrl ?? null);
    if (cached?.checkedFor === listing) {
      return;
    }
    let cancelled = false;
    const cancelLoad = queueThumbnailLoad(async () => {
      const response = await client.invoke("system:getFileThumbnail", {
        path,
        size: THUMBNAIL_PIXEL_SIZE,
        ...(cached?.version ? { knownVersion: cached.version } : {}),
      });
      const thumbnail: CachedThumbnail =
        response.unchanged && cached
          ? { ...cached, checkedFor: listing }
          : { version: response.version, dataUrl: response.dataUrl, checkedFor: listing };
      rememberThumbnail(path, thumbnail);
      if (!cancelled) {
        setDataUrl(thumbnail.dataUrl);
      }
    });
    return () => {
      cancelled = true;
      cancelLoad();
    };
  }, [client, eligible, listing, path]);

  return dataUrl;
}

// What icon view draws for an item: the Quick Look preview of a file's content (a photo,
// a PDF page, a video frame), or the icon macOS draws for it until the preview arrives and
// when there is none.
export function FileThumbnail({
  entry,
  listing,
}: {
  entry: Entry;
  /**
   * Stands for one reading of the folder: any object that changes when the list of items
   * does. Previews are checked against their files once for each.
   */
  listing: object;
}) {
  const dataUrl = useFileThumbnail(entry, listing);
  if (dataUrl) {
    // A picture without transparency (JPEG data: a photo, a video frame) gets an outline;
    // one with transparency is a cut-out image or a page drawn with its own outline.
    const framed = dataUrl.startsWith("data:image/jpeg");
    return (
      <span className="file-icon file-thumbnail" aria-hidden>
        <img
          src={dataUrl}
          alt=""
          className={`file-thumbnail-img${framed ? " framed" : ""}`}
          draggable={false}
        />
      </span>
    );
  }
  return <FileIcon entry={entry} large />;
}

// The preview already loaded for the file, if any; a drag shows it instead of the icon.
export function getLoadedFileThumbnail(path: string): string | null {
  return thumbnailCache.get(path)?.dataUrl ?? null;
}

/** Forgets every cached preview and queued request. For tests. */
export function resetFileThumbnailCache() {
  thumbnailCache.clear();
  queuedLoads.length = 0;
}
