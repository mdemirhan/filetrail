// Limits the IPC contract (ipc.ts) holds requests to, here on their own so a window can
// use them without loading the contract's schemas.

// Enough for selecting everything in a large folder; the bound only keeps a runaway
// payload out.
export const MAX_PATHS_PER_REQUEST = 100_000;

// How many dragged items are drawn; Finder draws no more than fit on screen.
export const MAX_FILE_DRAG_IMAGES = 200;
