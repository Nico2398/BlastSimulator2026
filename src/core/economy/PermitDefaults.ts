// BlastSimulator2026 — Blast Workshop defaults that follow the permit (#2101)

import {
  CHARGE_DEFAULT_STEMMING_M, DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M, DRILL_GRID_DEFAULT_DEPTH_M,
} from '../config/balance.js';
import { chargeKgPerMetre } from '../mining/HoleDiameter.js';
import { fillChargeKg } from '../mining/ChargePlan.js';
import type { DrillHole } from '../mining/DrillPlan.js';
import { permitLimitsFor } from './PermitLimits.js';

/** Grid depth (m) the Drill step opens at; `undefined` grade = site without a permit. */
export function defaultGridDepthM(grade: number | undefined): number {
  if (grade === undefined) return DRILL_GRID_DEFAULT_DEPTH_M;
  return DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[grade] ?? DRILL_GRID_DEFAULT_DEPTH_M;
}

/**
 * Stemming (m) the Charge step opens at: `CHARGE_DEFAULT_STEMMING_M`, raised (in 0.1 m steps) until
 * filling every hole with `explosiveId` (each fill floored to 0.1 kg, as loaded) stays within the
 * permit's per-blast charge. Every hole is
 * filled up to the stemming, so more stemming is how a pattern carries less explosive.
 * No permit or no holes => `CHARGE_DEFAULT_STEMMING_M`; a permit no stemming can meet (the holes
 * would have to stay empty) also keeps the default, and the over-permit warning says so.
 */
export function defaultStemmingM(
  grade: number | undefined,
  holes: readonly Pick<DrillHole, 'depth' | 'diameter'>[],
  explosiveId: string,
): number {
  if (grade === undefined || holes.length === 0) return CHARGE_DEFAULT_STEMMING_M;
  const limitKg = permitLimitsFor(grade).maxChargeKg;
  let kgPerMetre = 0;
  let fullColumnKg = 0;
  for (const h of holes) {
    const perMetre = chargeKgPerMetre(h.diameter, explosiveId);
    kgPerMetre += perMetre;
    fullColumnKg += h.depth * perMetre;
  }
  // Sum of (depth - s) * kg/m <= limit  <=>  s >= (sum depth * kg/m - limit) / sum kg/m.
  const needed = Math.ceil(((fullColumnKg - limitKg) / kgPerMetre) * 10 - 1e-9) / 10;
  let stemming = Math.max(CHARGE_DEFAULT_STEMMING_M, needed);
  // Each hole's fill is floored to 0.1 kg, so what it really loads can fit a shorter stemming.
  const loadKg = (s: number): number => holes.reduce((kg, h) => kg + fillChargeKg(h.depth, s, h.diameter, explosiveId), 0);
  for (let step = 0; step < MAX_ROUNDING_STEPS; step++) {
    const shorter = Math.round((stemming - 0.1) * 10) / 10;
    if (shorter < CHARGE_DEFAULT_STEMMING_M || loadKg(shorter) > limitKg) break;
    stemming = shorter;
  }
  const shallowest = Math.min(...holes.map(h => h.depth));
  return stemming < shallowest ? stemming : CHARGE_DEFAULT_STEMMING_M;
}

/** Most 0.1 m steps the rounding of the fills can win back; each hole loses under 0.1 kg to it. */
const MAX_ROUNDING_STEPS = 10;
