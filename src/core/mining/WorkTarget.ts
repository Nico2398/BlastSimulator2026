/**
 * Pick the column of `columns` a digger should work from: the reachable one
 * nearest `anchor`, ties broken by list order; null when none is reachable.
 */
export function pickReachableColumn(
  columns: ReadonlyArray<{ x: number; z: number }>,
  anchor: { x: number; z: number },
  isReachable: (x: number, z: number) => boolean,
): { x: number; z: number } | null {
  void columns; void anchor; void isReachable;
  // TODO: implement
  return null;
}
