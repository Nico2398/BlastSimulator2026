// BlastSimulator2026 — Charge plan definition
// Assigns explosives and stemming to each hole in the drill plan.

import { getExplosive } from '../world/ExplosiveCatalog.js';
import { t } from '../i18n/I18n.js';
import { computeRigDurationTicks, type VehicleTier } from '../entities/Vehicle.js';
import {
  MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG,
  CHARGE_FIT_EPSILON, DRILL_HOLE_DEFAULT_DIAMETER_M, DRILL_GRID_DEFAULT_SPACING_M, HOLE_CELL_MAX_SIDE_M,
} from '../config/balance.js';
import type { DrillHole, HoleCellSize } from './DrillPlan.js';
import { chargeKgPerMetre } from './HoleDiameter.js';

export interface HoleCharge {
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
}

/** The pattern's charge settings: a null `amountKg` fills every hole up to the stemming. */
export interface PatternCharge {
  explosiveId: string;
  amountKg: number | null;
  stemmingM: number;
}

export interface ChargeError {
  holeId: string;
  message: string;
}

/**
 * Validate and create a charge for a single hole.
 *
 * `amountKg` null fills the hole: the explosive runs from the bottom up to the stemming
 * (`fillChargeKg`), which is how a hole is charged. An explicit amount is a partial charge
 * sitting at the bottom of the hole, kept for scripts.
 */
export function createCharge(
  explosiveId: string,
  amountKg: number | null,
  stemmingM: number,
  holeDepth: number,
  diameterM: number = DRILL_HOLE_DEFAULT_DIAMETER_M,
): { charge: HoleCharge } | { error: string } {
  if (!getExplosive(explosiveId)) {
    return { error: `Unknown explosive: "${explosiveId}"` };
  }
  if (!Number.isFinite(stemmingM) || stemmingM < MIN_STEMMING_M) {
    return { error: `Stemming ${stemmingM}m below minimum ${MIN_STEMMING_M}m` };
  }
  if (stemmingM > holeDepth) {
    return { error: `Stemming ${stemmingM}m exceeds hole depth ${holeDepth}m` };
  }
  if (amountKg !== null && (!Number.isFinite(amountKg) || amountKg <= 0)) {
    return { error: t('mining.charge.invalid_amount', { amount: String(amountKg) }) };
  }
  const amount = amountKg ?? fillChargeKg(holeDepth, stemmingM, diameterM, explosiveId);
  if (!(amount > 0)) {
    return { error: t('mining.charge.no_room', { stemming: stemmingM, depth: holeDepth }) };
  }
  if (!chargeFitsHole(amount, stemmingM, holeDepth, diameterM, explosiveId)) {
    return {
      error: t('mining.charge.column_exceeds_hole', {
        amount,
        column: +chargeColumnM(amount, diameterM, explosiveId).toFixed(2),
        stemming: stemmingM,
        depth: holeDepth,
        max: maxFittingChargeKg(holeDepth, stemmingM, diameterM, explosiveId),
      }),
    };
  }
  return { charge: { explosiveId, amountKg: amount, stemmingM } };
}


/** Batch-charge all holes with the same settings (`amountKg` null fills each hole). Returns errors for invalid ones. */
export function batchCharge(
  holeIds: string[],
  holeDepths: Record<string, number>,
  explosiveId: string,
  amountKg: number | null,
  stemmingM: number,
  holeDiameters?: Record<string, number>,
): { charges: Record<string, HoleCharge>; errors: ChargeError[] } {
  const charges: Record<string, HoleCharge> = {};
  const errors: ChargeError[] = [];

  for (const id of holeIds) {
    const depth = holeDepths[id] ?? 0;
    const result = createCharge(explosiveId, amountKg, stemmingM, depth, holeDiameters?.[id]);
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
  return computeRigDurationTicks(baseTicks, tier, proficiencyLevel, needMultiplier, lqMultiplier);
}

/**
 * Cash cost of ordering a charge: costPerKg * amountKg. 0 for an unknown
 * explosive id (#1341).
 */
export function chargeOrderCost(explosiveId: string, amountKg: number): number {
  const explosive = getExplosive(explosiveId);
  return explosive ? explosive.costPerKg * amountKg : 0;
}

/** Total list-price cost of every charge in a per-hole charge map. */
export function plannedChargesCost(chargesByHole: Readonly<Record<string, HoleCharge>>): number {
  return Object.values(chargesByHole).reduce((sum, c) => sum + chargeOrderCost(c.explosiveId, c.amountKg), 0);
}

/** Metres of hole column that `amountKg` of the explosive occupies (reference density when none is given). */
export function chargeColumnM(amountKg: number, diameterM?: number, explosiveId?: string): number {
  return amountKg / chargeKgPerMetre(diameterM, explosiveId);
}

/** Raw (unrounded) heaviest charge that fits a hole of `holeDepth` under `stemmingM`; never negative. */
export function maxChargeKgForHole(holeDepth: number, stemmingM: number, diameterM?: number, explosiveId?: string): number {
  return Math.max(0, (holeDepth - stemmingM) * chargeKgPerMetre(diameterM, explosiveId));
}

/** True when `amountKg` plus `stemmingM` of stemming fits a hole of `holeDepth` (within float tolerance). */
export function chargeFitsHole(amountKg: number, stemmingM: number, holeDepth: number, diameterM?: number, explosiveId?: string): boolean {
  return chargeColumnM(amountKg, diameterM, explosiveId) + stemmingM <= holeDepth + CHARGE_FIT_EPSILON;
}

/** Heaviest charge to show/accept for a hole: floored to 0.1 kg so the displayed maximum is itself accepted. */
export function maxFittingChargeKg(holeDepth: number, stemmingM: number, diameterM?: number, explosiveId?: string): number {
  const kg = maxChargeKgForHole(holeDepth, stemmingM, diameterM, explosiveId) + CHARGE_FIT_EPSILON;
  return Math.floor(kg * 10) / 10;
}

/** Kg a hole holds when filled from the bottom up to `stemmingM` of stemming: how a hole is charged. */
export function fillChargeKg(holeDepth: number, stemmingM: number, diameterM?: number, explosiveId?: string): number {
  return maxFittingChargeKg(holeDepth, stemmingM, diameterM, explosiveId);
}

type HolePoint = Pick<DrillHole, 'id' | 'x' | 'z'>;

/** Spacing a hole is given for its rock cell: distance to the nearest other hole, the default grid spacing when alone (#2203). */
export function holeSpacingM(hole: HolePoint, holes: readonly HolePoint[]): number {
  let best = Infinity;
  for (const other of holes) {
    if (other.id === hole.id) continue;
    best = Math.min(best, Math.hypot(other.x - hole.x, other.z - hole.z));
  }
  return Number.isFinite(best) && best > 0 ? Math.min(best, HOLE_CELL_MAX_SIDE_M) : DRILL_GRID_DEFAULT_SPACING_M;
}

/**
 * The rock cell a hole works: its pattern's spacing along the row and burden between rows when it
 * was drilled as part of a grid, else a square as wide as the distance to its nearest neighbour.
 */
export function holeCellSize(hole: HolePoint & Pick<DrillHole, 'spacingM' | 'burdenM'>, holes: readonly HolePoint[]): HoleCellSize {
  if (hole.spacingM !== undefined && hole.burdenM !== undefined && hole.spacingM > 0 && hole.burdenM > 0) {
    return { spacingM: hole.spacingM, burdenM: hole.burdenM };
  }
  const side = holeSpacingM(hole, holes);
  return { spacingM: side, burdenM: side };
}

/** Area (m²) of the rock cells a pattern works: what a blast permit measures (sum over its holes). */
export function patternAreaM2(holes: readonly (HolePoint & Pick<DrillHole, 'spacingM' | 'burdenM'>)[]): number {
  let area = 0;
  for (const hole of holes) {
    const cell = holeCellSize(hole, holes);
    area += cell.spacingM * cell.burdenM;
  }
  return area;
}

/** Kilograms of explosive per m3 of rock in a hole's cell of `spacingM` x `burdenM` x `depthM` (#2203). */
export function powderFactor(amountKg: number, depthM: number, spacingM: number, burdenM: number = spacingM): number {
  if (!(depthM > 0) || !(spacingM > 0) || !(burdenM > 0)) return 0;
  return amountKg / (spacingM * burdenM * depthM);
}

/** Powder factor of every charged hole, keyed by hole id (#2203). */
export function holePowderFactors(
  holes: readonly DrillHole[],
  charges: Readonly<Record<string, HoleCharge>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hole of holes) {
    const charge = charges[hole.id];
    if (!charge) continue;
    const cell = holeCellSize(hole, holes);
    out[hole.id] = powderFactor(charge.amountKg, hole.depth, cell.spacingM, cell.burdenM);
  }
  return out;
}
