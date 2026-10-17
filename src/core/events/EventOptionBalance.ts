import type { EventConsequence, EventDef } from './EventPool.js';

/** Signed expected-value dimensions of one option; higher is always better for the player. */
export type OptionDims = Readonly<Record<string, number>>;

/** Expected value of one option. */
export interface OptionValue {
  dims: OptionDims;
  /** Signature of effects that cannot be compared numerically; options only dominate on equal signatures. */
  opaque: string;
}

/** One option of an event that is strictly worse than another option of the same event. */
export interface DominatedPair {
  eventId: string;
  winner: number;
  loser: number;
}

/** Expected value of one option: signed dimensions (higher = better) plus an opaque signature. */
export function optionValue(_c: EventConsequence): OptionValue {
  throw new Error('not implemented');
}

/** True when a >= b on every dim, > on one, and a.opaque === b.opaque. */
export function dominates(_a: OptionValue, _b: OptionValue): boolean {
  throw new Error('not implemented');
}

/** Every (winner, loser) option index pair of the event where winner dominates loser. */
export function findDominatedPairs(_ev: EventDef): DominatedPair[] {
  throw new Error('not implemented');
}
