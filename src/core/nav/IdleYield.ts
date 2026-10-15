// BlastSimulator2026 — IdleYield (#1696)
// Picks the cell an idle blocker steps aside to so a mover can pass in a
// narrow corridor. Pure: no state is read or written.

import type { NavGrid } from './NavGrid';

/**
 * Nearest free cell to `blockerCell`, within `maxRadius` cells (Chebyshev),
 * that is not on the mover's remaining route and not the blocker's own cell.
 * `routeCells` holds "x,z" keys. `isFree` decides whether a cell may be stood
 * on. Rings are searched inner to outer; within a ring the lowest z then
 * lowest x wins, so the result is deterministic. Returns null when none.
 */
export function pickYieldCell(
  grid: NavGrid,
  blockerCell: { x: number; z: number },
  routeCells: ReadonlySet<string>,
  isFree: (x: number, z: number) => boolean,
  maxRadius: number,
): { x: number; z: number } | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = blockerCell.x + dx;
        const z = blockerCell.z + dz;
        if (!grid.containsCell(x, z)) continue;
        if (routeCells.has(`${x},${z}`)) continue;
        if (!isFree(x, z)) continue;
        return { x, z };
      }
    }
  }
  return null;
}
