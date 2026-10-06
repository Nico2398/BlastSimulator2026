/**
 * Hard ceilings on a blast's rating, applied after the base rating is chosen.
 * Pure: takes plain facts, never GameState.
 */
import type { BlastRating } from './BlastExecution.js';

export type BlastRatingCap = 'death' | 'casualty_or_destruction' | 'wet_holes' | 'oversize';

export interface RatingCapFacts {
  deaths: number;
  injuries: number;
  destroyedBuildings: number;
  wetHoleCount: number;
  oversizedFragments: number;
  fragmentCount: number;
}

/** Lowers `base` to the ceiling of the most severe cap that applies; `cap` names it, or null when none did. */
export function applyRatingCaps(
  base: BlastRating,
  _facts: RatingCapFacts,
): { rating: BlastRating; cap: BlastRatingCap | null } {
  // TODO: implement
  return { rating: base, cap: null };
}

/** Fraction (0..1) of fragments that are oversized; 0 when there are no fragments. */
export function oversizeShare(_oversized: number, _total: number): number {
  // TODO: implement
  return 0;
}
