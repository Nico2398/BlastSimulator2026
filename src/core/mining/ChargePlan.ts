// BlastSimulator2026 — Charge plan definition
// Assigns explosives and stemming to each hole in the drill plan.

import { getExplosive } from '../world/ExplosiveCatalog.js';
import type { ColumnRock } from './ExplosiveRockFit.js';
import { t } from '../i18n/I18n.js';
import {
  MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG,
  CHARGE_KG_PER_METRE, CHARGE_FIT_EPSILON,
} from '../config/balance.js';

export interface HoleCharge {
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
}

export interface ChargeError {
  holeId: string;
  message: string;
}

/** Validate and create a charge for a single hole. */
export function createCharge(
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
  holeDepth: number,
): { charge: HoleCharge } | { error: string } {
  const explosive = getExplosive(explosiveId);
  if (!explosive) {
    return { error: `Unknown explosive: "${explosiveId}"` };
  }
  if (!Number.isFinite(amountKg) || amountKg < explosive.minChargeKg || amountKg > explosive.maxChargeKg) {
    return {
      error: `Amount ${amountKg}kg out of range [${explosive.minChargeKg}–${explosive.maxChargeKg}kg] for ${explosiveId}`,
    };
  }
  if (!Number.isFinite(stemmingM) || stemmingM < MIN_STEMMING_M) {
    return { error: `Stemming ${stemmingM}m below minimum ${MIN_STEMMING_M}m` };
  }
  if (stemmingM > holeDepth) {
    return { error: `Stemming ${stemmingM}m exceeds hole depth ${holeDepth}m` };
  }
  if (!chargeFitsHole(amountKg, stemmingM, holeDepth)) {
    return {
      error: t('mining.charge.column_exceeds_hole', {
        amount: amountKg,
        column: +chargeColumnM(amountKg).toFixed(2),
        stemming: stemmingM,
        depth: holeDepth,
        max: maxFittingChargeKg(holeDepth, stemmingM),
      }),
    };
  }
  return { charge: { explosiveId, amountKg, stemmingM } };
}


/** Batch-charge all holes with the same settings. Returns errors for invalid ones. */
export function batchCharge(
  holeIds: string[],
  holeDepths: Record<string, number>,
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
): { charges: Record<string, HoleCharge>; errors: ChargeError[] } {
  const charges: Record<string, HoleCharge> = {};
  const errors: ChargeError[] = [];

  for (const id of holeIds) {
    const depth = holeDepths[id] ?? 0;
    const result = createCharge(explosiveId, amountKg, stemmingM, depth);
    if ('charge' in result) {
      charges[id] = result.charge;
    } else {
      errors.push({ holeId: id, message: result.error });
    }
  }
  return { charges, errors };
}

/** A charge ordered but not yet loaded — queues one `charge_hole` action per hole (#554), mirroring PlannedHole (#553). */
export type PlannedCharge = HoleCharge;

/**
 * Land a planned (ordered-but-not-loaded) charge into a completed `HoleCharge`
 * once its `charge_hole` action finishes (#554).
 */
export function landLoadedCharge(planned: PlannedCharge): HoleCharge {
  return {
    explosiveId: planned.explosiveId,
    amountKg: planned.amountKg,
    stemmingM: planned.stemmingM,
  };
}

/**
 * Ticks to load a charge of the given amount, mirroring
 * computeDrillHoleDurationTicks's scaling against a reference amount (#554).
 */
export function computeChargeHoleDurationTicks(amountKg: number): number {
  return Math.max(
    1,
    Math.round(CHARGE_HOLE_BASE_DURATION_TICKS * (amountKg / CHARGE_HOLE_REFERENCE_AMOUNT_KG)),
  );
}

/**
 * Cash cost of ordering a charge: costPerKg * amountKg. 0 for an unknown
 * explosive id (#1341).
 */
export function chargeOrderCost(explosiveId: string, amountKg: number): number {
  const explosive = getExplosive(explosiveId);
  return explosive ? explosive.costPerKg * amountKg : 0;
}

/** Total cash cost of every charge in a per-hole charge map. */
export function plannedChargesCost(chargesByHole: Readonly<Record<string, HoleCharge>>): number {
  return Object.values(chargesByHole).reduce((sum, c) => sum + chargeOrderCost(c.explosiveId, c.amountKg), 0);
}

/** Metres of hole column that `amountKg` of explosive occupies. */
export function chargeColumnM(amountKg: number): number {
  return amountKg / CHARGE_KG_PER_METRE;
}

/** Raw (unrounded) heaviest charge that fits a hole of `holeDepth` under `stemmingM`; never negative. */
export function maxChargeKgForHole(holeDepth: number, stemmingM: number): number {
  return Math.max(0, (holeDepth - stemmingM) * CHARGE_KG_PER_METRE);
}

/** True when `amountKg` plus `stemmingM` of stemming fits a hole of `holeDepth` (within float tolerance). */
export function chargeFitsHole(amountKg: number, stemmingM: number, holeDepth: number): boolean {
  return chargeColumnM(amountKg) + stemmingM <= holeDepth + CHARGE_FIT_EPSILON;
}

/** Heaviest charge to show/accept for a hole: floored to 0.1 kg so the displayed maximum is itself accepted. */
export function maxFittingChargeKg(holeDepth: number, stemmingM: number): number {
  const kg = maxChargeKgForHole(holeDepth, stemmingM) + CHARGE_FIT_EPSILON;
  return Math.floor(kg * 10) / 10;
}

/** Count of holes whose dominant rock outclasses the explosive (#1358). */
export interface WeakHoleSummary {
  weakCount: number;
  total: number;
  rockId: string | null;
}

/** Summarise how many columns are too hard for the explosive. Null columns are skipped. */
export function weakHoleSummary(
  explosiveId: string,
  columns: readonly (ColumnRock | null)[],
): WeakHoleSummary {
  const present = columns.filter((c): c is ColumnRock => c !== null);
  const explosive = getExplosive(explosiveId);
  if (!explosive) return { weakCount: 0, total: present.length, rockId: null };
  const weak = present.filter(c => c.tier > explosive.minRockTier);
  const counts = new Map<string, { tier: number; count: number }>();
  for (const c of weak) {
    const entry = counts.get(c.rockId) ?? { tier: c.tier, count: 0 };
    entry.count++;
    counts.set(c.rockId, entry);
  }
  let rockId: string | null = null;
  let best: { tier: number; count: number } | null = null;
  for (const [id, e] of counts) {
    if (!best || e.tier > best.tier || (e.tier === best.tier && e.count > best.count)) {
      rockId = id;
      best = e;
    }
  }
  return { weakCount: weak.length, total: present.length, rockId };
}
