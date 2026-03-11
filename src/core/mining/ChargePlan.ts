// BlastSimulator2026 — Charge plan definition
// Assigns explosives and stemming to each hole in the drill plan.

import { getExplosive } from '../world/ExplosiveCatalog.js';

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
  if (amountKg < explosive.minChargeKg || amountKg > explosive.maxChargeKg) {
    return {
      error: `Amount ${amountKg}kg out of range [${explosive.minChargeKg}–${explosive.maxChargeKg}kg] for ${explosiveId}`,
    };
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
