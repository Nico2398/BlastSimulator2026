/**
 * Pick the column of `columns` a digger should work from: the reachable one
 * nearest `anchor`, ties broken by list order; null when none is reachable.
 */
export function pickReachableColumn(
  columns: ReadonlyArray<{ x: number; z: number }>,
  anchor: { x: number; z: number },
  isReachable: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;
  for (const column of columns) {
    if (!isReachable(column.x, column.z)) continue;
    const dx = column.x - anchor.x;
    const dz = column.z - anchor.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      best = column;
      bestDistSq = distSq;
    }
  }
  return best === null ? null : { x: best.x, z: best.z };
}
