// BlastSimulator2026 — Drill plan definition
// A drill plan is a set of holes. Each hole has position, depth, and diameter.

import { type VoxelGrid, computeVoxelColumnSurfaceY, renormaliseVoxelColumnAfterCarve } from '../world/VoxelGrid.js';
import type { Vehicle, VehicleTier } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import {
  DRILL_HOLE_BASE_DURATION_TICKS,
  DRILL_HOLE_REFERENCE_DEPTH_M,
  DRILL_HOLE_REFERENCE_DIAMETER_M,
  DRILL_RIG_MAX_DEPTH_M,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
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

/** Narrowest input for id generation: anything carrying the next hole number (GameState does). */
interface HoleIdCounter {
  nextHoleId: number;
}

/** Surface positions of a rows × cols grid pattern, row-major from `origin`. */
export function gridCellPositions(
  origin: { x: number; z: number },
  rows: number,
  cols: number,
  spacing: number,
): { x: number; z: number }[] {
  const cells: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: origin.x + c * spacing, z: origin.z + r * spacing });
    }
  }
  return cells;
}

/** Create one hole per position, taking consecutive ids from `counter`. */
export function createHolesAt(
  counter: HoleIdCounter,
  cells: ReadonlyArray<{ x: number; z: number }>,
  depth: number,
  diameter: number,
): PlannedHole[] {
  return cells.map(cell => ({ id: `H${counter.nextHoleId++}`, x: cell.x, z: cell.z, depth, diameter }));
}

/** Create a grid drill pattern. */
export function createGridPlan(
  counter: HoleIdCounter,
  origin: { x: number; z: number },
  rows: number,
  cols: number,
  spacing: number,
  depth: number,
  diameter: number,
): PlannedHole[] {
  return createHolesAt(counter, gridCellPositions(origin, rows, cols, spacing), depth, diameter);
}

/** Add a single hole to an existing plan. */
export function addHole(
  counter: HoleIdCounter,
  holes: DrillHole[],
  x: number,
  z: number,
  depth: number,
  diameter: number,
  reservedHoles: ReadonlyArray<DrillHole> = [],
): PlannedHole {
  // Never hand out an id a live hole (planned here or drilled elsewhere) holds.
  const isTaken = (id: string): boolean => holes.some(h => h.id === id) || reservedHoles.some(h => h.id === id);
  while (isTaken(`H${counter.nextHoleId}`)) counter.nextHoleId++;
  const hole: DrillHole = { id: `H${counter.nextHoleId++}`, x, z, depth, diameter };
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

/** Highest numeric hole id ("H7" → 7) among `ids`; 0 when empty. Ids whose number is not a safe integer are ignored. */
export function maxHoleNumericId(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = /^H(\d+)$/.exec(id);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    if (Number.isSafeInteger(n)) max = Math.max(max, n);
  }
  return max;
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
  /** Highest solid Y in the column after digging; null if the column is now empty. */
  newSurfaceY: number | null;
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
    newSurfaceY: null,
    affectedCell: { x, z },
    error,
  });

  if (!grid.isInBounds(x, y, z)) {
    return fail(`Coordinates (${x}, ${y}, ${z}) are out of bounds.`);
  }

  if (grid.densityAt(x, y, z) === 0) {
    return fail(`Voxel at (${x}, ${y}, ${z}) is already empty.`);
  }

  const oldTopY = computeVoxelColumnSurfaceY(grid, x, z);
  grid.clearVoxel(x, y, z);
  const renormalisedMaxY = renormaliseVoxelColumnAfterCarve(grid, x, z, oldTopY);
  const maxY = renormalisedMaxY !== null ? Math.max(y, renormalisedMaxY) : y;
  emitter?.emit('terrain:updated', { region: { minX: x, maxX: x, minY: y, maxY, minZ: z, maxZ: z } });

  const newSurfaceY = computeVoxelColumnSurfaceY(grid, x, z);

  return {
    success: true,
    newSurfaceY,
    affectedCell: { x, z },
  };
}

type RigLike = Pick<Vehicle, 'type' | 'tier'>;

/**
 * Deepest hole (m) the fleet can drill: max DRILL_RIG_MAX_DEPTH_M[tier] over
 * `drill_rig` vehicles. With no rig owned, falls back to the tier-1 value (#1679).
 */
export function fleetDrillReachM(vehicles: ReadonlyArray<RigLike>): number {
  let reach = DRILL_RIG_MAX_DEPTH_M[1];
  for (const v of vehicles) {
    if (v.type !== 'drill_rig') continue;
    reach = Math.max(reach, DRILL_RIG_MAX_DEPTH_M[v.tier]);
  }
  return reach;
}

/**
 * Refusal for a hole deeper than the fleet's reach: null when depth <= reach,
 * else the i18n key and params (#1679).
 */
export function drillDepthRefusal(
  depth: number,
  vehicles: ReadonlyArray<RigLike>,
): { key: 'mining.drill_plan.refused_depth'; params: { depth: number; reach: number } } | null {
  const reach = fleetDrillReachM(vehicles);
  if (!(depth > reach)) return null; // within reach; NaN left to existing behaviour
  return { key: 'mining.drill_plan.refused_depth', params: { depth, reach } };
}

const DRILL_RIG_TIERS_ASC = Object.keys(DRILL_RIG_MAX_DEPTH_M).map(Number).sort((a, b) => a - b) as VehicleTier[];

/** Lowest drill rig tier whose max depth (DRILL_RIG_MAX_DEPTH_M) reaches `depth`. */
export function minDrillRigTier(depth: number): VehicleTier {
  if (!(depth > 0)) return 1;
  const tiers = DRILL_RIG_TIERS_ASC;
  // Beyond the deepest rig: clamp to it; drillDepthRefusal already blocks such a hole at order time.
  return tiers.find(t => DRILL_RIG_MAX_DEPTH_M[t] >= depth) ?? tiers[tiers.length - 1]!;
}

/** Widest hole (m) the fleet's best drill rig can bore (#1934). */
export function fleetDrillDiameterM(_vehicles: ReadonlyArray<RigLike>): number {
  return DRILL_HOLE_DEFAULT_DIAMETER_M;
}

/** Refusal for a hole wider than the fleet can bore: null when it fits, else the i18n key and params (#1934). */
export function drillDiameterRefusal(
  _diameter: number,
  _vehicles: ReadonlyArray<RigLike>,
): { key: 'mining.drill_plan.refused_diameter'; params: { diameter: number; max: number } } | null {
  return null;
}
