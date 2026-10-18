// Ore grade scale lever (#1932): scales grade thresholds by a world-level factor.
import { ORE_GRADE_SCALE_DEFAULT, ORE_GRADE_SCALE_MAX } from '../config/balance.js';

/** True for a finite ore grade scale in (0, ORE_GRADE_SCALE_MAX]. */
export function isValidOreGradeScale(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= ORE_GRADE_SCALE_MAX;
}

/** Grade scale of a world; default when absent. */
export function oreGradeScaleOf(world: { oreGradeScale?: number } | null | undefined): number {
  return world?.oreGradeScale ?? ORE_GRADE_SCALE_DEFAULT;
}

/** Grade threshold after applying the scale. */
export function scaledGradeThreshold(base: number, scale: number): number {
  return base * scale;
}
