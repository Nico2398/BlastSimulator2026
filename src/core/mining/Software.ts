// BlastSimulator2026 — Blast preview software tiers
// Player purchases software upgrades to unlock prediction capabilities.
// Tier 0: no preview. Tier 1: energy. Tier 2: fragments. Tier 3: projections. Tier 4: vibrations.

import { formatMoney } from '../economy/formatMoney.js';
import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { VillagePosition } from './BlastExecution.js';
import { vec3 } from '../math/Vec3.js';
import { VOXEL_SIZE_CM, MAX_PROJECTION_VELOCITY } from '../config/balance.js';
import {
  calculateEnergyField,
  calculateFragmentation,
  calculateVibrations,
  groupChargesByDelay,
} from './BlastCalc.js';
import {
  computeHoleContext,
  computeEnergyThresholdForVoxel,
  getVoxelEnergyThreshold,
  getBlastBBox,
  forEachBBoxVoxel,
} from './SoftwarePreview.js';

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

/**
 * Structured, persisted snapshot of the last `blast_preview` run — what the
 * Preview step (redesign P4/§5) reads, mirroring how BlastReport serves the
 * Fire step. Null until the player has run an analysis at least once.
 * `avgFragmentSizeCm` and `collapseFragments` are pre-converted to the same
 * real units `previewHoleDetails`/`blastPreviewCommand` already use — the raw
 * `FragmentPreview.avgFragmentSize` is a 0–1 fraction of a voxel's edge, not
 * a size on its own.
 */
export interface BlastPreviewSummary {
  tier: number;
  energy: { affectedVoxels: number; minEnergy: number; maxEnergy: number } | null;
  fragments: { fractured: number; cracked: number; unaffected: number; avgFragmentSizeCm: number } | null;
  projections: { projectionZoneVoxels: number; collapseFragments: number } | null;
  vibrations: { maxVibration: number; affectedVillages: number } | null;
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
    return { error: `Insufficient funds: need $${formatMoney(cost)}, have $${formatMoney(cash)}` };
  }
  return { newTier: nextTier, cost };
}

// ── Preview functions ──

/** Preview energy field. Requires software tier >= 1. */
export function previewEnergy(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): EnergyPreview | null {
  if (softwareTier < 1) return null;

  const ctx = computeHoleContext(plan, grid);

  const bbox = getBlastBBox(plan, ctx);
  const energyMap = new Map<string, number>();
  let maxEnergy = 0;
  let minEnergy = Infinity;

  forEachBBoxVoxel(grid, bbox, (x, y, z) => {
    const energy = calculateEnergyField(vec3(x, y, z), plan.holes, plan.charges, ctx.holeDepths, ctx.holeSurfaceYs);
    if (energy > 0) {
      energyMap.set(`${x},${y},${z}`, energy);
      maxEnergy = Math.max(maxEnergy, energy);
      minEnergy = Math.min(minEnergy, energy);
    }
  });

  return { energyMap, maxEnergy, minEnergy: minEnergy === Infinity ? 0 : minEnergy };
}

/** Preview fragmentation quality. Requires software tier >= 2. */
export function previewFragments(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): FragmentPreview | null {
  if (softwareTier < 2) return null;

  const ctx = computeHoleContext(plan, grid);

  const bbox = getBlastBBox(plan, ctx);
  let fractured = 0, cracked = 0, unaffected = 0;
  let totalFragSize = 0;

  forEachBBoxVoxel(grid, bbox, (x, y, z, voxel) => {
    const vet = computeEnergyThresholdForVoxel(voxel, vec3(x, y, z), plan, ctx);
    if (!vet) return;

    const frag = calculateFragmentation(vet.energy, vet.threshold);

    if (frag.result === 'fractured') {
      fractured++;
      totalFragSize += frag.fragmentSizeFraction;
    } else if (frag.result === 'cracked') {
      cracked++;
    } else {
      unaffected++;
    }
  });

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

  const ctx = computeHoleContext(plan, grid);

  const bbox = getBlastBBox(plan, ctx);
  const positions: Array<{ x: number; y: number; z: number }> = [];

  forEachBBoxVoxel(grid, bbox, (x, y, z, voxel) => {
    const vet = computeEnergyThresholdForVoxel(voxel, vec3(x, y, z), plan, ctx);
    if (!vet) return;

    const ratio = vet.threshold > 0 ? vet.energy / vet.threshold : 0;
    if (ratio >= 4.0) {
      positions.push({ x, y, z });
    }
  });

  return { projectionZoneCount: positions.length, projectionZonePositions: positions };
}

export interface HolePreviewDetail {
  /** Predicted average fragment size at this hole's position (cm). Tier >= 2. */
  fragSizeCm?: number;
  /** Predicted projection speed (m/s), only set when the hole's rock is predicted
   *  to be thrown clear (energy ratio >= projection threshold). Tier >= 3. */
  projectionSpeedMs?: number;
}

/**
 * Preview per-hole fragmentation and projection detail, for the blast-plan
 * overlay (BlastPlanOverlay.ts) to render fragment-size dots and projection
 * arcs per hole. Tier-gated the same as previewFragments/previewProjections —
 * an entry's `fragSizeCm` is only present at tier >= 2, `projectionSpeedMs`
 * only at tier >= 3.
 */
export function previewHoleDetails(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
): Record<string, HolePreviewDetail> {
  const result: Record<string, HolePreviewDetail> = {};
  if (softwareTier < 2) return result;

  const ctx = computeHoleContext(plan, grid);

  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge) continue;

    const surfaceY = ctx.holeSurfaceYs[hole.id] ?? 0;
    const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(hole.x)));
    const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(hole.z)));
    const gy = Math.max(0, Math.min(grid.sizeY - 1, surfaceY - 1));
    const point = vec3(hole.x, surfaceY, hole.z);
    const vet = getVoxelEnergyThreshold(grid, gx, gy, gz, point, plan, ctx);
    if (!vet) continue;

    const frag = calculateFragmentation(vet.energy, vet.threshold);

    const detail: HolePreviewDetail = {
      fragSizeCm: frag.fragmentSizeFraction * VOXEL_SIZE_CM,
    };

    if (softwareTier >= 3 && frag.isProjection) {
      const overflow = Math.max(0, vet.energy - vet.threshold);
      detail.projectionSpeedMs = Math.min(
        MAX_PROJECTION_VELOCITY,
        Math.sqrt((2 * overflow) / Math.max(vet.rock.density, 1)),
      );
    }

    result[hole.id] = detail;
  }

  return result;
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

