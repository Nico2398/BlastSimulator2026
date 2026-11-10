// BlastSimulator2026 — Charge optimizer (#2204)
// Proposes, per hole, the explosive and the stemming (each hole filled up to it) that maximise
// good-band rock within the permit kg limit. Stemming is only swept over lengths that throw no
// rock (`stemmingSweepRangeM`), so the proposal never trades flyrock for fragmentation.

import type { DrillHole } from './DrillPlan.js';
import { chargeOrderCost, fillChargeKg, type HoleCharge } from './ChargePlan.js';
import {
  previewPlanBands, holeBandMixes, planBandShares, stemmingSweepRangeM, type BandShares,
} from './SoftwarePreview.js';
import { isWaterSensitiveCharge, wetHoleIdsFor } from './WetHoles.js';
import type { GameState } from '../state/GameState.js';
import { resolveAvailableExplosives } from '../campaign/Level.js';
import { permitLimitsFor } from '../economy/PermitLimits.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { OPTIMIZER_SWEEP_STEPS, OPTIMIZER_MIN_SWEEP_STEPS, OPTIMIZER_WORK_BUDGET, OPTIMIZER_GOOD_TOLERANCE } from '../config/balance.js';

export interface OptimizeChargesOptions {
  /** Explosives the level offers. */
  explosiveIds: readonly string[];
  /** Wet holes: no water-sensitive explosive is proposed for them. */
  wetHoleIds?: ReadonlySet<string>;
  /** Permit kg limit for the whole plan; unlimited when omitted. */
  maxTotalKg?: number;
}

export interface ChargeProposal {
  charges: Record<string, HoleCharge>;
  holeMixes: Record<string, BandShares>;
  /** Pooled band mix of the proposed plan; null with no rock. */
  bandShares: BandShares | null;
  cost: number;
  totalKg: number;
  permitKgLimit: number;
  withinPermit: boolean;
  /** Holes no offered explosive can be proposed for. */
  skippedHoleIds: string[];
}

/** One swept charge for a hole (filled up to `stemmingM`) and the good share its rock cell got from it. */
interface Sample { explosiveId: string; stemmingM: number; kg: number; good: number; cost: number }

/** One uniform-style candidate plan: an explosive swept across the pattern, each hole at the same point of its own stemming range. */
interface Candidate { charges: Record<string, HoleCharge>; totalKg: number; pooledGood: number; complete: boolean }

/** Stemmings swept per explosive: the full sweep for small patterns, fewer as holes x explosives grow past the work budget. */
export function optimizerSweepSteps(holeCount: number, explosiveCount: number): number {
  const affordable = Math.floor(OPTIMIZER_WORK_BUDGET / Math.max(1, holeCount * explosiveCount));
  return Math.max(OPTIMIZER_MIN_SWEEP_STEPS, Math.min(OPTIMIZER_SWEEP_STEPS, affordable));
}

/** True when the explosive may be proposed for the hole: it fits, and is not water-sensitive in a wet hole. */
function eligible(hole: DrillHole, explosiveId: string, o: OptimizeChargesOptions): boolean {
  const range = stemmingSweepRangeM(hole.depth);
  if (!range || !(fillChargeKg(hole.depth, range.lo, hole.diameter, explosiveId) > 0)) return false;
  if (o.wetHoleIds?.has(hole.id) && isWaterSensitiveCharge({ explosiveId, amountKg: 1, stemmingM: range.lo })) return false;
  return true;
}

/** Stemming of sample `i` out of `steps` for a hole: most explosive first. */
function sweptStemmingM(hole: DrillHole, i: number, steps: number): number {
  const range = stemmingSweepRangeM(hole.depth)!;
  const t = steps <= 1 ? 0 : i / (steps - 1);
  return Math.round((range.lo + (range.hi - range.lo) * t) * 10) / 10;
}

function sumKg(charges: Readonly<Record<string, HoleCharge>>): number {
  let kg = 0;
  for (const c of Object.values(charges)) kg += c.amountKg;
  return kg;
}

function sumCost(charges: Readonly<Record<string, HoleCharge>>): number {
  let cost = 0;
  for (const c of Object.values(charges)) cost += chargeOrderCost(c.explosiveId, c.amountKg);
  return cost;
}

/** Cheapest sample of the hole within tolerance of its best good share. */
function pickCheapest(samples: readonly Sample[]): Sample {
  const best = Math.max(...samples.map(s => s.good));
  let pick: Sample | null = null;
  for (const s of samples) {
    if (s.good < best - OPTIMIZER_GOOD_TOLERANCE) continue;
    if (!pick || s.cost < pick.cost || (s.cost === pick.cost && s.kg < pick.kg)) pick = s;
  }
  return pick!;
}

/**
 * Lower the total to `limitKg`: repeatedly step the hole that loses the least good share per kg saved
 * down to a lighter sample. Stops when within the limit or when nothing lighter is left.
 */
function trimToLimit(picks: Map<string, Sample>, samples: ReadonlyMap<string, readonly Sample[]>, limitKg: number): void {
  let total = 0;
  for (const s of picks.values()) total += s.kg;
  while (total > limitKg + 1e-9) {
    let bestId: string | null = null;
    let bestNext: Sample | null = null;
    let bestRatio = Infinity;
    for (const [id, cur] of picks) {
      // Among lighter samples, the one keeping the most good share (then the heaviest).
      let next: Sample | null = null;
      for (const s of samples.get(id)!) {
        if (s.kg >= cur.kg - 1e-9) continue;
        if (!next || s.good > next.good || (s.good === next.good && s.kg > next.kg)) next = s;
      }
      if (!next) continue;
      const ratio = (cur.good - next.good) / (cur.kg - next.kg);
      if (ratio < bestRatio) { bestRatio = ratio; bestId = id; bestNext = next; }
    }
    if (!bestId || !bestNext) return;
    total -= picks.get(bestId)!.kg - bestNext.kg;
    picks.set(bestId, bestNext);
  }
}

/** The best charge plan for the pattern. Pure: reads the grid, changes nothing. */
export function optimizeCharges(
  holes: readonly DrillHole[],
  grid: VoxelGrid,
  options: OptimizeChargesOptions,
): ChargeProposal {
  const wet = options.wetHoleIds ?? new Set<string>();
  const limit = options.maxTotalKg ?? Infinity;
  const explosiveIds = options.explosiveIds.filter(id => getExplosive(id) !== undefined);
  const active = holes.filter(h => explosiveIds.some(id => eligible(h, id, options)));
  const activeIds = new Set(active.map(h => h.id));
  const skippedHoleIds = holes.filter(h => !activeIds.has(h.id)).map(h => h.id);
  const samples = new Map<string, Sample[]>(active.map(h => [h.id, []]));
  const candidates: Candidate[] = [];

  for (const explosiveId of explosiveIds) {
    const usable = active.filter(h => eligible(h, explosiveId, options));
    if (usable.length === 0) continue;
    const steps = optimizerSweepSteps(active.length, explosiveIds.length);
    for (let i = 0; i < steps; i++) {
      const charges: Record<string, HoleCharge> = {};
      for (const h of usable) {
        const stemmingM = sweptStemmingM(h, i, steps);
        const amountKg = fillChargeKg(h.depth, stemmingM, h.diameter, explosiveId);
        if (amountKg > 0) charges[h.id] = { explosiveId, amountKg, stemmingM };
      }
      const charged = usable.filter(h => charges[h.id] !== undefined);
      const map = previewPlanBands({ holes: charged, charges }, grid, wet, { fate: false });
      const mixes = holeBandMixes(map, charged);
      for (const h of charged) {
        const c = charges[h.id]!;
        const list = samples.get(h.id)!;
        if (list.some(s => s.explosiveId === explosiveId && s.stemmingM === c.stemmingM)) continue;
        list.push({ explosiveId, stemmingM: c.stemmingM, kg: c.amountKg, good: mixes[h.id]?.good ?? 0, cost: chargeOrderCost(explosiveId, c.amountKg) });
      }
      candidates.push({
        charges, totalKg: sumKg(charges), pooledGood: planBandShares(map, charged)?.good ?? 0,
        complete: charged.length === active.length,
      });
    }
  }

  const picks = new Map<string, Sample>();
  for (const h of active) picks.set(h.id, pickCheapest(samples.get(h.id)!));
  if (limit < Infinity) trimToLimit(picks, samples, limit);
  let charges: Record<string, HoleCharge> = {};
  for (const [id, s] of picks) charges[id] = { explosiveId: s.explosiveId, amountKg: s.kg, stemmingM: s.stemmingM };

  const evaluate = (c: Record<string, HoleCharge>) => {
    const map = previewPlanBands({ holes: active, charges: c }, grid, wet);
    return { mixes: holeBandMixes(map, active), pooled: planBandShares(map, active) };
  };
  let result = evaluate(charges);

  // The per-hole choice ignores how neighbouring charges overlap; a uniform plan may do better pooled.
  const best = candidates
    .filter(c => c.complete && c.totalKg <= limit + 1e-9)
    .reduce<Candidate | null>((acc, c) => (!acc || c.pooledGood > acc.pooledGood ? c : acc), null);
  if (best && best.pooledGood > (result.pooled?.good ?? 0) + 1e-12) {
    charges = best.charges;
    result = evaluate(charges);
  }

  const totalKg = sumKg(charges);
  return {
    charges,
    holeMixes: result.mixes,
    bandShares: result.pooled,
    cost: sumCost(charges),
    totalKg,
    permitKgLimit: limit,
    withinPermit: totalKg <= limit + 1e-9,
    skippedHoleIds,
  };
}

/** Optimizer options for the game's level, wet holes and permit grade (unlimited without a grade). */
export function optimizerOptionsFor(
  state: Pick<GameState, 'campaign' | 'grade' | 'drillHoles' | 'holeWater'>,
): OptimizeChargesOptions {
  return {
    explosiveIds: resolveAvailableExplosives(state.campaign.activeLevelId),
    wetHoleIds: wetHoleIdsFor(state),
    ...(state.grade ? { maxTotalKg: permitLimitsFor(state.grade.grade).maxChargeKg } : {}),
  };
}
