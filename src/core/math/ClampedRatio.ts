// BlastSimulator2026 — shared boundary/clamp logic for Linearstep and Smoothstep
// Both steps agree on where t sits between a and b before diverging on the
// ease curve applied to that position; this is the shared part.

export function clampedRatio(a: number, b: number, t: number): number {
  if (a === b) return t < a ? 0 : 1;
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
