// BlastSimulator2026 — Boulder Fragmentation sub-module
// Secondary fragmentation logic for oversized boulders (BLAST_SYSTEM.md §2.11).
// Extracted from BlastCalc.ts to keep that file within the 300-line convention limit.

import type { Random } from '../math/Random.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../config/balance.js';

// ────────────────────────────────────────────────────────
// § 2.11: Boulder Fragmentation
// ────────────────────────────────────────────────────────

export interface Boulder {
  id: number;
  volume: number;       // m³
  mass: number;         // kg
  rockId: string;
  oreDensities: Record<string, number>;
}

export interface FragmentBoulderResult {
  success: boolean;
  fragments: Boulder[];
  error?: string;
}

// Monotonically increasing counter for sub-fragment IDs. Avoids arithmetic
// collisions that arise from boulder.id * 1000 + i when boulders have large IDs.
let nextBoulderFragId = 1;

/** Reset sub-fragment ID counter (for tests). */
export function resetBoulderFragIds(): void {
  nextBoulderFragId = 1;
}

/** Returns true if the boulder volume exceeds the haul threshold (strictly greater than). */
export function isOversized(volume: number): boolean {
  return volume > OVERSIZED_FRAGMENT_THRESHOLD;
}

/**
 * Split an oversized boulder into N equal sub-fragments where every piece
 * has volume < OVERSIZED_FRAGMENT_THRESHOLD.
 * N = floor(volume / threshold) + 1  guarantees each piece fits the threshold.
 * rng is reserved for future variation in fragment count (variable split adds
 * natural-looking rubble piles); the current split is deterministic.
 */
export function fragmentBoulder(boulder: Boulder, _rng: Random): FragmentBoulderResult {
  if (!isOversized(boulder.volume)) {
    return {
      success: false,
      fragments: [],
      error: `Boulder volume ${boulder.volume} m³ is not oversized (threshold: ${OVERSIZED_FRAGMENT_THRESHOLD} m³)`,
    };
  }

  const n = Math.floor(boulder.volume / OVERSIZED_FRAGMENT_THRESHOLD) + 1;
  const fragVolume = boulder.volume / n;
  const fragMass = boulder.mass / n;

  const fragments: Boulder[] = [];
  for (let i = 0; i < n; i++) {
    // Skip any ID that would collide with the parent.
    if (nextBoulderFragId === boulder.id) nextBoulderFragId++;
    fragments.push({
      id: nextBoulderFragId++,
      volume: fragVolume,
      mass: fragMass,
      rockId: boulder.rockId,
      oreDensities: { ...boulder.oreDensities },
    });
  }

  return { success: true, fragments };
}

export { OVERSIZED_FRAGMENT_THRESHOLD };
