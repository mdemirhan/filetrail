import { isAbsolute, join, relative } from "node:path";

// The renderer's pages are served from filetrail://app/ rather than file://. Chromium keeps
// the compiled code of a page's scripts only for a scheme that allows it, never for file://,
// so with file:// every window compiled the renderer's script anew.
export const RENDERER_SCHEME = "filetrail";
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app`;

// What Chromium is told about the scheme before the app is ready: a standard, secure scheme
// (pages on it are their own origin, as a web page is) whose compiled code is kept.
export const RENDERER_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  codeCache: true,
} as const;

// The file in the renderer's folder an address on the scheme names; null for an address that
// isn't the scheme's, or a file outside the folder.
export function resolveRendererFile(rendererDir: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== `${RENDERER_SCHEME}:` || url.host !== "app") {
      return null;
    }
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const path = join(rendererDir, pathname);
  const inside = relative(rendererDir, path);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return null;
  }
  return path;
}
