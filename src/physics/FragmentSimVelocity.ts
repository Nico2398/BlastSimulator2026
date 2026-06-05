// BlastSimulator2026 — Step 4: Fragment velocity assignment
// Energy gradient × surface proximity factor; classify simulationTier
// Task 5.12

import { vec3, ZERO, normalize, length, scale, distance } from '../core/math/Vec3.js';
import {
  SURFACE_PROXIMITY_DECAY,
  MAX_PROJECTION_VELOCITY,
  PROJECTION_VELOCITY_THRESHOLD,
} from '../core/config/balance.js';
import type { Vec3 } from '../core/math/Vec3.js';
import { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { RockFragment } from './FragmentSim.js';

// ─── Internal Helpers ───────────────────────────────────────────────────

/** Check whether a voxel should be considered air (empty space). */
function isAirVoxel(voxel: { composition: { rocks: unknown[] }; density: number } | undefined): boolean {
  return voxel == null || voxel.composition.rocks.length === 0 || voxel.density <= 0;
}

// ─── Functions ──────────────────────────────────────────────────────────

/**
 * Compute the direction of steepest energy decrease using central finite differences.
 *
 * Step size δ = VoxelGrid.CELL_SIZE (1.0). For each axis:
 *   ∂E/∂x ≈ (E(x+δ) - E(x-δ)) / (2*δ)
 *
 * Returns normalize(negate(gradient)) — direction away from high energy.
 * Returns ZERO when gradient magnitude < 1e-10.
 */
export function computeEnergyGradientDirection(
  effectiveEnergy: Map<string, number>,
  point: Vec3,
  grid: VoxelGrid,
): Vec3 {
  const δ = VoxelGrid.CELL_SIZE;

  // Sample energy at (x,y,z), returning 0 if out of bounds or missing from map.
  function sampleEnergy(x: number, y: number, z: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    if (!grid.isInBounds(fx, fy, fz)) return 0;
    return effectiveEnergy.get(`${fx},${fy},${fz}`) ?? 0;
  }

  // Central finite differences for each axis
  const dEx = (sampleEnergy(point.x + δ, point.y, point.z) - sampleEnergy(point.x - δ, point.y, point.z)) / (2 * δ);
  const dEy = (sampleEnergy(point.x, point.y + δ, point.z) - sampleEnergy(point.x, point.y - δ, point.z)) / (2 * δ);
  const dEz = (sampleEnergy(point.x, point.y, point.z + δ) - sampleEnergy(point.x, point.y, point.z - δ)) / (2 * δ);

  const grad = vec3(dEx, dEy, dEz);
  const gradLen = length(grad);

  // Guard against near-zero gradient (avoids division by near-zero in normalize)
  if (gradLen < 1e-10) return ZERO;

  // Negate: fragments fly away from high energy (explosion source)
  return normalize(scale(grad, -1));
}

/**
 * Find the Euclidean distance from `point` to the centre of the nearest air voxel.
 *
 * First checks the voxel containing `point`; if air, returns 0.
 * Otherwise BFS outward in growing cubes (Chebyshev radius 1, 2, … maxRadius).
 *
 * Air is defined as: out-of-bounds (null/undefined), composition.rocks.length === 0,
 * or density <= 0.
 *
 * Returns `maxRadius * 2` as sentinel when no air voxel is found within range.
 */
export function distanceToNearestAirVoxel(
  point: Vec3,
  grid: VoxelGrid,
  maxRadius: number = 20,
): number {
  const fx = Math.floor(point.x);
  const fy = Math.floor(point.y);
  const fz = Math.floor(point.z);

  // Check the voxel the point is inside first
  const startVoxel = grid.getVoxel(fx, fy, fz);
  if (isAirVoxel(startVoxel)) return 0;

  // BFS outward — grow Chebyshev radius and check the shell each time
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          // Only check voxels on the current Chebyshev shell
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;

          const vx = fx + dx;
          const vy = fy + dy;
          const vz = fz + dz;

          const voxel = grid.getVoxel(vx, vy, vz);
          if (isAirVoxel(voxel)) {
            // Return Euclidean distance from point to centre of this air voxel
            return distance(point, vec3(vx + 0.5, vy + 0.5, vz + 0.5));
          }
        }
      }
    }
  }

  // Sentinel: no air found within maxRadius
  return maxRadius * 2;
}

/**
 * Compute surface proximity factor from distance to nearest air voxel.
 *
 * factor = exp(-distToAir * SURFACE_PROXIMITY_DECAY)
 * Negative distances are clamped to 0.
 */
export function computeSurfaceProximityFactor(distToAir: number): number {
  const d = Math.max(0, distToAir);
  return Math.exp(-d * SURFACE_PROXIMITY_DECAY);
}

/**
 * Compute the velocity magnitude for a fragment.
 *
 * v = sqrt(2 * overflowEnergy / massKg) * surfaceProximityFactor
 * Clamped to MAX_PROJECTION_VELOCITY (80 m/s).
 * Returns 0 when massKg <= 0 or overflowEnergy <= 0 (safety guards).
 */
export function computeVelocityMagnitude(
  overflowEnergy: number,
  massKg: number,
  surfaceProximityFactor: number,
): number {
  if (massKg <= 0 || overflowEnergy <= 0) return 0;
  const v = Math.sqrt((2 * overflowEnergy) / massKg) * surfaceProximityFactor;
  return Math.min(v, MAX_PROJECTION_VELOCITY);
}

/**
 * Classify a fragment's simulation tier based on velocity magnitude.
 *
 * vMag > PROJECTION_VELOCITY_THRESHOLD (2.0) → 'projected'
 * Otherwise → 'collapse'
 */
export function classifySimulationTier(vMag: number): 'projected' | 'collapse' {
  return vMag > PROJECTION_VELOCITY_THRESHOLD ? 'projected' : 'collapse';
}

/**
 * Assign velocity and simulation tier to a RockFragment.
 *
 * Combines all above functions:
 *   1. Compute energy gradient direction at fragment centroid
 *   2. Compute distance to nearest air voxel
 *   3. Compute surface proximity factor
 *   4. Compute velocity magnitude from overflow energy, mass, and factor
 *   5. Set fragment.velocity = gradDir × vMag
 *   6. Set fragment.simulationTier based on vMag
 *
 * Does NOT change fragment.state (handled by the physics step later).
 */
export function assignFragmentVelocity(
  fragment: RockFragment,
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
): void {
  const centroid = vec3(fragment.cx, fragment.cy, fragment.cz);
  const gradDir = computeEnergyGradientDirection(effectiveEnergy, centroid, grid);
  const distToAir = distanceToNearestAirVoxel(centroid, grid);
  const factor = computeSurfaceProximityFactor(distToAir);
  const vMag = computeVelocityMagnitude(fragment.overflowEnergy, fragment.massKg, factor);

  fragment.velocity = scale(gradDir, vMag);
  fragment.simulationTier = classifySimulationTier(vMag);
  // NOTE: fragment.state is intentionally NOT modified here
}
