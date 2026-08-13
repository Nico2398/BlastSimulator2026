// BlastSimulator2026 — Drill plan definition
// A drill plan is a set of holes. Each hole has position, depth, and diameter.

import { type VoxelGrid, computeVoxelColumnSurfaceY } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import {
  DRILL_HOLE_BASE_DURATION_TICKS,
  DRILL_HOLE_REFERENCE_DEPTH_M,
  DRILL_HOLE_REFERENCE_DIAMETER_M,
} from '../config/balance.js';

export interface DrillHole {
  id: string;
  /** Surface position X. */
  x: number;
  /** Surface position Z. */
  z: number;
  /** Hole depth in meters/voxels. */
  depth: number;
  /** Hole diameter in meters (real drill holes: 75–150mm). */
  diameter: number;
}

/**
 * A hole that has been ordered but not yet drilled — lives in
 * `state.plannedDrillHoles` until its `drill_hole` action completes and it
 * lands in `state.drillHoles` (#553). The split is which state array a hole
 * lives in, not the value shape: `PlannedHole` and `DrillHole` are the same
 * fields.
 */
export type PlannedHole = DrillHole;

let nextHoleId = 1;

/** Reset hole ID counter (for tests). */
export function resetHoleIds(): void {
  nextHoleId = 1;
}

/** Create a grid drill pattern. */
export function createGridPlan(
  origin: { x: number; z: number },
  rows: number,
  cols: number,
  spacing: number,
  depth: number,
  diameter: number,
): PlannedHole[] {
  const holes: DrillHole[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      holes.push({
        id: `H${nextHoleId++}`,
        x: origin.x + c * spacing,
        z: origin.z + r * spacing,
        depth,
        diameter,
      });
    }
  }
  return holes;
}

/** Add a single hole to an existing plan. */
export function addHole(
  holes: DrillHole[],
  x: number,
  z: number,
  depth: number,
  diameter: number,
): PlannedHole {
  const hole: DrillHole = { id: `H${nextHoleId++}`, x, z, depth, diameter };
  holes.push(hole);
  return hole;
}

/** Remove a hole from the plan by ID. Returns true if a hole was removed, false if none matched. */
export function removeHole(holes: DrillHole[], holeId: string): boolean {
  const index = holes.findIndex(h => h.id === holeId);
  if (index === -1) return false;
  holes.splice(index, 1);
  return true;
}

/**
 * Numeric form of a generated hole ID ("H7" → 7). Scene-picking (renderer/Pickable.ts)
 * tags every pickable entity with a numeric id regardless of kind; holes are the one
 * kind whose game-facing ID is a string, so renderer/UI code that needs to resolve a
 * pick back to a DrillHole matches on this instead. Safe for any ID this module
 * generates — addHole/createGridPlan always produce "H" + the counter value.
 */
export function holeNumericId(holeId: string): number {
  return parseInt(holeId.slice(1), 10);
}

/**
 * Move a hole from the ordered pool to the drilled pool once its `drill_hole`
 * action completes (#553). Same value shape, different state array — see
 * `PlannedHole`.
 */
export function landDrilledHole(planned: PlannedHole): DrillHole {
  return {
    id: planned.id,
    x: planned.x,
    z: planned.z,
    depth: planned.depth,
    diameter: planned.diameter,
  };
}

/** Ticks required to drill one hole, scaled from the reference depth/diameter (#553). */
export function computeDrillHoleDurationTicks(depth: number, diameter: number): number {
  return Math.max(
    1,
    Math.round(
      DRILL_HOLE_BASE_DURATION_TICKS
      * (depth / DRILL_HOLE_REFERENCE_DEPTH_M)
      * (diameter / DRILL_HOLE_REFERENCE_DIAMETER_M),
    ),
  );
}

export interface DigVoxelResult {
  success: boolean;
  /** Highest solid Y in the column after digging; -1 if the column is now empty. */
  newSurfaceY: number;
  /** Column (x, z) containing the dug voxel. */
  affectedCell: { x: number; z: number };
  error?: string;
}

/** Remove a single voxel and return the new column surface Y. */
export function digVoxel(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  emitter?: EventEmitter,
): DigVoxelResult {
  const fail = (error: string): DigVoxelResult => ({
    success: false,
    newSurfaceY: -1,
    affectedCell: { x, z },
    error,
  });

  if (!grid.isInBounds(x, y, z)) {
    return fail(`Coordinates (${x}, ${y}, ${z}) are out of bounds.`);
  }

  if (grid.densityAt(x, y, z) === 0) {
    return fail(`Voxel at (${x}, ${y}, ${z}) is already empty.`);
  }

  grid.clearVoxel(x, y, z);
  emitter?.emit('terrain:updated', { region: { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z } });

  const newSurfaceY = computeVoxelColumnSurfaceY(grid, x, z);

  return {
    success: true,
    newSurfaceY,
    affectedCell: { x, z },
  };
}
