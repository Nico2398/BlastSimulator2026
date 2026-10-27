// BlastSimulator2026 — Blast Workshop defaults that follow the permit (#2101)

import {
  CHARGE_DEFAULT_AMOUNT_KG, DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M, DRILL_GRID_DEFAULT_DEPTH_M,
} from '../config/balance.js';
import { maxFittingChargeKg } from '../mining/ChargePlan.js';
import { permitLimitsFor } from './PermitLimits.js';

/** Grid depth (m) the Drill step opens at; `undefined` grade = site without a permit. */
export function defaultGridDepthM(grade: number | undefined): number {
  if (grade === undefined) return DRILL_GRID_DEFAULT_DEPTH_M;
  return DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[grade] ?? DRILL_GRID_DEFAULT_DEPTH_M;
}

/**
 * Charge amount (kg) the Charge step opens at: largest whole kg that fits the shallowest
 * hole at `stemmingM` and keeps `holeCount` holes within the permit's per-blast charge.
 * No permit, no holes, or nothing fits => CHARGE_DEFAULT_AMOUNT_KG.
 */
export function defaultChargeKg(
  grade: number | undefined, holeCount: number, shallowestDepthM: number,
  stemmingM: number, diameterM?: number,
): number {
  if (grade === undefined || holeCount <= 0) return CHARGE_DEFAULT_AMOUNT_KG;
  const perHolePermit = permitLimitsFor(grade).maxChargeKg / holeCount;
  const fits = maxFittingChargeKg(shallowestDepthM, stemmingM, diameterM);
  const kg = Math.floor(Math.min(perHolePermit, fits));
  return kg >= 1 ? kg : CHARGE_DEFAULT_AMOUNT_KG;
}
