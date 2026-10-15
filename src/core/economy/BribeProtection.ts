// BlastSimulator2026 — Bribe protections (#1407)
// Timed shields a successful bribe grants against event categories.

import type { EventCategory, EventDef } from '../events/EventPool.js';
import type { CorruptionTarget } from './Corruption.js';
import {
  BRIBE_CORRUPTION_DELTA,
  BRIBE_PRICE_PER_PROTECTION_DAY,
  BRIBE_PROTECTION_DAYS,
  BRIBE_PROTECTION_MAX_LINGER_DAYS,
  INSPECTION_EVENT_TAG,
  JUDGE_LAWSUIT_TIMER_STRETCH,
  WITNESS_EXPOSURE_REDUCTION,
  TICKS_PER_DAY,
} from '../config/balance.js';

/** What a protection does while active. All fields optional; each target sets its own. */
interface ProtectionEffect {
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

interface BribeProfile {
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
    effect: { timerStretchCategory: 'lawsuit', timerStretch: JUDGE_LAWSUIT_TIMER_STRETCH, dismissNextCategory: 'lawsuit' },
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
  politician: {
    corruptionDelta: BRIBE_CORRUPTION_DELTA.politician,
    durationTicks: BRIBE_PROTECTION_DAYS.politician * TICKS_PER_DAY,
    price: BRIBE_PRICE_PER_PROTECTION_DAY.politician * BRIBE_PROTECTION_DAYS.politician,
    effect: { blockCategory: 'politics' },
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
  /** True once the protection has blocked or dismissed an event; false on grant and on re-bribe (#1816). */
  shielded: boolean;
}

/** True while the paid window (up to expiresAtTick) is running. */
function isWithinPaidWindow(p: ActiveProtection, tick: number): boolean {
  return tick < p.expiresAtTick;
}

/**
 * Paid window, then (until it has shielded something) a capped linger so the bribe outlives the event gap (#1816).
 * Timer stretch deliberately ignores the linger: `timerStretchFor` uses the paid window only.
 */
function isActive(p: ActiveProtection, tick: number): boolean {
  return isWithinPaidWindow(p, tick)
    || (!p.shielded && tick < p.expiresAtTick + BRIBE_PROTECTION_MAX_LINGER_DAYS * TICKS_PER_DAY);
}

/** True when the effect blocks an event of this category/tags. */
function blocksEvent(p: ActiveProtection, def: Pick<EventDef, 'category' | 'tags'>): boolean {
  const { blockCategory, blockTag } = BRIBE_PROFILES[p.target].effect;
  return blockCategory === def.category
    || (blockTag !== undefined && (def.tags?.includes(blockTag) ?? false));
}

/** Append a protection for a successful bribe; null when the target grants none. Re-bribing refreshes, never stacks. */
export function grantProtection(
  list: ActiveProtection[],
  target: CorruptionTarget,
  tick: number,
): ActiveProtection | null {
  const profile = BRIBE_PROFILES[target];
  if (profile.durationTicks <= 0) return null;
  const expiresAtTick = tick + profile.durationTicks;
  const dismissalsLeft = profile.effect.dismissNextCategory ? 1 : 0;
  const existing = list.find(p => p.target === target);
  if (existing) {
    existing.expiresAtTick = Math.max(existing.expiresAtTick, expiresAtTick);
    existing.dismissalsLeft = dismissalsLeft;
    existing.shielded = false;
    return existing;
  }
  const entry: ActiveProtection = { target, expiresAtTick, dismissalsLeft, shielded: false };
  list.push(entry);
  return entry;
}

/** Drop expired protections in place; unshielded lingering ones are kept. */
export function pruneProtections(list: ActiveProtection[], tick: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isActive(list[i]!, tick)) list.splice(i, 1);
  }
}

/** True when an active protection blocks this event from firing. */
export function isEventShielded(
  def: Pick<EventDef, 'category' | 'tags'>,
  list: readonly ActiveProtection[],
  tick: number,
): boolean {
  return list.some(p => isActive(p, tick) && blocksEvent(p, def));
}

/** Consume one auto-dismissal for the category; true when one was available. */
export function consumeDismissal(
  list: ActiveProtection[],
  category: EventCategory,
  tick: number,
): boolean {
  const p = list.find(q => isActive(q, tick) && q.dismissalsLeft > 0
    && BRIBE_PROFILES[q.target].effect.dismissNextCategory === category);
  if (!p) return false;
  p.dismissalsLeft--;
  p.shielded = true;
  return true;
}

/** Combined timer multiplier for the category (1 = unchanged). */
export function timerStretchFor(
  category: EventCategory,
  list: readonly ActiveProtection[],
  tick: number,
): number {
  let stretch = 1;
  for (const p of list) {
    const e = BRIBE_PROFILES[p.target].effect;
    if (isWithinPaidWindow(p, tick) && e.timerStretchCategory === category) stretch *= Math.max(1, e.timerStretch ?? 1);
  }
  return stretch;
}

/** Ticks left on a protection (0 when expired). */
export function protectionRemainingTicks(p: ActiveProtection, tick: number): number {
  return Math.max(0, p.expiresAtTick - tick);
}

/** Mark protections that would block any of these events as having shielded something (#1816). */
export function markShielded(
  list: ActiveProtection[],
  events: readonly Pick<EventDef, 'category' | 'tags'>[],
  tick: number,
): void {
  for (const p of list) {
    if (isActive(p, tick) && events.some(e => blocksEvent(p, e))) p.shielded = true;
  }
}

/** True when past the paid window (expiresAtTick) but still active on the unshielded linger. */
export function isProtectionLingering(p: ActiveProtection, tick: number): boolean {
  return !isWithinPaidWindow(p, tick) && isActive(p, tick);
}
