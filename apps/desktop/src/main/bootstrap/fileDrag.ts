import { createRequire } from "node:module";

import type { Stats } from "node:fs";

import {
  type FileDragImage,
  type IpcRequest,
  type IpcResponse,
  MAX_PATHS_PER_REQUEST,
} from "@filetrail/contracts";
import type {
  FileDragImage as NativeFileDragImage,
  nativeReadDragPasteboard,
  nativeStartFileDrag,
} from "@filetrail/native-fs";
import { BrowserWindow, type IpcMainInvokeEvent, app } from "electron";
import { clearResponseCaches } from "./responseCache";

type StartNativeFileDrag = typeof nativeStartFileDrag;
type ReadNativeDragPasteboard = typeof nativeReadDragPasteboard;
type DraggedInItem = IpcResponse<"system:readDraggedIn">["items"][number];

const require = createRequire(import.meta.url);

function loadNativeStartFileDrag(): StartNativeFileDrag {
  return (require("@filetrail/native-fs") as { nativeStartFileDrag: StartNativeFileDrag })
    .nativeStartFileDrag;
}

function loadNativeReadDragPasteboard(): ReadNativeDragPasteboard {
  return (require("@filetrail/native-fs") as { nativeReadDragPasteboard: ReadNativeDragPasteboard })
    .nativeReadDragPasteboard;
}

// A drag that couldn't start: nothing was dropped anywhere.
const NOT_STARTED: IpcResponse<"system:startFileDrag"> = {
  started: false,
  operation: "none",
  endedOver: "elsewhere",
};

// Electron's own `fs` takes .asar files for folders; `original-fs` sees them as they are.
function originalFs(): typeof import("node:fs") {
  return require("original-fs") as typeof import("node:fs");
}

// Starts a system file drag from the sender's window and answers when it ends. The page
// measures in CSS pixels, which the window's zoom makes larger or smaller on screen.
export function startFileDrag(
  payload: IpcRequest<"system:startFileDrag">,
  event: Pick<IpcMainInvokeEvent, "sender">,
  deps: {
    windowFor?: (
      sender: IpcMainInvokeEvent["sender"],
    ) => Pick<BrowserWindow, "getNativeWindowHandle"> | null;
    startNativeFileDrag?: StartNativeFileDrag;
  } = {},
): Promise<IpcResponse<"system:startFileDrag">> {
  const window = (deps.windowFor ?? BrowserWindow.fromWebContents)(event.sender);
  if (!window) {
    return Promise.resolve(NOT_STARTED);
  }
  const startNativeFileDrag = deps.startNativeFileDrag ?? loadNativeStartFileDrag();
  return new Promise((resolve) => {
    const started = startNativeFileDrag(
      window.getNativeWindowHandle(),
      payload.paths,
      payload.directories,
      toNativeImages(payload.images, event.sender.getZoomFactor()),
      (operation, endedOver) => resolve({ started: true, operation, endedOver }),
    );
    if (!started) {
      resolve(NOT_STARTED);
    }
  });
}

function toNativeImages(images: FileDragImage[], zoom: number): NativeFileDragImage[] {
  const scale = (rect: FileDragImage["iconRect"]) => ({
    x: rect.x * zoom,
    y: rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
  });
  return images.map((image) => ({
    ...image,
    iconRect: scale(image.iconRect),
    nameRect: scale(image.nameRect),
    nameFontSize: image.nameFontSize * zoom,
    thumbnail: decodeImageDataUrl(image.thumbnail),
  }));
}

// The image data in a base64 data URL; null for anything else.
export function decodeImageDataUrl(dataUrl: string | null): Buffer | null {
  const match = dataUrl?.match(/^data:image\/[a-z+.-]+;base64,(.+)$/iu);
  if (!match?.[1]) {
    return null;
  }
  const data = Buffer.from(match[1], "base64");
  return data.length > 0 ? data : null;
}

// The dragged items no longer where they were. A link counts as itself, not what it points
// to, and an item that can't be looked at for another reason (a disk gone to sleep) is not
// taken for gone. The listings and sizes of what they left are read again.
export async function findDraggedAway(
  payload: IpcRequest<"system:findDraggedAway">,
  deps: {
    lstatFn?: (path: string) => Promise<unknown>;
    clearCaches?: (changedPaths: readonly string[]) => void;
  } = {},
): Promise<IpcResponse<"system:findDraggedAway">> {
  const lstatFn = deps.lstatFn ?? originalFs().promises.lstat;
  const answers = await Promise.all(
    payload.paths.map(async (path) => {
      try {
        await lstatFn(path);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      }
    }),
  );
  const gone = payload.paths.filter((_path, index) => answers[index]);
  if (gone.length > 0) {
    (deps.clearCaches ?? clearResponseCaches)(gone);
  }
  return { gone };
}

// The files and folders a drag from another app carries, while it is over the window. Each
// is looked at as it is on disk: a link is the link (its kind says where it points), and an
// item that can't be looked at is left out, so nothing is dropped that isn't there.
export async function readDraggedIn(
  deps: {
    readDragPasteboard?: ReadNativeDragPasteboard;
    lstatFn?: (path: string) => Promise<Pick<Stats, "isDirectory" | "isSymbolicLink">>;
    statFn?: (path: string) => Promise<Pick<Stats, "isDirectory">>;
  } = {},
): Promise<IpcResponse<"system:readDraggedIn">> {
  const contents = (deps.readDragPasteboard ?? loadNativeReadDragPasteboard())();
  const { changeCount } = contents;
  const paths = contents.paths.filter((path) => path.startsWith("/"));
  // Too many for the copy that would follow: refused as a whole, never cut short.
  if (paths.length > MAX_PATHS_PER_REQUEST) {
    return { changeCount, items: [] };
  }
  const lstatFn = deps.lstatFn ?? originalFs().promises.lstat;
  const statFn = deps.statFn ?? originalFs().promises.stat;
  const items = await Promise.all(
    paths.map(async (path): Promise<DraggedInItem | null> => {
      try {
        const stats = await lstatFn(path);
        if (stats.isSymbolicLink()) {
          const pointsToFolder = await statFn(path).then(
            (target) => target.isDirectory(),
            () => false,
          );
          return { path, kind: pointsToFolder ? "symlink_directory" : "symlink_file" };
        }
        return { path, kind: stats.isDirectory() ? "directory" : "file" };
      } catch {
        return null;
      }
    }),
  );
  return {
    changeCount,
    items: items.filter((item): item is DraggedInItem => item !== null),
  };
}

// How long after asking the app to come forward it is checked: activation is not at once.
const BRING_TO_FRONT_CHECK_MS = 250;

// Brings the sender's window forward for a question about a drop made while another app
// was in front. macOS may refuse to let an app take the front from the one in use; then
// the Dock icon bounces once, so the question isn't missed.
export async function bringWindowToFront(
  event: Pick<IpcMainInvokeEvent, "sender">,
  deps: {
    windowFor?: (
      sender: IpcMainInvokeEvent["sender"],
    ) => Pick<BrowserWindow, "show" | "focus" | "isFocused" | "isDestroyed"> | null;
    focusApp?: () => void;
    bounceDockIcon?: () => void;
    waitMs?: number;
  } = {},
): Promise<IpcResponse<"system:bringWindowToFront">> {
  const window = (deps.windowFor ?? BrowserWindow.fromWebContents)(event.sender);
  if (!window) {
    return { focused: false };
  }
  (deps.focusApp ?? (() => app.focus({ steal: true })))();
  window.show();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, deps.waitMs ?? BRING_TO_FRONT_CHECK_MS));
  if (window.isDestroyed()) {
    return { focused: false };
  }
  const focused = window.isFocused();
  if (!focused) {
    (deps.bounceDockIcon ?? (() => app.dock?.bounce("informational")))();
  }
  return { focused };
}
