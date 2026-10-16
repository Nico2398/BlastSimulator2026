import type { NavGrid } from './NavGrid.js';
import type { ReachableSet } from './NavGridReachability.js';

/**
 * Widen a reachable set with the docking cells around it: a cell the set does
 * not hold, that is traversable, whose clearance is below `requiredClearance`,
 * and that touches (8 neighbours) at least one cell the set holds.
 * `has(x, z)` costs at most 9 lookups.
 */
export function withDockingCells(
  navGrid: NavGrid,
  base: Pick<ReachableSet, 'has'>,
  requiredClearance: number,
): Pick<ReachableSet, 'has'> {
  void navGrid;
  void requiredClearance;
  // TODO: implement
  return base;
}
