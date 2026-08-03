// BlastSimulator2026 — Blast preview software tiers
// Player purchases software upgrades to unlock prediction capabilities.
// Tier 0: no preview. Tier 1: energy. Tier 2: fragments. Tier 3: projections. Tier 4: vibrations.

import { formatMoney } from '../economy/formatMoney.js';
import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { VillagePosition } from './BlastExecution.js';
import { vec3, length } from '../math/Vec3.js';
import {
  VOXEL_SIZE_CM,
  FRAGMENTATION_MULTIPLIER,
  CRACKED_VOXEL_ENERGY_RATIO,
  PROJECTION_SPEED_THRESHOLD,
} from '../config/balance.js';
import {
  calculateVibrations,
  groupChargesByDelay,
  stemmingFactor,
} from './BlastCalc.js';
import { buildPlanEnergyField } from './BlastExecution.js';
import { effectiveAt } from './EnergyPropagation.js';
import { computeFragmentVelocity, throwFractionForBlowout } from './FragmentVelocity.js';
import {
  computeHoleContext,
  readVoxelPrediction,
  predictFragmentation,
  getBlastBBox,
  forEachBBoxVoxel,
} from './SoftwarePreview.js';

/**
 * Stemming of the hole nearest a point, as the share of leftover energy that
 * still throws rock there — the same rule the blast applies.
 */
function throwFractionAtHole(plan: BlastPlan, x: number, z: number): number {
  let nearest = plan.holes[0];
  let bestDist = Infinity;
  for (const hole of plan.holes) {
    const d = (hole.x - x) ** 2 + (hole.z - z) ** 2;
    if (d < bestDist) { bestDist = d; nearest = hole; }
  }
  if (!nearest) return 1;
  const charge = plan.charges[nearest.id];
  return throwFractionForBlowout(charge ? 1 - stemmingFactor(charge.stemmingM, nearest.depth) : 1);
}

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

  const field = buildPlanEnergyField(plan, grid);
  if (!field) return { energyMap: new Map(), maxEnergy: 0, minEnergy: 0 };

  const ctx = computeHoleContext(plan, grid);
  const bbox = getBlastBBox(plan, ctx);
  const energyMap = new Map<string, number>();
  let maxEnergy = 0;
  let minEnergy = Infinity;

  forEachBBoxVoxel(grid, bbox, (x, y, z) => {
    const energy = effectiveAt(field, x, y, z);
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

  const field = buildPlanEnergyField(plan, grid);
  if (!field) return { fracturedCount: 0, crackedCount: 0, unaffectedCount: 0, avgFragmentSize: 1 };

  const ctx = computeHoleContext(plan, grid);
  const bbox = getBlastBBox(plan, ctx);
  let fractured = 0, cracked = 0, unaffected = 0;
  let totalFragSize = 0;

  forEachBBoxVoxel(grid, bbox, (x, y, z, voxel) => {
    const vet = readVoxelPrediction(field, voxel, x, y, z);
    if (!vet || vet.threshold <= 0) return;

    if (vet.energy >= FRAGMENTATION_MULTIPLIER * vet.threshold) {
      fractured++;
      totalFragSize += predictFragmentation(vet.intensity).sizeM3;
    } else if (vet.energy >= CRACKED_VOXEL_ENERGY_RATIO * vet.threshold) {
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

  const field = buildPlanEnergyField(plan, grid);
  if (!field) return { projectionZoneCount: 0, projectionZonePositions: [] };

  const ctx = computeHoleContext(plan, grid);
  const bbox = getBlastBBox(plan, ctx);
  const positions: Array<{ x: number; y: number; z: number }> = [];

  forEachBBoxVoxel(grid, bbox, (x, y, z, voxel) => {
    const vet = readVoxelPrediction(field, voxel, x, y, z);
    if (!vet || vet.threshold <= 0) return;

    // Rock is only thrown if it broke, has leftover energy behind it, and has a
    // face to leave by — the same three conditions the blast itself applies.
    if (vet.energy < FRAGMENTATION_MULTIPLIER * vet.threshold) return;
    const velocity = computeFragmentVelocity(
      vec3(x, y, z),
      [{ x, y, z, weight: 1 }],
      vet.rock.density,
      field,
      throwFractionAtHole(plan, x, z),
    );
    if (length(velocity) > PROJECTION_SPEED_THRESHOLD) positions.push({ x, y, z });
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

  const field = buildPlanEnergyField(plan, grid);
  if (!field) return result;
  const ctx = computeHoleContext(plan, grid);

  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge) continue;

    const surfaceY = ctx.holeSurfaceYs[hole.id] ?? 0;
    const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(hole.x)));
    const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(hole.z)));
    const gy = Math.max(0, Math.min(grid.sizeY - 1, surfaceY - 1));
    const voxel = grid.getVoxel(gx, gy, gz);
    if (!voxel || voxel.density <= 0) continue;
    const vet = readVoxelPrediction(field, voxel, gx, gy, gz);
    if (!vet) continue;

    const predicted = predictFragmentation(vet.intensity);
    const detail: HolePreviewDetail = {
      // Edge length of the predicted piece, so a bigger number reads as coarser rock.
      fragSizeCm: Math.cbrt(predicted.sizeM3) * VOXEL_SIZE_CM,
    };

    if (softwareTier >= 3) {
      const velocity = computeFragmentVelocity(
        vec3(gx, gy, gz),
        [{ x: gx, y: gy, z: gz, weight: 1 }],
        vet.rock.density,
        field,
        throwFractionForBlowout(1 - stemmingFactor(charge.stemmingM, hole.depth)),
      );
      const speed = length(velocity);
      if (speed > PROJECTION_SPEED_THRESHOLD) detail.projectionSpeedMs = speed;
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

