// BlastSimulator2026 — Blast Workshop defaults that follow the permit (#2101)

/** Grid depth (m) the Drill step opens at; `undefined` grade = site without a permit. */
export function defaultGridDepthM(_grade: number | undefined): number {
  throw new Error('not implemented');
}

/**
 * Charge amount (kg) the Charge step opens at: largest whole kg that fits the shallowest
 * hole at `stemmingM` and keeps `holeCount` holes within the permit's per-blast charge.
 * No permit, no holes, or nothing fits => CHARGE_DEFAULT_AMOUNT_KG.
 */
export function defaultChargeKg(
  _grade: number | undefined, _holeCount: number, _shallowestDepthM: number,
  _stemmingM: number, _diameterM?: number,
): number {
  throw new Error('not implemented');
}
