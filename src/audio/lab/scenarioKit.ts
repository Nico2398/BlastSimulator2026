// BlastSimulator2026 — Scenario building blocks
// Small deterministic helpers the scenario builders share: random places around the
// listener and runs of jittered moments.

import type { WorldPoint } from '../AudioPlayer.js';
import type { Random } from '../../core/math/Random.js';

/** A point `minM`..`maxM` metres from the origin (the listener) in a random direction. */
export function ringPoint(random: Random, minM: number, maxM: number): WorldPoint {
  const angle = random.nextFloat(0, Math.PI * 2);
  const distance = random.nextFloat(minM, maxM);
  return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
}

/** Moments from `fromS` up to (not including) `toS`, each a random gap in `minGapS`..`maxGapS` after the last. */
export function jitteredMoments(random: Random, fromS: number, toS: number, minGapS: number, maxGapS: number): number[] {
  const moments: number[] = [];
  for (let t = fromS + random.nextFloat(0, minGapS); t < toS; t += random.nextFloat(minGapS, maxGapS)) moments.push(t);
  return moments;
}
