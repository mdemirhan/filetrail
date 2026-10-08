// Where the Trash is: the home folder's ".Trash", and on every other disk its ".Trashes"
// folder (which holds one Trash per user). Nothing is pasted, dropped or made there, and
// only what is in it may be deleted for good. The disks ignore letter case by default,
// so case is ignored here too.
export function isInsideTrash(path: string, homePath: string): boolean {
  const key = comparable(path);
  const home = comparable(homePath).replace(/\/+$/u, "");
  if (home.length > 0) {
    const trash = `${home}/.trash`;
    if (key === trash || key.startsWith(`${trash}/`)) {
      return true;
    }
  }
  return /^\/volumes\/[^/]+\/\.trashes(?:\/|$)/u.test(key);
}

// A Trash folder itself, not something in it: the home folder's ".Trash", and on another
// disk its ".Trashes" and each user's Trash in that. It is never deleted, renamed, moved or
// put in the Trash; only what is in it may be deleted for good.
export function isTrashFolder(path: string, homePath: string): boolean {
  const key = comparable(path).replace(/(.)\/+$/u, "$1");
  const home = comparable(homePath).replace(/\/+$/u, "");
  if (home.length > 0 && key === `${home}/.trash`) {
    return true;
  }
  return /^\/volumes\/[^/]+\/\.trashes(?:\/[^/]+)?$/u.test(key);
}

function comparable(path: string): string {
  return path.normalize("NFD").toLowerCase();
}
