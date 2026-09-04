// BlastSimulator2026 — Smoothstep interpolation
// Standard smoothstep: 0 below a, 1 above b, cubic ease between. Used for
// the pit-suitability mask and boundary blends (#458 T1.1).

import { clampedRatio } from './ClampedRatio.js';

export function smoothstep(a: number, b: number, t: number): number {
  const s = clampedRatio(a, b, t);
  return s * s * (3 - 2 * s);
}
