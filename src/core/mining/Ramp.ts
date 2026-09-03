// BlastSimulator2026 — Ramp building system
// Ramps provide vehicle access to lower pit levels by carving sloped passages.
// Each ramp clears a diagonal column of voxels from surface to target depth.

import { formatMoney } from '../economy/formatMoney.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
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

export { RAMP_COST_PER_METER, RAMP_WIDTH };

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

/** One excavation segment of an ordered ramp — the unit a `dig_ramp_segment` PendingAction carves. */
export interface RampSegmentDef {
  /** Layer index, 0 = topmost/shallowest, increasing = deeper (#925). */
  index: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  /** Anchor X for ghost/dispatch, valid even when `region` is null. */
  targetX: number;
  /** Anchor Z for ghost/dispatch, valid even when `region` is null. */
  targetZ: number;
  /** Anchor Y — the layer's absolute world Y — valid even when `region` is null. */
  targetY: number;
}

/** One column's per-step floor/ceiling geometry — Pass 1 of {@link defineRampSegments}. */
interface RampColumn {
  cx: number;
  cz: number;
  floorY: number;
  ceilingY: number;
}

/**
 * Split `ramp` into per-layer (bench) excavation work, one segment per
 * `dig_ramp_segment` PendingAction (#925 — reworked from one segment per
 * column/step to one segment per horizontal layer, so a half-dug ramp is a
 * flat surface at some intermediate depth across the whole footprint,
 * instead of a full-depth notch at the entrance).
 *
 * Two passes, using the exact same per-column floor/ceiling/width math the
 * original column-grouped version used (so the final voxel set carved is
 * identical — only the grouping/order changes):
 *
 * Pass 1 computes, for every column `step` along the ramp's length, the same
 * `cx`/`cz`/`surfaceY`/`floorY`/`ceilingY` the old per-step loop computed.
 *
 * Pass 2 walks `y` from the highest ceiling down to the lowest floor across
 * all columns, one segment per `y`. A column contributes at `y` when
 * `floorY <= y < ceilingY`; every contributing column's width band
 * (`-halfWidth..halfWidth` perpendicular to the ramp direction, same as
 * before) is checked for solid cells at that `y`. `region` is the bounding
 * box of actual solid cells (null if none); `targetX`/`targetZ` are the
 * center of the *band* of contributing column positions (regardless of
 * solidity), so they're finite for every EMITTED segment — but on uneven
 * terrain (e.g. a footprint crossing a plateau/canyon/plateau) different
 * columns can have disjoint `[floorY, ceilingY)` ranges, so a `y` in
 * `[globalMinY, globalMaxY]` is not guaranteed to have any contributing
 * column. A `y` with zero contributors has nothing carve-able anywhere in
 * the footprint and is skipped — not emitted with a null/invalid band —
 * so `index` still increases 0..N-1 with no gaps across emitted segments,
 * and `targetY` still strictly decreases across them.
 */
export function defineRampSegments(grid: VoxelGrid, ramp: RampDef): RampSegmentDef[] {
  const offset = DIR_OFFSETS[ramp.direction];
  const perpDx = offset.dz !== 0 ? 1 : 0;
  const perpDz = offset.dx !== 0 ? 1 : 0;
  const halfWidth = Math.floor(RAMP_WIDTH / 2);
  const clearanceHeight = 3;

  // Pass 1 — per-column floor/ceiling geometry, unchanged from the original.
  const columns: RampColumn[] = [];
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;

  for (let step = 0; step < ramp.length; step++) {
    const currentDepth = Math.floor((step / ramp.length) * ramp.targetDepth);
    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;

    const surfaceY = computeColumnSurfaceY(grid, cx, cz);
    const floorY = surfaceY - currentDepth;
    const ceilingY = surfaceY + clearanceHeight;

    columns.push({ cx, cz, floorY, ceilingY });
    globalMinY = Math.min(globalMinY, floorY);
    globalMaxY = Math.max(globalMaxY, ceilingY - 1);
  }

  // Pass 2 — one segment per y, top (globalMaxY) to bottom (globalMinY).
  const segments: RampSegmentDef[] = [];

  for (let y = globalMaxY; y >= globalMinY; y--) {
    const cells: { x: number; y: number; z: number }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let bandMinX = Infinity, bandMaxX = -Infinity, bandMinZ = Infinity, bandMaxZ = -Infinity;

    for (const col of columns) {
      if (y < col.floorY || y >= col.ceilingY) continue;

      bandMinX = Math.min(bandMinX, col.cx); bandMaxX = Math.max(bandMaxX, col.cx);
      bandMinZ = Math.min(bandMinZ, col.cz); bandMaxZ = Math.max(bandMaxZ, col.cz);

      for (let w = -halfWidth; w <= halfWidth; w++) {
        const wx = col.cx + perpDx * w;
        const wz = col.cz + perpDz * w;

        if (grid.densityAt(wx, y, wz) > 0) {
          cells.push({ x: wx, y, z: wz });
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        }
      }
    }

    // No column contributes at this y — a true gap between disjoint
    // per-column [floorY, ceilingY) ranges (possible on uneven terrain,
    // e.g. a footprint crossing a plateau/canyon/plateau). bandMinX etc.
    // are still at their Infinity/-Infinity sentinels, so there is no
    // finite band to derive targetX/targetZ from. Nothing carve-able
    // exists at this y for any column, so skip emitting a segment for it
    // entirely rather than pushing one with NaN target coordinates.
    if (bandMinX === Infinity) continue;

    segments.push({
      index: segments.length,
      cells,
      region: cells.length > 0 ? { minX, maxX, minY, maxY, minZ, maxZ } : null,
      // bandMinX/bandMaxX/bandMinZ/bandMaxZ are finite here — this y was
      // skipped above unless at least one column contributed.
      targetX: Math.round((bandMinX + bandMaxX) / 2),
      targetZ: Math.round((bandMinZ + bandMaxZ) / 2),
      targetY: y,
    });
  }

  return segments;
}

/** The subset of {@link RampSegmentDef} {@link carveRampSegment} actually reads — it never touches `index`/`targetX`/`targetZ`/`targetY`, so callers that only have cells/region (e.g. a completed segment's own tracker) don't need to fabricate the rest. */
type RampSegmentCarveInput = Pick<RampSegmentDef, 'cells' | 'region'>;

/**
 * Carve one ramp segment's cells into `grid`, emitting `terrain:updated` for
 * the affected region. Density is re-checked per cell at carve time — a cell
 * already cleared by something else (a blast, another ramp) since
 * `defineRampSegments` ran is silently skipped, not double-counted, not an
 * error.
 */
export function carveRampSegment(grid: VoxelGrid, segment: RampSegmentCarveInput, emitter?: EventEmitter): { voxelsCleared: number } {
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
 * Progressive carve target (#946) — how many of a segment's `totalCells`
 * should be carved given `ticksElapsed` of `totalTicks` work. 0 at 0%
 * progress, `totalCells` at 100%, clamped in between. `totalTicks <= 0`
 * guards against a zero-duration segment by returning `totalCells` (fully
 * carved immediately) rather than dividing by zero.
 */
export function computeRampSegmentCarveTarget(totalCells: number, ticksElapsed: number, totalTicks: number): number {
  void totalCells; void ticksElapsed; void totalTicks;
  // TODO: implement
  return undefined as any;
}

/**
 * Carve only `cells[fromIndex, toIndex)` of a ramp segment into `grid`
 * (#946 — progressive carving in step with the action's own tick progress,
 * instead of all at once on completion via {@link carveRampSegment}).
 * Mirrors `carveRampSegment`'s density re-check and `terrain:updated` emit,
 * scoped to only the region of cells actually cleared by this slice.
 */
export function carveRampSegmentSlice(
  grid: VoxelGrid,
  cells: RampSegmentDef['cells'],
  fromIndex: number,
  toIndex: number,
  emitter?: EventEmitter,
): { voxelsCleared: number; region: RampSegmentDef['region'] } {
  void grid; void cells; void fromIndex; void toIndex; void emitter;
  // TODO: implement
  return undefined as any;
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to excavate `voxelCount`
 * voxels of a ramp segment. Scales inversely with the tier's workRate
 * multiplier (VEHICLE_TIER_MULTIPLIERS) against the tier-1 baseline rate
 * (RAMP_DIG_VOXELS_PER_TICK_TIER1), always at least 1 tick — a zero-voxel
 * segment (row already flat) still takes a tick to "dig".
 *
 * `proficiencyLevel`/`needMultiplier`/`lqMultiplier` feed the same
 * `computeTaskDuration` formula every other skill-gated task duration uses
 * (#924) — defaults of `1, 1, 1` reproduce the pre-#924 baseline
 * (`Math.max(1, Math.ceil(voxelCount/(rate*tierMult)))`) exactly for any
 * caller that doesn't pass them.
 */
export function computeRampSegmentDurationTicks(
  voxelCount: number,
  tier: VehicleTier,
  proficiencyLevel: 1 | 2 | 3 | 4 | 5 = 1,
  needMultiplier: number = 1,
  lqMultiplier: number = 1,
): number {
  const tierWorkRateMultiplier = VEHICLE_TIER_MULTIPLIERS[tier].workRate;
  const baseTicks = voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * tierWorkRateMultiplier);
  return computeTaskDuration(baseTicks, proficiencyLevel, needMultiplier, lqMultiplier, 1);
}
