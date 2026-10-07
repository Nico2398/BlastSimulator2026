/**
 * Placement cutoff (#1391): what a building footprint would strand from the crew.
 */

import type { NavGrid } from '../nav/NavGrid.js';
import { computeClimbReachableSetFromSources, inRect } from '../nav/NavGridReachability.js';
import { NAV_CLEARANCE_EMPLOYEE_CELLS, PLACEMENT_CUTOFF_MIN_CELLS } from '../config/balance.js';
import type { Rect } from '../world/WorldGen.js';

interface CutoffTargets {
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
  navGrid: NavGrid,
  crew: ReadonlyArray<{ x: number; z: number }>,
  newRect: Rect,
  freedRect: Rect | undefined,
  targets: CutoffTargets,
): PlacementCutoff | null {
  if (crew.length === 0) return null;
  const now = computeClimbReachableSetFromSources(navGrid, crew, NAV_CLEARANCE_EMPLOYEE_CELLS);
  const after = computeClimbReachableSetFromSources(navGrid, crew, NAV_CLEARANCE_EMPLOYEE_CELLS, {
    block: newRect,
    ...(freedRect ? { free: freedRect } : {}),
  });
  const isCutOff = (x: number, z: number): boolean =>
    now.has(x, z) && !after.has(x, z)
    && !inRect(newRect, x, z);

  let cells = 0;
  const benchLevels = new Set<number>();
  for (let z = navGrid.originZ; z < navGrid.originZ + navGrid.height; z++) {
    for (let x = navGrid.originX; x < navGrid.originX + navGrid.width; x++) {
      if (!isCutOff(x, z)) continue;
      cells++;
      const cell = navGrid.cellAt(x, z);
      if (cell) benchLevels.add(cell.benchLevel);
    }
  }
  if (cells < PLACEMENT_CUTOFF_MIN_CELLS) return null;
  const cutOff = (p: { x: number; z: number }): boolean => isCutOff(Math.round(p.x), Math.round(p.z));
  return {
    cells,
    benches: benchLevels.size,
    holes: targets.holes.filter(cutOff).length,
    orders: targets.orders.filter(cutOff).length,
  };
}
