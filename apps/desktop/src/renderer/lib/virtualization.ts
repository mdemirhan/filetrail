export type VirtualRange = {
  startIndex: number;
  endIndex: number;
};

export function getVirtualRange(args: {
  itemCount: number;
  itemSize: number;
  viewportSize: number;
  scrollOffset: number;
  overscan: number;
}): VirtualRange {
  const { itemCount, itemSize, viewportSize, scrollOffset, overscan } = args;
  if (itemCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
    };
  }

  const safeItemSize = Math.max(1, itemSize);
  const safeViewportSize = Math.max(safeItemSize, viewportSize);
  const safeScrollOffset = Math.max(0, scrollOffset);
  const safeOverscan = Math.max(0, overscan);
  const visibleCount = Math.max(1, Math.ceil(safeViewportSize / safeItemSize));
  const unclampedStartIndex = Math.max(
    0,
    Math.floor(safeScrollOffset / safeItemSize) - safeOverscan,
  );
  const maxStartIndex = Math.max(0, itemCount - visibleCount);
  const startIndex = Math.min(unclampedStartIndex, maxStartIndex);
  const endIndex = Math.min(itemCount, startIndex + visibleCount + safeOverscan * 2);

  return {
    startIndex,
    endIndex,
  };
}

export function chunkItemsIntoRows<T>(items: T[], columns: number): T[][] {
  const safeColumns = Math.max(1, columns);
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += safeColumns) {
    rows.push(items.slice(index, index + safeColumns));
  }
  return rows;
}

export function buildColumnMajorRows<T>(items: T[], rowsPerColumn: number): T[][] {
  const safeRowsPerColumn = Math.max(1, rowsPerColumn);
  const columnCount = Math.max(1, Math.ceil(items.length / safeRowsPerColumn));
  const rows: T[][] = Array.from(
    { length: Math.min(safeRowsPerColumn, items.length || 1) },
    () => [],
  );

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    for (let rowIndex = 0; rowIndex < safeRowsPerColumn; rowIndex += 1) {
      const item = items[columnIndex * safeRowsPerColumn + rowIndex];
      if (item === undefined) {
        continue;
      }
      rows[rowIndex]?.push(item);
    }
  }

  return rows;
}
