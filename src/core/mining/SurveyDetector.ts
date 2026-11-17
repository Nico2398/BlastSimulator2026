// BlastSimulator2026 — Meteorite detector (#2291): a bearing toward the crater and a distance band, never its centre.

import type { Random } from '../math/Random.js';

/** One reading: where the crater lies, as a cone (bearing ± halfAngle) clipped to a distance band. */
export interface DetectorReading {
  /** Radians, `atan2(dz, dx)` from the reading's origin. */
  bearing: number;
  /** Radians: the angular error bound; the true bearing lies within it. */
  halfAngle: number;
  minDistance: number;
  maxDistance: number;
}

/** Angular error bound (radians) at a skill level: widest at skill 1, narrowest at the top skill. */
export function detectorHalfAngle(_skillLevel: number): number {
  throw new Error('not implemented');
}

/** Take a reading toward the crater from `origin`; null when the world has no crater. Seeded. */
export function readMeteoriteDetector(
  _crater: { x: number; z: number } | null,
  _origin: { x: number; z: number },
  _skillLevel: number,
  _rng: Random,
): DetectorReading | null {
  throw new Error('not implemented');
}
