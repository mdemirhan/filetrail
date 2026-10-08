import { type FileDragImage, MAX_FILE_DRAG_IMAGES } from "@filetrail/contracts";

// The name in each view: under the icon in Icon view, after it in the lists.
const NAME_SELECTOR = ".flow-item-label, .details-name-label, .icon-item-label";

// Where each dragged item shows in the window, so the drag draws it there, its icon and its
// name, as Finder does. Items out of sight (scrolled past, or not on the page at all, since
// the views only draw what is near the screen) are left out, and go along unseen. A picture
// Quick Look made for an icon on screen is sent with it.
export function measureFileDragImages(
  paths: readonly string[],
  getThumbnail: (path: string) => string | null,
  root: ParentNode = document,
): FileDragImage[] {
  // The items on the page, looked up once: a drag of everything in a large folder would
  // otherwise search the page once for each of them.
  const itemsByPath = new Map<string, HTMLElement>();
  for (const item of Array.from(root.querySelectorAll<HTMLElement>("[data-drag-path]"))) {
    const path = item.dataset.dragPath;
    if (path !== undefined && !itemsByPath.has(path)) {
      itemsByPath.set(path, item);
    }
  }
  const images: FileDragImage[] = [];
  for (const [index, path] of paths.entries()) {
    if (images.length >= MAX_FILE_DRAG_IMAGES) {
      break;
    }
    const item = itemsByPath.get(path);
    const icon = item?.querySelector<HTMLElement>(".file-icon");
    const name = item?.querySelector<HTMLElement>(NAME_SELECTOR);
    if (!item || !icon || !name) {
      continue;
    }
    const iconRect = icon.getBoundingClientRect();
    if (!isInSight(item, iconRect)) {
      continue;
    }
    images.push({
      index,
      iconRect: toRect(iconRect),
      nameRect: toRect(name.getBoundingClientRect()),
      nameFontSize: Number.parseFloat(getComputedStyle(name).fontSize) || 13,
      nameCentered: name.classList.contains("icon-item-label"),
      thumbnail: icon.classList.contains("file-thumbnail") ? getThumbnail(path) : null,
    });
  }
  return images;
}

// Whether the rect shows inside every scrolling area holding the item.
function isInSight(item: HTMLElement, rect: DOMRect): boolean {
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }
  for (let parent = item.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (!/auto|scroll|hidden/u.test(`${overflowX} ${overflowY}`)) {
      continue;
    }
    const bounds = parent.getBoundingClientRect();
    if (
      rect.bottom <= bounds.top ||
      rect.top >= bounds.bottom ||
      rect.right <= bounds.left ||
      rect.left >= bounds.right
    ) {
      return false;
    }
  }
  return true;
}

function toRect(rect: DOMRect): FileDragImage["iconRect"] {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
