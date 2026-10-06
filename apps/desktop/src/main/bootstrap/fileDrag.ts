import { createRequire } from "node:module";

import type { FileDragImage, IpcRequest, IpcResponse } from "@filetrail/contracts";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { clearResponseCaches } from "./responseCache";

type FileDragOperation = IpcResponse<"system:startFileDrag">["operation"];
type NativeFileDragImage = Omit<FileDragImage, "thumbnail"> & { thumbnail: Buffer | null };
type StartNativeFileDrag = (
  viewHandle: Buffer,
  paths: string[],
  images: NativeFileDragImage[],
  onEnded: (operation: FileDragOperation) => void,
) => boolean;

const require = createRequire(import.meta.url);

function loadNativeStartFileDrag(): StartNativeFileDrag {
  return (require("@filetrail/native-fs") as { nativeStartFileDrag: StartNativeFileDrag })
    .nativeStartFileDrag;
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
    return Promise.resolve({ started: false, operation: "none" });
  }
  const startNativeFileDrag = deps.startNativeFileDrag ?? loadNativeStartFileDrag();
  return new Promise((resolve) => {
    const started = startNativeFileDrag(
      window.getNativeWindowHandle(),
      payload.paths,
      toNativeImages(payload.images, event.sender.getZoomFactor()),
      (operation) => resolve({ started: true, operation }),
    );
    if (!started) {
      resolve({ started: false, operation: "none" });
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
  // Electron's own `fs` takes .asar files for folders; `original-fs` sees them as they are.
  const lstatFn =
    deps.lstatFn ?? (require("original-fs") as typeof import("node:fs")).promises.lstat;
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
