// BlastSimulator2026 — Blast execution pipeline
// Orchestrates: validate → energy → fragmentation → terrain subtraction → results
// Pure function operating on GameState + VoxelGrid, no side effects.

import type { Vec3 } from '../math/Vec3.js';
import { vec3 } from '../math/Vec3.js';
import type { DrillHole } from './DrillPlan.js';
// HoleCharge used via plan.charges values
import type { BlastPlan } from './BlastPlan.js';
import { validateBlastPlan } from './BlastPlan.js';
import {
  calculateEnergyField,
  calculateFragmentation,
  calculateFragmentCount,
  calculateInitialVelocity,
  calculateVibrations,
  groupChargesByDelay,
} from './BlastCalc.js';
import { getRock } from '../world/RockCatalog.js';
import { getOre } from '../world/OreCatalog.js';
import type { VoxelGrid, VoxelData } from '../world/VoxelGrid.js';

// ── Config ──

/** Blast zone radius around each hole (voxels). */
const BLAST_ZONE_RADIUS = 5;
/** Default voxel size in meters. */
const VOXEL_SIZE = 1.0;
/** Default ground factor for vibration. */
const DEFAULT_GROUND_FACTOR = 1.0;

// ── Fragment Data ──

export interface FragmentData {
  id: number;
  position: Vec3;
  volume: number;
  mass: number;
  rockId: string;
  oreDensities: Record<string, number>;
  initialVelocity: Vec3;
  isProjection: boolean;
}

// ── Blast Report ──

export type BlastRating = 'perfect' | 'good' | 'mediocre' | 'bad' | 'catastrophic';

export interface VillageVibration {
  villageId: string;
  position: Vec3;
  vibration: number;
}

export interface BlastResult {
  fragments: FragmentData[];
  fragmentCount: number;
  averageFragmentSize: number;
  oversizedFragments: number;
  projectionCount: number;
  maxProjectionSpeed: number;
  vibrationAtVillages: VillageVibration[];
  totalRockVolume: number;
  totalOreValue: number;
  rating: BlastRating;
  crackedVoxels: number;
  clearedVoxels: number;
}

// ── Village (for vibration targets) ──

export interface VillagePosition {
  id: string;
  position: Vec3;
}

// ── Pipeline ──

/**
 * Execute a blast on the voxel grid.
 * This is the central blast pipeline:
 *   1. Validate plan
 *   2. Calculate blast zone bounding box
 *   3. For each voxel in zone: calculate energy, fragmentation
 *   4. Generate fragments from fractured voxels
 *   5. Subtract fractured voxels from terrain
 *   6. Calculate vibrations at villages
 *   7. Produce BlastResult with rating
 *
 * Mutates the VoxelGrid (clears fractured voxels).
 * Returns null if the plan is invalid.
 */
export function executeBlast(
  plan: BlastPlan,
  grid: VoxelGrid,
  villages: readonly VillagePosition[],
  groundFactor: number = DEFAULT_GROUND_FACTOR,
): BlastResult | null {
  // 1. Validate
  const errors = validateBlastPlan(plan);
  if (errors.length > 0) return null;

  // 2a. Compute terrain surface Y for each hole so the blast zone and energy
  //     are anchored at the actual surface, not hardcoded y=0.
  const holeSurfaceYs: Record<string, number> = {};
  for (const hole of plan.holes) {
    holeSurfaceYs[hole.id] = getColumnSurfaceY(grid, hole.x, hole.z);
  }

  // 2b. Calculate blast zone bounding box anchored at the surface
  const bbox = calculateBlastZone(plan.holes, holeSurfaceYs);

  // 3-4. Process each voxel: energy → fragmentation → fragments
  const fragments: FragmentData[] = [];
  let fragmentIdCounter = 0;
  let totalRockVolume = 0;
  let totalOreValue = 0;
  let oversizedFragments = 0;
  let crackedVoxels = 0;
  let clearedVoxels = 0;

  // Build hole depth lookup
  const holeDepths: Record<string, number> = {};
  for (const hole of plan.holes) {
    holeDepths[hole.id] = hole.depth;
  }

  // Track which voxels to clear (defer clearing for free-face consistency)
  const toClear: Array<{ x: number; y: number; z: number }> = [];

  for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        const voxel = grid.getVoxel(x, y, z);
        if (!voxel || voxel.density <= 0) continue;

        const rock = getRock(voxel.rockId);
        if (!rock) continue;

        const point = vec3(x, y, z);
        const energy = calculateEnergyField(point, plan.holes, plan.charges, holeDepths, holeSurfaceYs);
        const threshold = rock.fractureThreshold * voxel.fractureModifier;
        const frag = calculateFragmentation(energy, threshold);

        if (frag.result === 'fractured') {
          const voxelVolume = VOXEL_SIZE * VOXEL_SIZE * VOXEL_SIZE;
          const fragCount = calculateFragmentCount(voxelVolume, frag.fragmentSizeFraction);
          const mass = (rock.density * voxelVolume) / fragCount;

          // Find nearest hole for velocity direction (use mid-column as source)
          const nearestHole = findNearestHole(point, plan.holes);
          const nearestSurfaceY = holeSurfaceYs[nearestHole.id] ?? 0;
          const holePos = vec3(nearestHole.x, nearestSurfaceY - nearestHole.depth / 2, nearestHole.z);

          for (let i = 0; i < fragCount; i++) {
            const vel = calculateInitialVelocity(point, holePos, energy / fragCount, mass);
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

            fragments.push({
              id: fragmentIdCounter++,
              position: point,
              volume: voxelVolume / fragCount,
              mass,
              rockId: voxel.rockId,
              oreDensities: { ...voxel.oreDensities },
              initialVelocity: vel,
              isProjection: frag.isProjection || speed > 15,
            });
          }

          // Accumulate ore value
          totalOreValue += calculateOreValue(voxel, VOXEL_SIZE);
          totalRockVolume += voxelVolume;

          // Check oversized: fragment size > 0.8 voxel is "oversized" (barely fractured, needs secondary blast)
          // Ratio 1.0-1.3 produces sizes 0.8-1.0 — these are the boulder-like results.
          if (frag.fragmentSizeFraction > 0.8) {
            oversizedFragments += fragCount;
          }

          toClear.push({ x, y, z });
          clearedVoxels++;
        } else if (frag.result === 'cracked') {
          // Reduce fracture modifier by 30% for future blasts
          grid.setVoxel(x, y, z, {
            ...voxel,
            fractureModifier: voxel.fractureModifier * 0.7,
          });
          crackedVoxels++;
        }
      }
    }
  }

  // 5. Subtract fractured voxels from terrain
  for (const { x, y, z } of toClear) {
    grid.clearVoxel(x, y, z);
  }

  // 6. Calculate vibrations at villages
  const chargePerDelay = groupChargesByDelay(plan.holes, plan.charges, plan.delays);
  const vibrationAtVillages: VillageVibration[] = villages.map(v => {
    const blastCenter = calculateBlastCenter(plan.holes);
    const dx = v.position.x - blastCenter.x;
    const dz = v.position.z - blastCenter.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return {
      villageId: v.id,
      position: v.position,
      vibration: calculateVibrations(chargePerDelay, Math.max(distance, 1), groundFactor),
    };
  });

  // 7. Compute stats and rating
  const projectionCount = fragments.filter(f => f.isProjection).length;
  const maxProjectionSpeed = fragments.reduce((max, f) => {
    const speed = Math.sqrt(
      f.initialVelocity.x ** 2 + f.initialVelocity.y ** 2 + f.initialVelocity.z ** 2,
    );
    return f.isProjection ? Math.max(max, speed) : max;
  }, 0);

  const totalVolume = fragments.reduce((s, f) => s + f.volume, 0);
  const avgSize = fragments.length > 0 ? totalVolume / fragments.length : 0;

  const maxVibration = vibrationAtVillages.reduce((m, v) => Math.max(m, v.vibration), 0);
  const rating = calculateRating(projectionCount, oversizedFragments, clearedVoxels, maxVibration, fragments.length);

  return {
    fragments,
    fragmentCount: fragments.length,
    averageFragmentSize: avgSize,
    oversizedFragments,
    projectionCount,
    maxProjectionSpeed,
    vibrationAtVillages,
    totalRockVolume,
    totalOreValue,
    rating,
    crackedVoxels,
    clearedVoxels,
  };
}

// ── Helpers ──

/** Find the highest solid voxel Y in the column at (x, z). Returns 0 if none found. */
function getColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(x)));
  const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(z)));
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const v = grid.getVoxel(gx, y, gz);
    if (v && v.density >= 0.5) return y + 1;
  }
  return 0;
}

function calculateBlastZone(
  holes: readonly DrillHole[],
  holeSurfaceYs: Record<string, number>,
): {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
} {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxSurfaceY = 0;
  let maxDepth = 0;

  for (const hole of holes) {
    minX = Math.min(minX, hole.x);
    maxX = Math.max(maxX, hole.x);
    minZ = Math.min(minZ, hole.z);
    maxZ = Math.max(maxZ, hole.z);
    maxSurfaceY = Math.max(maxSurfaceY, holeSurfaceYs[hole.id] ?? 0);
    maxDepth = Math.max(maxDepth, hole.depth);
  }

  return {
    minX: Math.floor(minX - BLAST_ZONE_RADIUS),
    maxX: Math.ceil(maxX + BLAST_ZONE_RADIUS),
    // Y range: from (surface - depth - radius) up to (surface + radius)
    minY: Math.max(0, Math.floor(maxSurfaceY - maxDepth - BLAST_ZONE_RADIUS)),
    maxY: Math.ceil(maxSurfaceY + BLAST_ZONE_RADIUS),
    minZ: Math.floor(minZ - BLAST_ZONE_RADIUS),
    maxZ: Math.ceil(maxZ + BLAST_ZONE_RADIUS),
  };
}

function findNearestHole(point: Vec3, holes: readonly DrillHole[]): DrillHole {
  let nearest = holes[0]!;
  let minDist = Infinity;
  for (const hole of holes) {
    const dx = point.x - hole.x;
    const dz = point.z - hole.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minDist) {
      minDist = d2;
      nearest = hole;
    }
  }
  return nearest;
}

function calculateBlastCenter(holes: readonly DrillHole[]): { x: number; z: number } {
  let sx = 0, sz = 0;
  for (const hole of holes) {
    sx += hole.x;
    sz += hole.z;
  }
  return { x: sx / holes.length, z: sz / holes.length };
}

function calculateOreValue(voxel: VoxelData, voxelSize: number): number {
  const volume = voxelSize * voxelSize * voxelSize;
  let value = 0;
  for (const [oreId, density] of Object.entries(voxel.oreDensities)) {
    const ore = getOre(oreId);
    if (ore && density > 0) {
      // Ore mass = volume × density_fraction × arbitrary ore_density (assume 2500 kg/m³ for ore)
      // Real ore density: 2500–4000 kg/m³ (iron ore ~3500)
      const oreMass = volume * density * 2500;
      value += oreMass * ore.valuePerKg;
    }
  }
  return value;
}

/**
 * Determine blast rating. Per BLAST_SYSTEM.md §8.1:
 * Rating is primarily safety-driven (projections, vibrations).
 * Fragmentation quality is secondary — real blasts always produce a size distribution.
 */
function calculateRating(
  projections: number,
  _oversized: number,
  cleared: number,
  maxVibration: number,
  totalFragments: number,
): BlastRating {
  if (cleared === 0) return 'bad'; // Nothing blasted = bad plan

  const projRatio = totalFragments > 0 ? projections / totalFragments : 0;

  // Catastrophic: mass projections or extreme vibration
  if (projRatio > 0.10 || maxVibration > 50) return 'catastrophic';
  // Bad: significant projections or moderate vibration
  if (projRatio > 0.03 || maxVibration > 20) return 'bad';
  // Mediocre: some projections
  if (projections > 3) return 'mediocre';
  // Good: 1-3 projections, some fragmentation happened
  if (projections > 0) return 'good';
  // Perfect: no projections, no vibration issues, rock was cleared
  return 'perfect';
}
