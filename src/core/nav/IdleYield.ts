// BlastSimulator2026 — IdleYield (#1696)
// Picks the cell an idle blocker steps aside to so a mover can pass in a
// narrow corridor. Pure: no state is read or written.

import type { NavGrid } from './NavGrid';

/**
 * Nearest free cell to `blockerCell`, within `maxRadius` cells, that is not on
 * the mover's remaining route. `routeCells` holds "x,z" keys. `isFree` decides
 * whether a cell may be stood on. Returns null when no such cell exists.
 */
export function pickYieldCell(
  grid: NavGrid,
  blockerCell: { x: number; z: number },
  routeCells: ReadonlySet<string>,
  isFree: (x: number, z: number) => boolean,
  maxRadius: number,
): { x: number; z: number } | null {
  void grid;
  void blockerCell;
  void routeCells;
  void isFree;
  void maxRadius;
  // TODO: implement
  return null;
}
