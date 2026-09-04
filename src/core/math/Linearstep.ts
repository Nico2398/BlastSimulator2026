// BlastSimulator2026 — Linearstep interpolation
// Linear analogue of smoothstep: 0 below a, 1 above b, straight-line ease
// between. Default time-interpolation primitive for renderer movement,
// task-fill tweening, and UI progress transitions (#948).

import { clampedRatio } from './ClampedRatio.js';

export function linearstep(a: number, b: number, t: number): number {
  return clampedRatio(a, b, t);
}
