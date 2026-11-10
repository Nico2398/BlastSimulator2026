// BlastSimulator2026 — Charge optimizer (#2204)
// Proposes, per hole, the explosive and kg that maximise good-band rock within the permit kg limit.

import type { DrillHole } from './DrillPlan.js';
import {
  chargeOrderCost, explosiveHoleLimits, maxFittingChargeKg, chargeFitsHole, type HoleCharge,
} from './ChargePlan.js';
import {
  previewPlanBands, holeBandMixes, planBandShares, type BandShares,
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
  stemmingM: number;
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

/** One swept charge for a hole and the good share its rock cell got from it. */
interface Sample { explosiveId: string; kg: number; good: number; cost: number }

/** One uniform-style candidate plan: an explosive swept across the pattern, each hole clamped to its own range. */
interface Candidate { charges: Record<string, HoleCharge>; totalKg: number; pooledGood: number; complete: boolean }

/** Amounts swept per explosive: the full sweep for small patterns, fewer as holes x explosives grow past the work budget. */
export function optimizerSweepSteps(holeCount: number, explosiveCount: number): number {
  const affordable = Math.floor(OPTIMIZER_WORK_BUDGET / Math.max(1, holeCount * explosiveCount));
  return Math.max(OPTIMIZER_MIN_SWEEP_STEPS, Math.min(OPTIMIZER_SWEEP_STEPS, affordable));
}

const roundTenth = (kg: number): number => Math.round(kg * 10) / 10;

/** Smallest and largest kg (0.1 kg grid) of the explosive that suit the hole; null when none does. */
function holeKgRange(hole: DrillHole, explosiveId: string, stemmingM: number): { lo: number; hi: number } | null {
  const explosive = getExplosive(explosiveId);
  if (!explosive) return null;
  const limits = explosiveHoleLimits(explosive, hole.diameter);
  const lo = roundTenth(Math.ceil(limits.minKg * 10 - 1e-9) / 10);
  const hi = roundTenth(Math.floor(Math.min(limits.maxKg, maxFittingChargeKg(hole.depth, stemmingM, hole.diameter)) * 10 + 1e-9) / 10);
  if (!(lo <= hi) || !chargeFitsHole(lo, stemmingM, hole.depth, hole.diameter)) return null;
  return { lo, hi };
}

function eligible(hole: DrillHole, explosiveId: string, o: OptimizeChargesOptions): { lo: number; hi: number } | null {
  const range = holeKgRange(hole, explosiveId, o.stemmingM);
  if (!range) return null;
  if (o.wetHoleIds?.has(hole.id) && isWaterSensitiveCharge({ explosiveId, amountKg: range.lo, stemmingM: o.stemmingM })) return null;
  return range;
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
  const active = holes.filter(h => explosiveIds.some(id => eligible(h, id, options) !== null));
  const activeIds = new Set(active.map(h => h.id));
  const skippedHoleIds = holes.filter(h => !activeIds.has(h.id)).map(h => h.id);
  const samples = new Map<string, Sample[]>(active.map(h => [h.id, []]));
  const candidates: Candidate[] = [];

  for (const explosiveId of explosiveIds) {
    const ranges = new Map(active.map(h => [h.id, eligible(h, explosiveId, options)] as const));
    const usable = active.filter(h => ranges.get(h.id));
    if (usable.length === 0) continue;
    const gLo = Math.min(...usable.map(h => ranges.get(h.id)!.lo));
    const gHi = Math.max(...usable.map(h => ranges.get(h.id)!.hi));
    const steps = gHi > gLo ? optimizerSweepSteps(active.length, explosiveIds.length) : 1;
    for (let i = 0; i < steps; i++) {
      const a = steps === 1 ? gLo : gLo + (gHi - gLo) * (i / (steps - 1));
      const charges: Record<string, HoleCharge> = {};
      for (const h of usable) {
        const r = ranges.get(h.id)!;
        charges[h.id] = { explosiveId, amountKg: roundTenth(Math.min(r.hi, Math.max(r.lo, a))), stemmingM: options.stemmingM };
      }
      const map = previewPlanBands({ holes: usable, charges }, grid, wet, { fate: false });
      const mixes = holeBandMixes(map, usable);
      for (const h of usable) {
        const c = charges[h.id]!;
        const list = samples.get(h.id)!;
        if (list.some(s => s.explosiveId === explosiveId && s.kg === c.amountKg)) continue;
        list.push({ explosiveId, kg: c.amountKg, good: mixes[h.id]?.good ?? 0, cost: chargeOrderCost(explosiveId, c.amountKg) });
      }
      candidates.push({
        charges, totalKg: sumKg(charges), pooledGood: planBandShares(map, usable)?.good ?? 0,
        complete: usable.length === active.length,
      });
    }
  }

  const picks = new Map<string, Sample>();
  for (const h of active) picks.set(h.id, pickCheapest(samples.get(h.id)!));
  if (limit < Infinity) trimToLimit(picks, samples, limit);
  let charges: Record<string, HoleCharge> = {};
  for (const [id, s] of picks) charges[id] = { explosiveId: s.explosiveId, amountKg: s.kg, stemmingM: options.stemmingM };

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
  stemmingM: number,
): OptimizeChargesOptions {
  return {
    explosiveIds: resolveAvailableExplosives(state.campaign.activeLevelId),
    stemmingM,
    wetHoleIds: wetHoleIdsFor(state),
    ...(state.grade ? { maxTotalKg: permitLimitsFor(state.grade.grade).maxChargeKg } : {}),
  };
}
