// BlastSimulator2026 — Synth seeding
// Every recipe draws its randomness from generators seeded by (recipe id, variant,
// stream), so a rendering is a pure function of those three values.

import { Random } from '../../core/math/Random.js';

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Independent generator for one named stream of one recipe variant. */
export function rngFor(recipeId: string, variant: number, stream = 0): Random {
  return new Random(hashString(`${recipeId}#${variant}#${stream}`));
}

/** Fold any integer into [0, count) so every variant index is valid and seeds depend on the folded value. */
export function variantIndex(count: number, variant: number): number {
  return ((variant % count) + count) % count;
}

/** The entry a variant index selects. */
export function variantAt<T>(entries: readonly T[], variant: number): T {
  return entries[variantIndex(entries.length, variant)] as T;
}
