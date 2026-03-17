// BlastSimulator2026 — Event system engine
// Manages category timers, weighted selection, and event firing.

import type { Random } from '../math/Random.js';
import type { ScoreState } from '../scores/ScoreManager.js';
import type { EventDef, EventCategory, EventContext } from './EventPool.js';
import { getEventsByCategory } from './EventPool.js';
import { EVENT_BASE_TIMERS } from '../config/balance.js';

// ── Config (imported from centralized balance) ──

/** Base timer reset values per category (in ticks). */
const BASE_TIMER: Record<EventCategory, number> = { ...EVENT_BASE_TIMERS };

// ── Timer state ──

export interface CategoryTimer {
  category: EventCategory;
  remaining: number;
  baseInterval: number;
}

export interface EventSystemState {
  timers: CategoryTimer[];
  /** Currently pending event requiring player decision. */
  pendingEvent: FiredEvent | null;
  /** Queue of follow-up events to fire. */
  followUpQueue: string[];
}

export interface FiredEvent {
  eventId: string;
  firedAtTick: number;
}

export function createEventSystemState(): EventSystemState {
  const categories: EventCategory[] = ['union', 'politics', 'weather', 'mafia', 'lawsuit'];
  return {
    timers: categories.map(cat => ({
      category: cat,
      remaining: BASE_TIMER[cat],
      baseInterval: BASE_TIMER[cat],
    })),
    pendingEvent: null,
    followUpQueue: [],
  };
}

// ── Tick processing ──

/**
 * Advance all timers by one tick. When a timer fires, select and return an event.
 * Timer intervals are modulated by scores:
 *   - Low well-being → faster union timer
 *   - Low ecology → faster lawsuit timer
 *   - etc.
 */
export function tickEventSystem(
  state: EventSystemState,
  ctx: EventContext,
  rng: Random,
): FiredEvent | null {
  // Don't fire new events while one is pending
  if (state.pendingEvent) return null;

  // Check follow-up queue first
  if (state.followUpQueue.length > 0) {
    const eventId = state.followUpQueue.shift()!;
    state.pendingEvent = { eventId, firedAtTick: ctx.tickCount };
    return state.pendingEvent;
  }

  for (const timer of state.timers) {
    timer.remaining--;

    if (timer.remaining <= 0) {
      // Reset timer with score-modulated interval
      timer.remaining = getModulatedInterval(timer.category, ctx.scores, timer.baseInterval);

      // Try to fire an event from this category
      const event = selectEvent(timer.category, ctx, rng);
      if (event) {
        state.pendingEvent = { eventId: event.id, firedAtTick: ctx.tickCount };
        return state.pendingEvent;
      }
    }
  }

  return null;
}

/** Clear the pending event (after player resolves it). */
export function clearPendingEvent(state: EventSystemState): void {
  state.pendingEvent = null;
}

/** Queue a follow-up event. */
export function queueFollowUp(state: EventSystemState, eventId: string): void {
  state.followUpQueue.push(eventId);
}

// ── Selection ──

/**
 * Select an event from a category using weighted random selection.
 * Weight = event.weightCoeff(scores). Higher weight = more likely.
 */
export function selectEvent(
  category: EventCategory,
  ctx: EventContext,
  rng: Random,
): EventDef | null {
  const events = getEventsByCategory(category);
  const available = events.filter(e => e.canFire(ctx));

  if (available.length === 0) return null;

  // Calculate weights
  const weights = available.map(e => Math.max(0.01, e.weightCoeff(ctx.scores)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Weighted random selection
  let roll = rng.nextFloat(0, totalWeight);
  for (let i = 0; i < available.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return available[i]!;
  }

  return available[available.length - 1]!;
}

// ── Timer modulation ──

/**
 * Modulate timer interval based on scores.
 * Low relevant score → shorter interval (more frequent events).
 * Returns ticks for next timer reset.
 */
function getModulatedInterval(
  category: EventCategory,
  scores: ScoreState,
  baseInterval: number,
): number {
  let multiplier = 1.0;

  switch (category) {
    case 'union':
      // Low well-being → faster union events (0.5x to 1.5x)
      multiplier = 0.5 + (scores.wellBeing / 100);
      break;
    case 'politics':
      // Fairly steady, slight modulation by ecology
      multiplier = 0.8 + 0.4 * (scores.ecology / 100);
      break;
    case 'weather':
      // Weather is mostly independent of scores
      multiplier = 0.9 + 0.2 * (scores.nuisance / 100);
      break;
    case 'mafia':
      // More frequent when corruption is high (handled by canFire)
      multiplier = 1.0;
      break;
    case 'lawsuit':
      // Low safety → faster lawsuits
      multiplier = 0.5 + (scores.safety / 100);
      break;
  }

  return Math.max(5, Math.round(baseInterval * multiplier));
}

export { BASE_TIMER };
