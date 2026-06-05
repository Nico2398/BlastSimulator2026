// BlastSimulator2026 — Step 4: Fragment velocity assignment
// Energy gradient × surface proximity factor; classify simulationTier
// Task 5.12

import type { Vec3 } from '../core/math/Vec3.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { RockFragment } from './FragmentSim.js';

// ─── Functions ──────────────────────────────────────────────────────────

export function computeEnergyGradientDirection(
  _effectiveEnergy: Map<string, number>,
  _point: Vec3,
  _grid: VoxelGrid,
): Vec3 {
  throw new Error('Not implemented');
}

export function distanceToNearestAirVoxel(
  _point: Vec3,
  _grid: VoxelGrid,
  _maxRadius?: number,
): number {
  throw new Error('Not implemented');
}

export function computeSurfaceProximityFactor(
  _distToAir: number,
): number {
  throw new Error('Not implemented');
}

export function computeVelocityMagnitude(
  _overflowEnergy: number,
  _massKg: number,
  _surfaceProximityFactor: number,
): number {
  throw new Error('Not implemented');
}

export function classifySimulationTier(
  _vMag: number,
): 'projected' | 'collapse' {
  throw new Error('Not implemented');
}

export function assignFragmentVelocity(
  _fragment: RockFragment,
  _effectiveEnergy: Map<string, number>,
  _grid: VoxelGrid,
): void {
  throw new Error('Not implemented');
}
