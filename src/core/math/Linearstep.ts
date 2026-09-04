// BlastSimulator2026 — Linearstep interpolation
// Linear analogue of smoothstep: 0 below a, 1 above b, straight-line ease
// between. Default time-interpolation primitive for renderer movement,
// task-fill tweening, and UI progress transitions (#948).

export function linearstep(a: number, b: number, t: number): number {
  if (a === b) return t < a ? 0 : 1;
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
