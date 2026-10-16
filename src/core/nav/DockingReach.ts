import { hasClearance, type NavGrid } from './NavGrid.js';
import { isTraversableCell, type ReachableSet } from './NavGridReachability.js';
import { NEIGHBOUR_OFFSETS_8 } from './NeighbourOffsets.js';

/** How many thin cells deep a docking strip may run from the base: ring cell beside a footprint, then the strip beside that ring (#1840). */
const DOCKING_HOPS = 2;

/**
 * Widen a reachable set with the docking cells around it: a cell the set does
 * not hold, that is traversable, whose clearance is below `requiredClearance`,
 * and that touches (8 neighbours) a cell the set holds, or touches another
 * such docking cell, up to `DOCKING_HOPS` cells deep. Each hop costs at most
 * 9 lookups, so the widened set stays O(1) per query (#1603).
 *
 * Two hops, not unbounded: the clearance-1 ring a building footprint leaves
 * around itself can sit in a strip between footprint and wall, entered only
 * through the ring's end, so the order's approach cell is two cells from the
 * clearance-2 base (#1840). A cell three or more thin cells away stays out.
 */
export function withDockingCells(
  navGrid: NavGrid,
  base: Pick<ReachableSet, 'has'>,
  requiredClearance: number,
): Pick<ReachableSet, 'has'> {
  const docks = (x: number, z: number, hops: number): boolean => {
    if (base.has(x, z)) return true;
    if (hops === 0) return false;
    const cell = navGrid.cellAt(x, z);
    if (cell === undefined || !isTraversableCell(navGrid, x, z) || hasClearance(cell, requiredClearance)) return false;
    return NEIGHBOUR_OFFSETS_8.some(([dx, dz]) => docks(x + dx, z + dz, hops - 1));
  };
  return { has: (x, z) => docks(x, z, DOCKING_HOPS) };
}
