// BlastSimulator2026 — Ground levelling system (#1009)
// Flattens a rectangular area to one target Y so it later passes the flat-
// footprint building-placement rule (#1008). Mirrors the order-then-work
// shape `dig_ramp_segment`/Ramp.ts established: validate at order time,
// carve progressively as a `level_ground` PendingAction.
//
// TODO: implement — skeleton phase only, every export below throws.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VehicleTier } from '../entities/Vehicle.js';

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
 * Target Y the rectangle should be levelled to.
 * TODO: implement.
 */
export function computeLevelTargetY(_grid: VoxelGrid, _rect: LevelOrderDef): number {
  throw new Error('not implemented');
}

/**
 * Cells to carve (or fill) so every column in `rect` reaches `targetY`.
 * TODO: implement.
 */
export function computeLevelCells(
  _grid: VoxelGrid,
  _rect: LevelOrderDef,
  _targetY: number,
): { x: number; y: number; z: number }[] {
  throw new Error('not implemented');
}

/**
 * Bounding box of `cells`, or null when empty — mirrors the `region` shape
 * ramp segments compute for `terrain:updated`.
 * TODO: implement.
 */
export function computeLevelRegion(
  _cells: { x: number; y: number; z: number }[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  throw new Error('not implemented');
}

/**
 * Validate a level-ground order against `cash` without carving anything —
 * mirrors `validateRampOrder` (Ramp.ts): area/cash checks run before any
 * caller claims a footprint or queues work.
 * TODO: implement.
 */
export function validateLevelOrder(_rect: LevelOrderDef, _cash: number, _grid: VoxelGrid): LevelOrderValidation {
  throw new Error('not implemented');
}

/**
 * Carve `cells` into `grid`, emitting `terrain:updated` for the affected
 * region — mirrors `carveRampSegment` (Ramp.ts).
 * TODO: implement.
 */
export function carveLevelCells(
  _grid: VoxelGrid,
  _cells: { x: number; y: number; z: number }[],
  _emitter?: EventEmitter,
): { voxelsCleared: number } {
  throw new Error('not implemented');
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to level `voxelCount`
 * voxels — mirrors `computeRampSegmentDurationTicks` (Ramp.ts).
 * TODO: implement.
 */
export function computeLevelGroundDurationTicks(
  _voxelCount: number,
  _tier: VehicleTier,
  _proficiencyLevel?: number,
  _needMultiplier?: number,
  _lqMultiplier?: number,
): number {
  throw new Error('not implemented');
}
