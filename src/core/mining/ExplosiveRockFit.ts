// BlastSimulator2026 — Explosive vs rock tier fit
// How far an explosive's tier falls short of the rock it must break.

import type { VoxelGrid } from '../world/VoxelGrid.js';

/** Dominant rock of a column together with its hardness tier. */
export interface ColumnRock {
  rockId: string;
  tier: number;
}

/** Tiers by which the rock outclasses the explosive (0 when the explosive suffices). */
export function tierShortfall(_explosiveTier: number, _rockTier: number): number {
  // TODO: implement
  return 0;
}

/** Breaking-threshold multiplier for a shortfall. */
export function tierThresholdFactor(_shortfall: number): number {
  // TODO: implement
  return 1;
}

/** Hardness tier of the dominant rock in a voxel (0 for air). */
export function dominantRockTierAt(_grid: VoxelGrid, _x: number, _y: number, _z: number): number {
  // TODO: implement
  return 0;
}

/** Modal dominant rock along a column (higher tier wins ties); null when all air. */
export function dominantRockAlongColumn(
  _grid: VoxelGrid,
  _x: number,
  _z: number,
  _surfaceY: number,
  _depth: number,
): ColumnRock | null {
  // TODO: implement
  return null;
}
