// BlastSimulator2026 — How the EST. ORE VALUE reads given survey coverage (#1960)

export type OreEstimateView =
  | { kind: 'unknown' }
  | { kind: 'partial'; sharePct: number }
  | { kind: 'full' };

/** Classify survey coverage (0..1 of the broken volume) into the state the estimate shows. */
export function oreEstimateView(coverage: number): OreEstimateView {
  void coverage;
  // TODO: implement
  return { kind: 'full' };
}
