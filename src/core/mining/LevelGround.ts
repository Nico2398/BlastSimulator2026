// BlastSimulator2026 — Ground levelling system (#1009, continuous-height rewrite #1144)
// Flattens a rectangular area to one target Y so it later satisfies the
// building-placement levelness rule (#1008). Mirrors the order-then-work
// shape `dig_ramp_segment`/Ramp.ts established: validate at order time,
// carve progressively as a `level_ground` PendingAction. `levelGroundRect`
// below is the un-ordered, un-charged variant construction itself uses.
//
// #1144: rewritten around continuous heights (getSmoothTerrainSurfaceY /
// setVoxelColumnSurfaceHeight, VoxelGrid.ts) instead of integer column
// surfaces, so a column fractionally proud of targetY is still carved
// (defect 1), and columns are the unit of work throughout instead of 3D
// voxel cells.

import {
  getSmoothTerrainSurfaceY, resolveExposedCompId, setVoxelColumnSurfaceHeight, type VoxelGrid,
} from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { computeRampSegmentDurationTicks } from './Ramp.js';
import { formatMoney } from '../economy/formatMoney.js';
import { MAX_LEVEL_GROUND_AREA, LEVEL_GROUND_COST_PER_VOXEL } from '../config/balance.js';

// ── Types ──

export interface LevelOrderDef {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Result of {@link validateLevelOrder} — mirrors `RampOrderValidation` (Ramp.ts). */
export interface LevelOrderValidation {
  success: boolean;
  /** Plain-English fallback message for a caller that doesn't translate. */
  message: string;
  cost: number;
  /** Translation key for `message`, present on translatable failures — mirrors RampOrderValidation. */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  /**
   * `computeLevelTargetY`/`computeLevelColumns` output, present on success
   * only — the caller dispatching the order reuses these instead of
   * re-scanning `grid` for the same rect right after validating it.
   */
  targetY?: number;
  columns?: { x: number; z: number }[];
  region?: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
}

/**
 * Tolerance for "already at targetY". A column integer-flush with its target
 * but fractionally proud of it (24.622 vs 24.500) must still be carved — this
 * is small enough to catch that while absorbing float round-trip noise from
 * the density-interpolation read/write pair in VoxelGrid.ts.
 */
const LEVEL_EPSILON = 1e-6;

// ── Core functions ──

/**
 * Target Y the rectangle should be levelled to — the minimum CONTINUOUS
 * column surface height (getSmoothTerrainSurfaceY) across every column in
 * `rect` (inclusive minX..maxX, minZ..maxZ). Levelling always cuts down to
 * the lowest point in the footprint, never fills.
 */
export function computeLevelTargetY(grid: VoxelGrid, rect: LevelOrderDef): number {
  let targetY = Infinity;
  for (let z = rect.minZ; z <= rect.maxZ; z++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      targetY = Math.min(targetY, getSmoothTerrainSurfaceY(grid, x, z));
    }
  }
  return targetY;
}

/**
 * Columns whose continuous surface height exceeds `targetY` by more than a
 * small epsilon — one entry per column, not one entry per voxel. Renamed
 * from `computeLevelCells` (#1144): a column integer-flush with `targetY`
 * but fractionally proud of it must be included, not silently skipped.
 */
export function computeLevelColumns(
  grid: VoxelGrid,
  rect: LevelOrderDef,
  targetY: number,
): { x: number; z: number }[] {
  const columns: { x: number; z: number }[] = [];
  for (let z = rect.minZ; z <= rect.maxZ; z++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      const height = getSmoothTerrainSurfaceY(grid, x, z);
      if (height - targetY > LEVEL_EPSILON) columns.push({ x, z });
    }
  }
  return columns;
}

/**
 * Continuous volume (in cubic metres-equivalent) that carving `columns`
 * down to `targetY` removes — sum of max(0, surfaceHeight(x,z) - targetY)
 * across `columns`. Two real consumers: `validateLevelOrder` below (order
 * cost) and `ActionSelection.ts`'s live work-ticks re-estimate for an
 * in-progress `level_ground` action.
 */
export function computeLevelVolume(
  grid: VoxelGrid,
  columns: { x: number; z: number }[],
  targetY: number,
): number {
  let volume = 0;
  for (const { x, z } of columns) {
    volume += Math.max(0, getSmoothTerrainSurfaceY(grid, x, z) - targetY);
  }
  return volume;
}

/**
 * Bounding box of `columns`, or null when empty — mirrors the `region`
 * shape ramp segments compute for `terrain:updated`.
 */
export function computeLevelRegion(
  columns: { x: number; z: number }[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (columns.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const col of columns) {
    minX = Math.min(minX, col.x); maxX = Math.max(maxX, col.x);
    minZ = Math.min(minZ, col.z); maxZ = Math.max(maxZ, col.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Validate a level-ground order against `cash` without carving anything —
 * mirrors `validateRampOrder` (Ramp.ts): area/cash checks run before any
 * caller claims a footprint or queues work.
 *
 * Checks run in order: (1) finite, non-inverted rect coordinates; (2) rect
 * area against MAX_LEVEL_GROUND_AREA, rejected before any column array is
 * built; (3) cost, from the continuous volume the columns that need
 * clearing actually carry; (4) cash against that cost.
 */
export function validateLevelOrder(rect: LevelOrderDef, cash: number, grid: VoxelGrid): LevelOrderValidation {
  if (
    !Number.isFinite(rect.minX) || !Number.isFinite(rect.maxX) ||
    !Number.isFinite(rect.minZ) || !Number.isFinite(rect.maxZ) ||
    !Number.isInteger(rect.minX) || !Number.isInteger(rect.maxX) ||
    !Number.isInteger(rect.minZ) || !Number.isInteger(rect.maxZ) ||
    rect.minX > rect.maxX || rect.minZ > rect.maxZ
  ) {
    return {
      success: false,
      message: 'Invalid area: minX/maxX/minZ/maxZ must be finite whole numbers describing a non-empty rectangle.',
      cost: 0,
      messageKey: 'mining.level_ground.invalid_area',
    };
  }

  const area = (rect.maxX - rect.minX + 1) * (rect.maxZ - rect.minZ + 1);
  if (area > MAX_LEVEL_GROUND_AREA) {
    return {
      success: false,
      message: `Area too large: ${area} voxels exceeds the ${MAX_LEVEL_GROUND_AREA} voxel limit per order.`,
      cost: 0,
      messageKey: 'mining.level_ground.too_large',
      messageParams: { area, limit: MAX_LEVEL_GROUND_AREA },
    };
  }

  const targetY = computeLevelTargetY(grid, rect);
  const columns = computeLevelColumns(grid, rect, targetY);
  const volume = computeLevelVolume(grid, columns, targetY);
  const cost = Math.ceil(volume) * LEVEL_GROUND_COST_PER_VOXEL;

  if (cash < cost) {
    return { success: false, message: `Insufficient funds: need $${formatMoney(cost)}, have $${formatMoney(cash)}`, cost: 0 };
  }

  return {
    success: true,
    message: `Ground levelling: ${cost > 0 ? `$${formatMoney(cost)}` : 'already flat'}`,
    cost,
    targetY,
    columns,
    region: computeLevelRegion(columns),
  };
}

/**
 * Carve `columns` down to `targetY` in `grid`, emitting `terrain:updated`
 * for the affected region — mirrors `carveRampSegment` (Ramp.ts). Renamed
 * from `carveLevelCells` (#1144): re-reads each column's live height at
 * carve time (staleness guard) and skips it once already at or below
 * `targetY` + epsilon, rather than iterating a precomputed 3D cell list.
 */
export function carveLevelColumns(
  grid: VoxelGrid,
  columns: { x: number; z: number }[],
  targetY: number,
  emitter?: EventEmitter,
): { voxelsCleared: number } {
  let totalDelta = 0;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let regionMinY = Infinity, regionMaxY = -Infinity;

  for (const { x, z } of columns) {
    const liveHeight = getSmoothTerrainSurfaceY(grid, x, z);
    if (liveHeight - targetY <= LEVEL_EPSILON) continue;

    const compId = resolveExposedCompId(grid, x, z, targetY);
    setVoxelColumnSurfaceHeight(grid, x, z, targetY, compId);

    totalDelta += liveHeight - targetY;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    regionMinY = Math.min(regionMinY, targetY);
    regionMaxY = Math.max(regionMaxY, liveHeight);
  }

  if (totalDelta > 0) {
    emitter?.emit('terrain:updated', {
      region: { minX, maxX, minY: Math.floor(regionMinY), maxY: Math.ceil(regionMaxY), minZ, maxZ },
    });
  }

  return { voxelsCleared: Math.ceil(totalDelta) };
}

/**
 * Level `rect` in one shot: compute its target Y, carve every column above
 * it, and emit `terrain:updated` — the compute/carve dance
 * `validateLevelOrder` + `carveLevelColumns` split across order time and
 * completion time, composed for a caller that does both at once.
 *
 * Used by the end of a building's construction (#1008 refinement): a
 * footprint placed on a tolerated one-level slope is cut flat so the finished
 * building stands on level ground. Unlike a player-ordered `level_ground`
 * job this charges nothing and needs no digger — it is part of the
 * construction the player already paid for. Already-level ground carves
 * nothing and emits nothing.
 *
 * `rect` is used both to derive the target height (the median/mode of its
 * columns' current heights — see `computeLevelTargetY`) and to select the
 * columns carved down to it. A single rect for both keeps the target height
 * always representative of the ground actually being levelled (#1198).
 */
export function levelGroundRect(
  grid: VoxelGrid,
  rect: LevelOrderDef,
  emitter?: EventEmitter,
): { targetY: number; voxelsCleared: number; region: { minX: number; maxX: number; minZ: number; maxZ: number } | null } {
  const targetY = computeLevelTargetY(grid, rect);
  const columns = computeLevelColumns(grid, rect, targetY);
  const region = computeLevelRegion(columns);
  const { voxelsCleared } = carveLevelColumns(grid, columns, targetY, emitter);
  return { targetY, voxelsCleared, region };
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to level `voxelCount`
 * voxels — same "carve N solid cells" formula a ramp segment uses, re-
 * exported under this name rather than reimplemented (#1009 review finding
 * 1). See `computeRampSegmentDurationTicks` (Ramp.ts) for the formula itself.
 */
export const computeLevelGroundDurationTicks = computeRampSegmentDurationTicks;
