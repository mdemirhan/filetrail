export function getSharedPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

export function expandHomeShortcut(path: string, homePath: string): string {
  if (homePath.length === 0) {
    return path;
  }
  if (path === "~") {
    return homePath;
  }
  if (path.startsWith("~/")) {
    return `${homePath}/${path.slice(2)}`;
  }
  return path;
}
