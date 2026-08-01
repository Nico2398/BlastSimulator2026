// BlastSimulator2026 — Piecewise-linear splines for height composition
// Splines are data (control points), not code, so a biome's height character
// is defined by its control points rather than a bespoke formula (#458 A4).

/** Ordered (input, output) control points. Must be sorted by input ascending. */
export type Spline = ReadonlyArray<readonly [input: number, output: number]>;

/** Evaluate a spline at t, clamping to the first/last control point outside its range. */
export function evalSpline(s: Spline, t: number): number {
  const first = s[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];

  for (let i = 1; i < s.length; i++) {
    const point = s[i]!;
    if (t <= point[0]) {
      const prev = s[i - 1]!;
      const [t0, v0] = prev;
      const [t1, v1] = point;
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
    }
  }
  return s[s.length - 1]![1];
}

/** Neutral default height-shaping splines, superseded per-biome once BiomeCatalog lands (#458 T1.2). */
export const DEFAULT_BASE_SPLINE: Spline = [[-1, -10], [-0.4, 1], [0, 8], [0.4, 22], [0.7, 45], [1, 90]];
export const DEFAULT_RELIEF_SPLINE: Spline = [[-1, 1.4], [-0.3, 1.0], [0.2, 0.55], [0.7, 0.25], [1, 0.12]];
export const DEFAULT_PV_AMPLITUDE = 55;
