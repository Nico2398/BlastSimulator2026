// BlastSimulator2026 — Ramp building system
// Ramps provide vehicle access to lower pit levels by carving sloped passages.
// Each ramp clears a diagonal column of voxels from surface to target depth.

import { formatMoney } from '../economy/formatMoney.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { MAX_RAMP_LENGTH, RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS } from '../config/balance.js';

// ── Config ──

/** Cost per meter of ramp length in game dollars. */
// Real haul road construction: ~$50-200/m. Scaled for gameplay.
const RAMP_COST_PER_METER = 100;
/** Ramp width in voxels. */
const RAMP_WIDTH = 3;

// ── Types ──

export type RampDirection = 'north' | 'south' | 'east' | 'west';

export interface RampDef {
  originX: number;
  originZ: number;
  direction: RampDirection;
  length: number;
  /** Target depth (y level to reach). */
  targetDepth: number;
}

export interface RampResult {
  success: boolean;
  message: string;
  cost: number;
  voxelsCleared: number;
}

// ── Direction offsets ──

const DIR_OFFSETS: Record<RampDirection, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

// ── Core function ──

/**
 * Build a ramp by clearing voxels to create a sloped passage.
 * The ramp starts at (originX, surface, originZ) and descends to targetDepth
 * over the given length. Width is fixed at RAMP_WIDTH.
 *
 * Mutates the VoxelGrid.
 * Returns the result including cost and voxels cleared.
 */
export function buildRamp(
  grid: VoxelGrid,
  ramp: RampDef,
  cash: number,
  emitter?: EventEmitter,
): RampResult {
  const validation = validateRampOrder(ramp, cash);
  if (!validation.success) {
    return { success: false, message: validation.message, cost: 0, voxelsCleared: 0 };
  }

  const segments = defineRampSegments(grid, ramp);

  let voxelsCleared = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const segment of segments) {
    const result = carveRampSegment(grid, segment);
    voxelsCleared += result.voxelsCleared;
    if (segment.region && result.voxelsCleared > 0) {
      minX = Math.min(minX, segment.region.minX); maxX = Math.max(maxX, segment.region.maxX);
      minY = Math.min(minY, segment.region.minY); maxY = Math.max(maxY, segment.region.maxY);
      minZ = Math.min(minZ, segment.region.minZ); maxZ = Math.max(maxZ, segment.region.maxZ);
    }
  }

  if (voxelsCleared > 0) {
    emitter?.emit('terrain:updated', { region: { minX, maxX, minY, maxY, minZ, maxZ } });
  }

  return {
    success: true,
    message: `Ramp built: ${ramp.length}m ${ramp.direction}, ${voxelsCleared} voxels cleared`,
    cost: validation.cost,
    voxelsCleared,
  };
}

// ── Local column surface resolution ──

/**
 * Resolve the local surface Y for column (x, z) — the highest voxel with
 * density >= 0.5, matching NavGrid.computeSurfaceY's contract. Both delegate
 * to VoxelGrid.computeVoxelColumnSurfaceY (a leaf-module free function) so
 * core/mining doesn't need to import from core/nav (core/nav already depends
 * on core/mining — DrillPlan, BlastExecution — so the reverse edge would
 * cycle). Returns -1 if the column is entirely void.
 */
function computeColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  return computeVoxelColumnSurfaceY(grid, x, z);
}

export { RAMP_COST_PER_METER, RAMP_WIDTH, computeColumnSurfaceY };

// ── Ordered ramp excavation (#555 — order-then-work, mirrors #554) ──

/** Result of {@link validateRampOrder}. */
export interface RampOrderValidation {
  success: boolean;
  /** Plain-English fallback message for a caller that doesn't translate. */
  message: string;
  cost: number;
  /**
   * Translation key for `message`, present only on the length-bound
   * failures — mirrors BlastPlan.ts's `ValidationError.issue` (#633): core
   * carries the key, the console/UI layer resolves it with `t()`. Absent
   * (falls back to `message`) for the cash/depth checks below, matching
   * their pre-existing untranslated behavior.
   */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

/**
 * Validate a ramp order against `cash` without carving anything — the
 * order-time check `buildRampCommand` runs before queuing excavation work.
 * Same length/depth/cash checks and messages `buildRamp` has always run,
 * extracted so order-time validation and progressive excavation share one
 * source of truth (#555).
 *
 * The finite/positive and MAX_RAMP_LENGTH checks run first, ahead of the
 * cost/depth checks, and ahead of any footprint or claim work a caller does
 * with `ramp.length` — this is the sole bound on ramp length, not a mirror
 * of one in the console command, so every caller of `buildRamp` gets it for
 * free (#788 point 3).
 */
export function validateRampOrder(ramp: RampDef, cash: number): RampOrderValidation {
  if (!Number.isFinite(ramp.length) || ramp.length < 1) {
    return {
      success: false,
      message: 'Invalid ramp length: length must be a finite positive number.',
      cost: 0,
      messageKey: 'mining.build_ramp.invalid_length',
    };
  }

  if (ramp.length > MAX_RAMP_LENGTH) {
    return {
      success: false,
      message: `Ramp too long: ${ramp.length}m exceeds the ${MAX_RAMP_LENGTH}m limit per ramp.`,
      cost: 0,
      messageKey: 'mining.build_ramp.too_long',
      messageParams: { length: ramp.length, limit: MAX_RAMP_LENGTH },
    };
  }

  const totalCost = ramp.length * RAMP_COST_PER_METER;

  if (cash < totalCost) {
    return { success: false, message: `Insufficient funds: need $${formatMoney(totalCost)}, have $${formatMoney(cash)}`, cost: 0 };
  }

  if (ramp.targetDepth <= 0) {
    return { success: false, message: 'Target depth must be positive', cost: 0 };
  }

  return { success: true, message: '', cost: totalCost };
}

/**
 * The column (x, z) ramp step `step` (0-indexed from the entrance) passes
 * through, before width is applied — the same column `defineRampSegments`
 * derives internally per iteration. Exposed so `buildRampCommand` can target
 * a dispatched `dig_ramp_segment` PendingAction's ghost at the same place
 * (row center, at the column's own surface Y via `computeColumnSurfaceY`)
 * without duplicating the direction-offset math.
 */
export function rampStepColumn(ramp: RampDef, step: number): { x: number; z: number } {
  const offset = DIR_OFFSETS[ramp.direction];
  return { x: ramp.originX + offset.dx * step, z: ramp.originZ + offset.dz * step };
}

/** One excavation segment of an ordered ramp — the unit a `dig_ramp_segment` PendingAction carves. */
export interface RampSegmentDef {
  index: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
}

/**
 * Split `ramp` into per-segment excavation work, one segment per
 * `dig_ramp_segment` PendingAction — one entry per `step` of `buildRamp`'s
 * original loop (0-indexed from the entrance), using the exact same
 * column/width/depth math, but only reading density (never mutating) and
 * partitioning cells per step instead of accumulating across all of them.
 * `region` is null when a step's footprint is already entirely clear.
 */
export function defineRampSegments(grid: VoxelGrid, ramp: RampDef): RampSegmentDef[] {
  const offset = DIR_OFFSETS[ramp.direction];
  const perpDx = offset.dz !== 0 ? 1 : 0;
  const perpDz = offset.dx !== 0 ? 1 : 0;
  const halfWidth = Math.floor(RAMP_WIDTH / 2);
  const clearanceHeight = 3;

  const segments: RampSegmentDef[] = [];

  for (let step = 0; step < ramp.length; step++) {
    const currentDepth = Math.floor((step / ramp.length) * ramp.targetDepth);
    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;

    const surfaceY = computeColumnSurfaceY(grid, cx, cz);
    const floorY = surfaceY - currentDepth;
    const ceilingY = surfaceY + clearanceHeight;

    const cells: { x: number; y: number; z: number }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (let w = -halfWidth; w <= halfWidth; w++) {
      const wx = cx + perpDx * w;
      const wz = cz + perpDz * w;

      for (let y = floorY; y < ceilingY; y++) {
        if (grid.densityAt(wx, y, wz) > 0) {
          cells.push({ x: wx, y, z: wz });
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        }
      }
    }

    segments.push({
      index: step,
      cells,
      region: cells.length > 0 ? { minX, maxX, minY, maxY, minZ, maxZ } : null,
    });
  }

  return segments;
}

/**
 * Carve one ramp segment's cells into `grid`, emitting `terrain:updated` for
 * the affected region. Density is re-checked per cell at carve time — a cell
 * already cleared by something else (a blast, another ramp) since
 * `defineRampSegments` ran is silently skipped, not double-counted, not an
 * error.
 */
export function carveRampSegment(grid: VoxelGrid, segment: RampSegmentDef, emitter?: EventEmitter): { voxelsCleared: number } {
  let voxelsCleared = 0;

  for (const cell of segment.cells) {
    if (grid.densityAt(cell.x, cell.y, cell.z) > 0) {
      grid.clearVoxel(cell.x, cell.y, cell.z);
      voxelsCleared++;
    }
  }

  if (voxelsCleared > 0 && segment.region) {
    emitter?.emit('terrain:updated', { region: segment.region });
  }

  return { voxelsCleared };
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to excavate `voxelCount`
 * voxels of a ramp segment. Scales inversely with the tier's workRate
 * multiplier (VEHICLE_TIER_MULTIPLIERS) against the tier-1 baseline rate
 * (RAMP_DIG_VOXELS_PER_TICK_TIER1), always at least 1 tick — a zero-voxel
 * segment (row already flat) still takes a tick to "dig".
 */
export function computeRampSegmentDurationTicks(voxelCount: number, tier: VehicleTier): number {
  const tierWorkRateMultiplier = VEHICLE_TIER_MULTIPLIERS[tier].workRate;
  return Math.max(1, Math.ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * tierWorkRateMultiplier)));
}
