// BlastSimulator2026 — Ground levelling system (#1009)
// Flattens a rectangular area to one target Y so it later passes the flat-
// footprint building-placement rule (#1008). Mirrors the order-then-work
// shape `dig_ramp_segment`/Ramp.ts established: validate at order time,
// carve progressively as a `level_ground` PendingAction.

import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { carveCellIfSolid, computeRampSegmentDurationTicks } from './Ramp.js';
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
}

// ── Core functions ──

/**
 * Target Y the rectangle should be levelled to — the minimum column surface
 * height (computeVoxelColumnSurfaceY) across every column in `rect`
 * (inclusive minX..maxX, minZ..maxZ). Levelling always cuts down to the
 * lowest point in the footprint, never fills.
 */
export function computeLevelTargetY(grid: VoxelGrid, rect: LevelOrderDef): number {
  let targetY = Infinity;
  for (let z = rect.minZ; z <= rect.maxZ; z++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      targetY = Math.min(targetY, computeVoxelColumnSurfaceY(grid, x, z));
    }
  }
  return targetY;
}

/**
 * Cells to carve so every column in `rect` reaches `targetY` — for each
 * column, every solid voxel strictly above `targetY` (a column already at or
 * below `targetY` contributes nothing). The scan per column is bounded by
 * that column's own surface height (computeVoxelColumnSurfaceY), never the
 * whole grid height.
 */
export function computeLevelCells(
  grid: VoxelGrid,
  rect: LevelOrderDef,
  targetY: number,
): { x: number; y: number; z: number }[] {
  const cells: { x: number; y: number; z: number }[] = [];
  for (let z = rect.minZ; z <= rect.maxZ; z++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      const surfaceY = computeVoxelColumnSurfaceY(grid, x, z);
      if (surfaceY <= targetY) continue;
      for (let y = surfaceY; y > targetY; y--) {
        if (grid.densityAt(x, y, z) > 0) {
          cells.push({ x, y, z });
        }
      }
    }
  }
  return cells;
}

/**
 * Bounding box of `cells`, or null when empty — mirrors the `region` shape
 * ramp segments compute for `terrain:updated`.
 */
export function computeLevelRegion(
  cells: { x: number; y: number; z: number }[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (cells.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Validate a level-ground order against `cash` without carving anything —
 * mirrors `validateRampOrder` (Ramp.ts): area/cash checks run before any
 * caller claims a footprint or queues work.
 *
 * Checks run in order: (1) finite, non-inverted rect coordinates; (2) rect
 * area against MAX_LEVEL_GROUND_AREA, rejected before any cell array is
 * built; (3) cost, from the actual cells that need clearing; (4) cash
 * against that cost.
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
  const cost = computeLevelCells(grid, rect, targetY).length * LEVEL_GROUND_COST_PER_VOXEL;

  if (cash < cost) {
    return { success: false, message: `Insufficient funds: need $${formatMoney(cost)}, have $${formatMoney(cash)}`, cost: 0 };
  }

  return { success: true, message: `Ground levelling: ${cost > 0 ? `$${formatMoney(cost)}` : 'already flat'}`, cost };
}

/**
 * Carve `cells` into `grid`, emitting `terrain:updated` for the affected
 * region — mirrors `carveRampSegment` (Ramp.ts). Density is re-checked per
 * cell at carve time: a cell already cleared by something else since the
 * cell list was computed is silently skipped, not double-counted.
 */
export function carveLevelCells(
  grid: VoxelGrid,
  cells: { x: number; y: number; z: number }[],
  emitter?: EventEmitter,
): { voxelsCleared: number } {
  let voxelsCleared = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const cell of cells) {
    if (carveCellIfSolid(grid, cell)) {
      voxelsCleared++;
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z);
    }
  }

  if (voxelsCleared > 0) {
    emitter?.emit('terrain:updated', { region: { minX, maxX, minY, maxY, minZ, maxZ } });
  }

  return { voxelsCleared };
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to level `voxelCount`
 * voxels — same "carve N solid cells" formula a ramp segment uses, re-
 * exported under this name rather than reimplemented (#1009 review finding
 * 1). See `computeRampSegmentDurationTicks` (Ramp.ts) for the formula itself.
 */
export const computeLevelGroundDurationTicks = computeRampSegmentDurationTicks;
