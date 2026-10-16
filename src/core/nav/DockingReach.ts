import { hasClearance, type NavGrid } from './NavGrid.js';
import { isTraversableCell, type ReachableSet } from './NavGridReachability.js';
import { NEIGHBOUR_OFFSETS_8 } from './NeighbourOffsets.js';

/**
 * Widen a reachable set with the docking cells around it: a cell the set does
 * not hold, that is traversable, whose clearance is below `requiredClearance`,
 * and that touches (8 neighbours) at least one cell the set holds.
 * `has(x, z)` costs at most 9 lookups, so the widened set stays O(1) per
 * query (#1603).
 *
 * One hop only: a cell docks when it is itself beside the set, so a narrow
 * approach strip two cells deep is not widened past its first cell. That is
 * the clearance-1 ring a building footprint leaves around itself (#1840).
 */
export function withDockingCells(
  navGrid: NavGrid,
  base: Pick<ReachableSet, 'has'>,
  requiredClearance: number,
): Pick<ReachableSet, 'has'> {
  return {
    has: (x, z) => {
      if (base.has(x, z)) return true;
      const cell = navGrid.cellAt(x, z);
      if (cell === undefined || !isTraversableCell(navGrid, x, z) || hasClearance(cell, requiredClearance)) return false;
      return NEIGHBOUR_OFFSETS_8.some(([dx, dz]) => base.has(x + dx, z + dz));
    },
  };
}
