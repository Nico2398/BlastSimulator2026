// BlastSimulator2026 — Charge plan definition
// Assigns explosives and stemming to each hole in the drill plan.

import { getExplosive } from '../world/ExplosiveCatalog.js';
import { tierShortfall, type ColumnRock } from './ExplosiveRockFit.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import { drawFromStockPool } from './ExplosiveStock.js';
import { t } from '../i18n/I18n.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import {
  MIN_STEMMING_M, VEHICLE_TIER_MULTIPLIERS, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG,
  CHARGE_KG_PER_METRE, CHARGE_FIT_EPSILON,
} from '../config/balance.js';

export interface HoleCharge {
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
  /** Kg of this charge drawn from warehouse stock when ordered (#1685). Absent = all paid in cash. */
  fromStockKg?: number;
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
    ...(planned.fromStockKg && { fromStockKg: planned.fromStockKg }),
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
 * Ticks for a charging-truck crew member to load a charge: base ticks scaled by
 * the truck tier's work rate, then by proficiency, need and LQ (#1649).
 */
export function computeChargeDurationTicks(
  baseTicks: number,
  tier: VehicleTier,
  proficiencyLevel: 1 | 2 | 3 | 4 | 5 = 1,
  needMultiplier: number = 1,
  lqMultiplier: number = 1,
): number {
  return computeTaskDuration(
    baseTicks / VEHICLE_TIER_MULTIPLIERS[tier].workRate, proficiencyLevel, needMultiplier, lqMultiplier, 1,
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

/** Total list-price cost of every charge in a per-hole charge map (stock-blind). */
export function plannedChargesCost(chargesByHole: Readonly<Record<string, HoleCharge>>): number {
  return Object.values(chargesByHole).reduce((sum, c) => sum + chargeOrderCost(c.explosiveId, c.amountKg), 0);
}

/** Cash/stock split of a set of charge orders (#1685). */
interface ChargeCostSplit {
  /** Cash paid at list price for the kg not covered by stock. */
  cashCost: number;
  /** List-price value of the kg drawn from stock. */
  stockValue: number;
  fromStockKg: number;
  totalKg: number;
}

/** Forward preview: draw `stock` sequentially across `orders`, list price cash for the rest (#1685). */
export function stockAwareChargesCost(
  orders: ReadonlyArray<{ explosiveId: string; amountKg: number }>,
  stock: Readonly<Record<string, number>>,
): ChargeCostSplit {
  const pool = { ...stock };
  const split: ChargeCostSplit = { cashCost: 0, stockValue: 0, fromStockKg: 0, totalKg: 0 };
  for (const o of orders) {
    const { fromStockKg, fromCashKg } = drawFromStockPool(pool, o.explosiveId, o.amountKg);
    addSplit(split, o.explosiveId, o.amountKg, fromStockKg, fromCashKg);
  }
  return split;
}

/** Split of already-ordered charges, read from each charge's recorded `fromStockKg` (#1685). */
export function recordedChargesCost(chargesByHole: Readonly<Record<string, HoleCharge>>): ChargeCostSplit {
  const split: ChargeCostSplit = { cashCost: 0, stockValue: 0, fromStockKg: 0, totalKg: 0 };
  for (const c of Object.values(chargesByHole)) {
    const fromStockKg = Math.min(c.amountKg, c.fromStockKg ?? 0);
    addSplit(split, c.explosiveId, c.amountKg, fromStockKg, c.amountKg - fromStockKg);
  }
  return split;
}

function addSplit(split: ChargeCostSplit, explosiveId: string, amountKg: number, fromStockKg: number, fromCashKg: number): void {
  if (!getExplosive(explosiveId)) return;
  split.cashCost += chargeOrderCost(explosiveId, fromCashKg);
  split.stockValue += chargeOrderCost(explosiveId, fromStockKg);
  split.fromStockKg += fromStockKg;
  split.totalKg += amountKg;
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
  const weak = present.filter(c => tierShortfall(explosive.minRockTier, c.tier) > 0);
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
