/**
 * Hard ceilings on a blast's rating, applied after the base rating is chosen.
 * Pure: takes plain facts, never GameState.
 */
import type { BlastRating } from './BlastExecution.js';
import { BLAST_OVERSIZE_SHARE_CAP } from '../config/balance.js';

export type BlastRatingCap = 'death' | 'casualty_or_destruction' | 'wet_holes' | 'oversize';

export interface RatingCapFacts {
  deaths: number;
  injuries: number;
  destroyedBuildings: number;
  wetHoleCount: number;
  oversizedFragments: number;
  fragmentCount: number;
}

const ORDER: readonly BlastRating[] = ['perfect', 'good', 'mediocre', 'bad', 'catastrophic'];

interface CapRule {
  id: BlastRatingCap;
  applies: (f: RatingCapFacts) => boolean;
  ceiling: BlastRating;
}

/** Most severe first; the first rule that actually lowers the rating is the reported cap. */
const CAP_RULES: readonly CapRule[] = [
  { id: 'death', applies: f => f.deaths > 0, ceiling: 'catastrophic' },
  { id: 'casualty_or_destruction', applies: f => f.injuries > 0 || f.destroyedBuildings > 0, ceiling: 'bad' },
  { id: 'wet_holes', applies: f => f.wetHoleCount > 0, ceiling: 'good' },
  { id: 'oversize', applies: f => oversizeShare(f.oversizedFragments, f.fragmentCount) > BLAST_OVERSIZE_SHARE_CAP, ceiling: 'good' },
];

/** Lowers `base` to the ceiling of the most severe cap that applies; `cap` names it, or null when none did. */
export function applyRatingCaps(
  base: BlastRating,
  facts: RatingCapFacts,
): { rating: BlastRating; cap: BlastRatingCap | null } {
  let rating = base;
  let cap: BlastRatingCap | null = null;
  for (const rule of CAP_RULES) {
    if (!rule.applies(facts)) continue;
    if (ORDER.indexOf(rule.ceiling) > ORDER.indexOf(rating)) {
      rating = rule.ceiling;
      cap ??= rule.id;
    }
  }
  return { rating, cap };
}

/** Fraction (0..1) of fragments that are oversized; 0 when there are no fragments. */
export function oversizeShare(oversized: number, total: number): number {
  return total > 0 ? oversized / total : 0;
}
