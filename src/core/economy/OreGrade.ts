// Ore grade scale lever (#1932): scales grade thresholds by a world-level factor.

/** Grade scale of a world; default when absent. */
export function oreGradeScaleOf(_world: { oreGradeScale?: number } | null | undefined): number {
  // TODO: implement
  return 1;
}

/** Grade threshold after applying the scale. */
export function scaledGradeThreshold(base: number, _scale: number): number {
  // TODO: implement
  return base;
}
