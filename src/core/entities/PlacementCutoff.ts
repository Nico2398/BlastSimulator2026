/**
 * Placement cutoff (#1391): what a building footprint would strand from the crew.
 */

import type { NavGrid } from '../nav/NavGrid.js';
import type { Rect } from '../world/WorldGen.js';

export interface CutoffTargets {
  holes: ReadonlyArray<{ x: number; z: number }>;
  orders: ReadonlyArray<{ x: number; z: number }>;
}

export interface PlacementCutoff {
  cells: number;
  benches: number;
  holes: number;
  orders: number;
}

/** Null when the placement strands nothing worth reporting. */
export function computePlacementCutoff(
  _navGrid: NavGrid,
  _crew: ReadonlyArray<{ x: number; z: number }>,
  _newRect: Rect,
  _freedRect: Rect | undefined,
  _targets: CutoffTargets,
): PlacementCutoff | null {
  // TODO: implement
  return null;
}
