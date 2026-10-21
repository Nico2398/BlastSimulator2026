// BlastSimulator2026 — Slope degree/ratio converters (#1938)

/** Float slack so a grade exactly at the limit counts as climbable (matches isStepClimbable's epsilon spirit). */
export const GRADE_EPSILON_DEGREES = 1e-6;

/** tan of a slope in degrees. */
export function slopeRatioForDegrees(deg: number): number {
  return Math.tan(deg * Math.PI / 180);
}

/** Angle in degrees of a rise/run slope; inverse of `slopeRatioForDegrees`. */
export function slopeDegreesForRatio(ratio: number): number {
  return Math.atan(ratio) * 180 / Math.PI;
}
