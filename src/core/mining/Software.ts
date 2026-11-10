// BlastSimulator2026 — Blast preview software tiers
// Player purchases software upgrades to unlock prediction capabilities.
// Energy is free (the workshop heatmap, #2200). Tier 1: fragment distribution. Tier 2: projections.
// Tier 3: vibrations. Tier 4: charge optimizer (#2204).

import { formatMoney } from '../economy/formatMoney.js';
import type { BlastPlan } from './BlastPlan.js';
import { type VoxelGrid, clampToGridColumn } from '../world/VoxelGrid.js';
import type { VillagePosition, BlastRating } from './BlastExecution.js';
import type { MarketId } from '../economy/Market.js';
import { dryRunBlast, type BlastForecast } from './BlastDryRun.js';
import type { FragmentationBand } from './FragmentationBand.js';
import { vec3, length } from '../math/Vec3.js';
import {
  VOXEL_SIZE_CM,
  FRAGMENTATION_MULTIPLIER,
  CRACKED_VOXEL_ENERGY_RATIO,
  PROJECTION_SPEED_THRESHOLD,
  SOFTWARE_TIER_FRAGMENTS,
  SOFTWARE_TIER_PROJECTIONS,
  SOFTWARE_TIER_VIBRATIONS,
  SOFTWARE_TIER_OPTIMIZER,
} from '../config/balance.js';
import { optimizeCharges, type ChargeProposal, type OptimizeChargesOptions } from './ChargeOptimizer.js';
import type { DrillHole } from './DrillPlan.js';
import {
  calculateVibrations,
  totalChargeKg,
  stemmingFactor,
} from './BlastCalc.js';
import { buildPlanEnergyField, maxVillageVibration } from './BlastExecution.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
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

/** What tier 1 shows: how finely the rock breaks, read off the dry-run blast. */
interface FragmentDistribution {
  /** Volume (m3) by fragmentation band. */
  bandVolumes: Record<FragmentationBand, number>;
  fragmentCount: number;
  oversizedFragments: number;
  goodVolumeM3: number;
  finesVolumeM3: number;
  dustVolumeM3: number;
  dustLossMassKg: number;
  /** Ore value the dust band takes. */
  dustLossValue: number;
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
  /** `BLAST_PREVIEW_SHAPE` when written; an older save's preview is dropped on load. */
  shape: number;
  tier: number;
  /** Free at every tier. */
  energy: { affectedVoxels: number; minEnergy: number; maxEnergy: number };
  /** Tier 1+. */
  fragments: ({ fractured: number; cracked: number; unaffected: number; avgFragmentSizeCm: number } & FragmentDistribution) | null;
  projections: {
    projectionZoneVoxels: number;
    collapseFragments: number;
    /** Dry-run forecast fields (#1968); from the dry-run blast. */
    predictedRating: BlastRating;
    thrownFragments: number;
    totalFragments: number;
    thrownShare: number;
    furthestThrowM: number;
  } | null;
  /** affectedVillages = villages measured (all level villages), not only those above the felt floor. */
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

/**
 * Preview energy field. Available at every tier: the energy heatmap shows it with no software (#2200).
 * Previews take the same `wetHoleIds` set executeBlast receives (wetHoleIdsFor), so a
 * water-sensitive charge in a wet hole is predicted as weakened as the blast will be.
 */
export function previewEnergy(
  plan: BlastPlan,
  grid: VoxelGrid,
  _softwareTier: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): EnergyPreview | null {
  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
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

/**
 * Preview fragmentation quality. Requires software tier >= 1.
 * `fracturedCount` is the blast's cleared-voxel count (the same pass executeBlast runs), not the
 * energy-test count; `avgFragmentSize` still averages the energy-test fractured voxels.
 */
export function previewFragments(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): FragmentPreview | null {
  if (softwareTier < SOFTWARE_TIER_FRAGMENTS) return null;

  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
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

  // The blast breaks more than the energy test alone (undermined burden, graded floor, rock left
  // unsupported), so the count of voxels it will clear comes from the same pass executeBlast runs.
  const cleared = identifyFragmentedVoxels(field, grid, false).fragmented.length;
  return {
    fracturedCount: cleared,
    crackedCount: cracked,
    unaffectedCount: unaffected,
    avgFragmentSize: fractured > 0 ? totalFragSize / fractured : 1,
  };
}

/** The tier-1 content of a dry-run forecast. */
export function fragmentDistributionFrom(forecast: BlastForecast): FragmentDistribution {
  return {
    bandVolumes: forecast.bandVolumes,
    fragmentCount: forecast.fragmentCount,
    oversizedFragments: forecast.oversizedFragments,
    goodVolumeM3: forecast.bandVolumes.good,
    finesVolumeM3: forecast.bandVolumes.fines,
    dustVolumeM3: forecast.bandVolumes.dust,
    dustLossMassKg: forecast.dustLossMassKg,
    dustLossValue: forecast.dustLossValue,
  };
}

/** Dry-run the blast and read its fragment distribution. Requires software tier >= 1; null below it or without holes. */
export function previewFragmentDistribution(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
  villages: readonly VillagePosition[],
  groundFactor: number,
  wetHoleIds: ReadonlySet<string>,
  marketId?: MarketId,
): FragmentDistribution | null {
  if (softwareTier < SOFTWARE_TIER_FRAGMENTS) return null;
  const forecast = dryRunBlast(plan, grid, villages, groundFactor, wetHoleIds, marketId);
  return forecast ? fragmentDistributionFrom(forecast) : null;
}

/** Dry-run the whole blast on a forked grid. Requires software tier >= 2; null below it. */
export function previewBlastOutcome(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
  villages: readonly VillagePosition[],
  groundFactor: number,
  wetHoleIds: ReadonlySet<string>,
  marketId?: MarketId,
): BlastForecast | null {
  if (softwareTier < SOFTWARE_TIER_PROJECTIONS) return null;
  return dryRunBlast(plan, grid, villages, groundFactor, wetHoleIds, marketId);
}

/** Preview projection zones. Requires software tier >= 2. */
export function previewProjections(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): ProjectionPreview | null {
  if (softwareTier < SOFTWARE_TIER_PROJECTIONS) return null;

  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
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
  /** Predicted average fragment size at this hole's position (cm). Tier >= 1. */
  fragSizeCm?: number;
  /** Predicted projection speed (m/s), only set when the hole's rock is predicted
   *  to be thrown clear (energy ratio >= projection threshold). Tier >= 2. */
  projectionSpeedMs?: number;
}

/**
 * Preview per-hole fragmentation and projection detail, for the blast-plan
 * overlay (BlastPlanOverlay.ts) to render fragment-size dots and projection
 * arcs per hole. Tier-gated the same as previewFragments/previewProjections —
 * an entry's `fragSizeCm` is only present at tier >= 1, `projectionSpeedMs`
 * only at tier >= 2.
 */
export function previewHoleDetails(
  plan: BlastPlan,
  grid: VoxelGrid,
  softwareTier: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): Record<string, HolePreviewDetail> {
  const result: Record<string, HolePreviewDetail> = {};
  if (softwareTier < SOFTWARE_TIER_FRAGMENTS) return result;

  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
  if (!field) return result;
  const ctx = computeHoleContext(plan, grid);

  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge) continue;

    const surfaceY = ctx.holeSurfaceYs[hole.id] ?? 0;
    const { cx: gx, cz: gz } = clampToGridColumn(grid, hole.x, hole.z);
    const gy = surfaceY - 1;
    const voxel = grid.getVoxel(gx, gy, gz);
    if (!voxel || voxel.density <= 0) continue;
    const vet = readVoxelPrediction(field, voxel, gx, gy, gz);
    if (!vet) continue;

    const predicted = predictFragmentation(vet.intensity);
    const detail: HolePreviewDetail = {
      // Edge length of the predicted piece, so a bigger number reads as coarser rock.
      fragSizeCm: Math.cbrt(predicted.sizeM3) * VOXEL_SIZE_CM,
    };

    if (softwareTier >= SOFTWARE_TIER_PROJECTIONS) {
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

/**
 * Preview vibrations at villages. Requires software tier >= 3.
 * `groundFactor` must be the one executeBlast uses (base factor x averageVibrationMod) for the preview to equal the blast.
 */
export function previewVibrations(
  plan: BlastPlan,
  villages: readonly VillagePosition[],
  softwareTier: number,
  groundFactor: number = 1.0,
): VibrationPreview | null {
  if (softwareTier < SOFTWARE_TIER_VIBRATIONS) return null;

  const blastChargeKg = totalChargeKg(plan.holes, plan.charges);
  let cx = 0, cz = 0;
  for (const h of plan.holes) { cx += h.x; cz += h.z; }
  // No holes: no blast centre, so no vibration (avoids NaN distances).
  if (plan.holes.length === 0) {
    return { villages: villages.map(v => ({ villageId: v.id, vibration: 0 })), maxVibration: 0 };
  }
  cx /= plan.holes.length;
  cz /= plan.holes.length;

  const results = villages.map(v => {
    const dx = v.position.x - cx;
    const dz = v.position.z - cz;
    const distance = Math.max(1, Math.sqrt(dx * dx + dz * dz));
    return {
      villageId: v.id,
      vibration: calculateVibrations(blastChargeKg, distance, groundFactor),
    };
  });

  return {
    villages: results,
    maxVibration: maxVillageVibration(results),
  };
}


/** The charge optimizer's proposal for the pattern. Requires software tier >= 4; null below it (#2204). */
export function previewChargeOptimization(
  _holes: readonly DrillHole[],
  _grid: VoxelGrid,
  _softwareTier: number,
  _options: OptimizeChargesOptions,
): ChargeProposal | null {
  void optimizeCharges; void SOFTWARE_TIER_OPTIMIZER;
  throw new Error('not implemented');
}
