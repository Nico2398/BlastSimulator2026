/**
 * Hard ceilings on a blast's rating, applied after the base rating is chosen.
 * Pure: takes plain facts, never GameState.
 */
import type { BlastRating } from './BlastExecution.js';
import { BLAST_FIZZLE_SHARE_FAILURE, BLAST_FIZZLE_SHARE_PARTIAL, BLAST_OVERSIZE_SHARE_CAP } from '../config/balance.js';

export type BlastRatingCap = 'death' | 'casualty_or_destruction' | 'wet_holes' | 'oversize' | 'fizzled_failure' | 'fizzled_partial' | 'no_breakout';

export interface RatingCapFacts {
  deaths: number;
  injuries: number;
  destroyedBuildings: number;
  wetHoleCount: number;
  fizzledHoleCount: number;
  chargedHoleCount: number;
  oversizedFragments: number;
  fragmentCount: number;
  /** True when the blast never broke out of its sealed void (#1724). */
  noBreakout: boolean;
}

/** True for ratings that count as a hazard: 'bad' or 'catastrophic'. */
export function isHazardRating(rating: BlastRating): boolean {
  return rating === 'bad' || rating === 'catastrophic';
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
  { id: 'fizzled_failure', applies: f => fizzleShare(f.fizzledHoleCount, f.chargedHoleCount) >= BLAST_FIZZLE_SHARE_FAILURE, ceiling: 'bad' },
  { id: 'fizzled_partial', applies: f => fizzleShare(f.fizzledHoleCount, f.chargedHoleCount) >= BLAST_FIZZLE_SHARE_PARTIAL, ceiling: 'mediocre' },
  // Rock sealed under an intact cap: nothing opened, so the shot cannot rate above Bad (#1724).
  { id: 'no_breakout', applies: f => f.noBreakout, ceiling: 'bad' },
  { id: 'wet_holes', applies: f => f.wetHoleCount > 0 && f.fizzledHoleCount > 0, ceiling: 'good' },
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

/** Fraction (0..1) of `total` that is `part`; 0 when `total` is not positive. */
function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/** Fraction (0..1) of fragments that are oversized; 0 when there are no fragments. */
export function oversizeShare(oversized: number, total: number): number {
  return share(oversized, total);
}

/** Fraction (0..1) of charged holes that fizzled; 0 when no holes were charged. */
export function fizzleShare(fizzled: number, charged: number): number {
  return share(fizzled, charged);
}
