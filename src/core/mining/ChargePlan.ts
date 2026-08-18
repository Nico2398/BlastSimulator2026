// BlastSimulator2026 — Charge plan definition
// Assigns explosives and stemming to each hole in the drill plan.

import { getExplosive } from '../world/ExplosiveCatalog.js';
import { MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG } from '../config/balance.js';

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
