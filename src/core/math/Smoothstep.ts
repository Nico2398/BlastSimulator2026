// BlastSimulator2026 — Smoothstep interpolation
// Standard smoothstep: 0 below a, 1 above b, cubic ease between. Used for
// the pit-suitability mask and boundary blends (#458 T1.1).

export function smoothstep(a: number, b: number, t: number): number {
  if (a === b) return t < a ? 0 : 1;
  const s = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return s * s * (3 - 2 * s);
}
