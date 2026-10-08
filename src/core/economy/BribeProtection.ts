// BlastSimulator2026 — Bribe protections (#1407)
// Timed shields a successful bribe grants against event categories.

import type { EventCategory, EventDef } from '../events/EventPool.js';
import type { CorruptionTarget } from './Corruption.js';
import {
  BRIBE_CORRUPTION_DELTA,
  BRIBE_PRICE_PER_PROTECTION_DAY,
  BRIBE_PROTECTION_DAYS,
  INSPECTION_EVENT_TAG,
  JUDGE_LAWSUIT_TIMER_STRETCH,
  WITNESS_EXPOSURE_REDUCTION,
  TICKS_PER_DAY,
} from '../config/balance.js';

/** What a protection does while active. All fields optional; each target sets its own. */
export interface ProtectionEffect {
  /** Events of this category cannot fire. */
  blockCategory?: EventCategory;
  /** Events carrying this tag cannot fire. */
  blockTag?: string;
  /** Category whose timer is stretched. */
  timerStretchCategory?: EventCategory;
  /** Timer multiplier (>1 = slower). */
  timerStretch?: number;
  /** Next event of this category is auto-dismissed. */
  dismissNextCategory?: EventCategory;
  /** Exposure risk reduction (0-1). */
  exposureReduction?: number;
}

export interface BribeProfile {
  corruptionDelta: number;
  durationTicks: number;
  price: number;
  effect: ProtectionEffect;
}

/** One entry per bribe target. */
export const BRIBE_PROFILES: Record<CorruptionTarget, BribeProfile> = {
  judge: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.judge,
    durationTicks: BRIBE_PROTECTION_DAYS.judge * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.judge * BRIBE_PROTECTION_DAYS.judge,
    effect: { timerStretchCategory: 'lawsuit', timerStretch: JUDGE_LAWSUIT_TIMER_STRETCH },
  },
  politician: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.politician,
    durationTicks: BRIBE_PROTECTION_DAYS.politician * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.politician * BRIBE_PROTECTION_DAYS.politician,
    effect: { dismissNextCategory: 'politics' },
  },
  union_leader: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.union_leader,
    durationTicks: BRIBE_PROTECTION_DAYS.union_leader * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.union_leader * BRIBE_PROTECTION_DAYS.union_leader,
    effect: { blockCategory: 'union' },
  },
  inspector: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.inspector,
    durationTicks: BRIBE_PROTECTION_DAYS.inspector * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.inspector * BRIBE_PROTECTION_DAYS.inspector,
    effect: { blockTag: INSPECTION_EVENT_TAG },
  },
  witness: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.witness,
    durationTicks: BRIBE_PROTECTION_DAYS.witness * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.witness,
    effect: { exposureReduction: WITNESS_EXPOSURE_REDUCTION },
  },
};

export interface ActiveProtection {
  target: CorruptionTarget;
  expiresAtTick: number;
  /** Remaining auto-dismissals (for dismissNextCategory effects). */
  dismissalsLeft: number;
}

/** Append a protection for a successful bribe; null when the target grants none. */
export function grantProtection(
  _list: ActiveProtection[],
  _target: CorruptionTarget,
  _tick: number,
): ActiveProtection | null {
  return null; // TODO: implement
}

/** Drop expired protections in place. */
export function pruneProtections(_list: ActiveProtection[], _tick: number): void {
  // TODO: implement
}

/** True when an active protection blocks this event from firing. */
export function isEventShielded(
  _def: Pick<EventDef, 'category' | 'tags'>,
  _list: readonly ActiveProtection[],
  _tick: number,
): boolean {
  return false; // TODO: implement
}

/** Consume one auto-dismissal for the category; true when one was available. */
export function consumeDismissal(
  _list: ActiveProtection[],
  _category: EventCategory,
  _tick: number,
): boolean {
  return false; // TODO: implement
}

/** Combined timer multiplier for the category (1 = unchanged). */
export function timerStretchFor(
  _category: EventCategory,
  _list: readonly ActiveProtection[],
  _tick: number,
): number {
  return 1; // TODO: implement
}

/** Ticks left on a protection (0 when expired). */
export function protectionRemainingTicks(_p: ActiveProtection, _tick: number): number {
  return 0; // TODO: implement
}
