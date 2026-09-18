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

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { computeRampSegmentDurationTicks } from './Ramp.js';

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

// ── Core functions ──

/**
 * Target Y the rectangle should be levelled to — the minimum continuous
 * column surface height across every column in `rect` (inclusive
 * minX..maxX, minZ..maxZ). Levelling always cuts down to the lowest point
 * in the footprint, never fills.
 */
export function computeLevelTargetY(_grid: VoxelGrid, _rect: LevelOrderDef): number {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Columns whose continuous surface height exceeds `targetY` by more than a
 * small epsilon — one entry per column, not one entry per voxel. Renamed
 * from `computeLevelCells` (#1144): a column integer-flush with `targetY`
 * but fractionally proud of it must be included, not silently skipped.
 */
export function computeLevelColumns(
  _grid: VoxelGrid,
  _rect: LevelOrderDef,
  _targetY: number,
): { x: number; z: number }[] {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Continuous volume (in cubic metres-equivalent) that carving `columns`
 * down to `targetY` removes — sum of max(0, surfaceHeight(x,z) - targetY)
 * across `columns`. Two real consumers: `validateLevelOrder` below (order
 * cost) and `ActionSelection.ts`'s live work-ticks re-estimate for an
 * in-progress `level_ground` action.
 */
export function computeLevelVolume(
  _grid: VoxelGrid,
  _columns: { x: number; z: number }[],
  _targetY: number,
): number {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Bounding box of `columns`, or null when empty — mirrors the `region`
 * shape ramp segments compute for `terrain:updated`.
 */
export function computeLevelRegion(
  _columns: { x: number; z: number }[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Validate a level-ground order against `cash` without carving anything —
 * mirrors `validateRampOrder` (Ramp.ts): area/cash checks run before any
 * caller claims a footprint or queues work.
 */
export function validateLevelOrder(_rect: LevelOrderDef, _cash: number, _grid: VoxelGrid): LevelOrderValidation {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Carve `columns` down to `targetY` in `grid`, emitting `terrain:updated`
 * for the affected region — mirrors `carveRampSegment` (Ramp.ts). Renamed
 * from `carveLevelCells` (#1144): re-reads each column's live height at
 * carve time (staleness guard) and skips it once already at or below
 * `targetY` + epsilon, rather than iterating a precomputed 3D cell list.
 */
export function carveLevelColumns(
  _grid: VoxelGrid,
  _columns: { x: number; z: number }[],
  _targetY: number,
  _emitter?: EventEmitter,
): { voxelsCleared: number } {
  // TODO: implement
  throw new Error('not implemented');
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
 */
export function levelGroundRect(
  _grid: VoxelGrid,
  _rect: LevelOrderDef,
  _emitter?: EventEmitter,
): { targetY: number; voxelsCleared: number; region: { minX: number; maxX: number; minZ: number; maxZ: number } | null } {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to level `voxelCount`
 * voxels — same "carve N solid cells" formula a ramp segment uses, re-
 * exported under this name rather than reimplemented (#1009 review finding
 * 1). See `computeRampSegmentDurationTicks` (Ramp.ts) for the formula itself.
 */
export const computeLevelGroundDurationTicks = computeRampSegmentDurationTicks;
