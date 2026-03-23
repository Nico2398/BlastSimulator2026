// BlastSimulator2026 — Blast preview software tiers
// Player purchases software upgrades to unlock prediction capabilities.
// Tier 0: no preview. Tier 1: energy. Tier 2: fragments. Tier 3: projections. Tier 4: vibrations.

import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { VillagePosition } from './BlastExecution.js';
import { vec3 } from '../math/Vec3.js';
import { getRock } from '../world/RockCatalog.js';
import {
  calculateEnergyField,
  calculateFragmentation,
  calculateVibrations,
  groupChargesByDelay,
} from './BlastCalc.js';

// ── Config ──

/** Cost per software tier upgrade in game dollars. */
export const SOFTWARE_TIER_COSTS: readonly number[] = [0, 500, 2000, 5000, 12000];
export const MAX_SOFTWARE_TIER = 4;

// ── Preview Data ──

export interface EnergyPreview {
  /** Map of "x,y,z" → energy value for voxels in blast zone. */
  energyMap: Map<string, number>;
  maxEnergy: number;
  minEnergy: number;
}

export interface FragmentPreview {
  /** Expected fractured voxel count. */
  fracturedCount: number;
  /** Expected cracked voxel count. */
  crackedCount: number;
  /** Expected unaffected voxel count. */
  unaffectedCount: number;
  /** Average fragment size fraction for fractured voxels. */
  avgFragmentSize: number;
}

export interface ProjectionPreview {
  /** Number of voxels where energy ratio exceeds 4.0 (projection zone). */
  projectionZoneCount: number;
  /** Positions of voxels in the projection zone. */
  projectionZonePositions: Array<{ x: number; y: number; z: number }>;
}

export interface VibrationPreview {
  villages: Array<{ villageId: string; vibration: number }>;
  maxVibration: number;
}

// ── Software state ──

export interface SoftwareState {
  tier: number;
}

export function createSoftwareState(): SoftwareState {
  return { tier: 0 };
}

/** Purchase next software tier. Returns error string if cannot purchase. */
export function purchaseSoftware(
  currentTier: number,
  cash: number,
): { newTier: number; cost: number } | { error: string } {
  const nextTier = currentTier + 1;
  if (nextTier > MAX_SOFTWARE_TIER) {
    return { error: 'Already at maximum software tier' };
  }
  const cost = SOFTWARE_TIER_COSTS[nextTier] ?? 0;
  if (cash < cost) {
    return { error: `Insufficient funds: need $${cost}, have $${cash}` };
  }
  return { newTier: nextTier, cost };
}

// ── Preview functions ──

const PREVIEW_RADIUS = 5;

/** Preview energy field. Requires software tier >= 1. */
export function previewEnergy(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): EnergyPreview | null {
  if (softwareTier < 1) return null;

  const holeDepths: Record<string, number> = {};
  for (const hole of plan.holes) holeDepths[hole.id] = hole.depth;
  const holeSurfaceYs = getHoleSurfaceYs(plan, grid);

  const bbox = getBlastBBox(plan, grid);
  const energyMap = new Map<string, number>();
  let maxEnergy = 0;
  let minEnergy = Infinity;

  for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        const voxel = grid.getVoxel(x, y, z);
        if (!voxel || voxel.density <= 0) continue;
        const energy = calculateEnergyField(vec3(x, y, z), plan.holes, plan.charges, holeDepths, holeSurfaceYs);
        if (energy > 0) {
          energyMap.set(`${x},${y},${z}`, energy);
          maxEnergy = Math.max(maxEnergy, energy);
          minEnergy = Math.min(minEnergy, energy);
        }
      }
    }
  }

  return { energyMap, maxEnergy, minEnergy: minEnergy === Infinity ? 0 : minEnergy };
}

/** Preview fragmentation quality. Requires software tier >= 2. */
export function previewFragments(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): FragmentPreview | null {
  if (softwareTier < 2) return null;

  const holeDepths: Record<string, number> = {};
  for (const hole of plan.holes) holeDepths[hole.id] = hole.depth;
  const holeSurfaceYs = getHoleSurfaceYs(plan, grid);

  const bbox = getBlastBBox(plan, grid);
  let fractured = 0, cracked = 0, unaffected = 0;
  let totalFragSize = 0;

  for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        const voxel = grid.getVoxel(x, y, z);
        if (!voxel || voxel.density <= 0) continue;
        const rock = getRock(voxel.rockId);
        if (!rock) continue;

        const energy = calculateEnergyField(vec3(x, y, z), plan.holes, plan.charges, holeDepths, holeSurfaceYs);
        const threshold = rock.fractureThreshold * voxel.fractureModifier;
        const frag = calculateFragmentation(energy, threshold);

        if (frag.result === 'fractured') {
          fractured++;
          totalFragSize += frag.fragmentSizeFraction;
        } else if (frag.result === 'cracked') {
          cracked++;
        } else {
          unaffected++;
        }
      }
    }
  }

  return {
    fracturedCount: fractured,
    crackedCount: cracked,
    unaffectedCount: unaffected,
    avgFragmentSize: fractured > 0 ? totalFragSize / fractured : 1,
  };
}

/** Preview projection zones. Requires software tier >= 3. */
export function previewProjections(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): ProjectionPreview | null {
  if (softwareTier < 3) return null;

  const holeDepths: Record<string, number> = {};
  for (const hole of plan.holes) holeDepths[hole.id] = hole.depth;
  const holeSurfaceYs = getHoleSurfaceYs(plan, grid);

  const bbox = getBlastBBox(plan, grid);
  const positions: Array<{ x: number; y: number; z: number }> = [];

  for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        const voxel = grid.getVoxel(x, y, z);
        if (!voxel || voxel.density <= 0) continue;
        const rock = getRock(voxel.rockId);
        if (!rock) continue;

        const energy = calculateEnergyField(vec3(x, y, z), plan.holes, plan.charges, holeDepths, holeSurfaceYs);
        const threshold = rock.fractureThreshold * voxel.fractureModifier;
        const ratio = threshold > 0 ? energy / threshold : 0;

        if (ratio >= 4.0) {
          positions.push({ x, y, z });
        }
      }
    }
  }

  return { projectionZoneCount: positions.length, projectionZonePositions: positions };
}

/** Preview vibrations at villages. Requires software tier >= 4. */
export function previewVibrations(
  plan: BlastPlan,
  villages: readonly VillagePosition[],
  softwareTier: number,
  groundFactor: number = 1.0,
): VibrationPreview | null {
  if (softwareTier < 4) return null;

  const chargePerDelay = groupChargesByDelay(plan.holes, plan.charges, plan.delays);
  let cx = 0, cz = 0;
  for (const h of plan.holes) { cx += h.x; cz += h.z; }
  cx /= plan.holes.length;
  cz /= plan.holes.length;

  const results = villages.map(v => {
    const dx = v.position.x - cx;
    const dz = v.position.z - cz;
    const distance = Math.max(1, Math.sqrt(dx * dx + dz * dz));
    return {
      villageId: v.id,
      vibration: calculateVibrations(chargePerDelay, distance, groundFactor),
    };
  });

  return {
    villages: results,
    maxVibration: results.reduce((m, v) => Math.max(m, v.vibration), 0),
  };
}

// ── Helpers ──

/** Compute surface Y for each hole by scanning the column from top to bottom. */
function getHoleSurfaceYs(plan: BlastPlan, grid: VoxelGrid): Record<string, number> {
  const result: Record<string, number> = {};
  for (const hole of plan.holes) {
    const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(hole.x)));
    const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(hole.z)));
    let surfaceY = 0;
    for (let y = grid.sizeY - 1; y >= 0; y--) {
      const v = grid.getVoxel(gx, y, gz);
      if (v && v.density >= 0.5) { surfaceY = y + 1; break; }
    }
    result[hole.id] = surfaceY;
  }
  return result;
}

function getBlastBBox(plan: BlastPlan, grid: VoxelGrid) {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxSurfaceY = 0;
  let maxDepth = 0;
  for (const h of plan.holes) {
    minX = Math.min(minX, h.x);
    maxX = Math.max(maxX, h.x);
    minZ = Math.min(minZ, h.z);
    maxZ = Math.max(maxZ, h.z);
    maxDepth = Math.max(maxDepth, h.depth);
    // Find surface Y for this hole column
    const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(h.x)));
    const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(h.z)));
    for (let y = grid.sizeY - 1; y >= 0; y--) {
      const v = grid.getVoxel(gx, y, gz);
      if (v && v.density >= 0.5) { maxSurfaceY = Math.max(maxSurfaceY, y + 1); break; }
    }
  }
  return {
    minX: Math.floor(minX - PREVIEW_RADIUS),
    maxX: Math.ceil(maxX + PREVIEW_RADIUS),
    minY: Math.max(0, Math.floor(maxSurfaceY - maxDepth - PREVIEW_RADIUS)),
    maxY: Math.ceil(maxSurfaceY + PREVIEW_RADIUS),
    minZ: Math.floor(minZ - PREVIEW_RADIUS),
    maxZ: Math.ceil(maxZ + PREVIEW_RADIUS),
  };
}
