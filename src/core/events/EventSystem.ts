// BlastSimulator2026 — Event system engine
// Manages category timers, weighted selection, and event firing.

import type { TrafficJam } from './TrafficJams.js';
import type { Random } from '../math/Random.js';
import type { ScoreState } from '../scores/ScoreManager.js';
import type { EventDef, EventCategory, EventContext } from './EventPool.js';
import { getEventsByCategory, getEventById, hasEnvironmentalCause } from './EventPool.js';
import { isEventShielded, consumeDismissal, pruneProtections, timerStretchFor } from '../economy/BribeProtection.js';
import { EVENT_BASE_TIMERS, MIN_EVENT_INTERVAL_TICKS, MIN_EVENT_INTERVAL_RANDOM_RANGE, MIN_EVENT_INTERVAL_ACTIONS, FOLLOWUP_DELAY_TICKS, MAFIA_UNLOCK_THRESHOLD, MIN_EVENT_TIMER_TICKS } from '../config/balance.js';

// ── Config (imported from centralized balance) ──

/**
 * Categories that use the countdown-timer system.
 * 'traffic' and 'mining' are excluded because they are detected by EventEngine, not timers.
 */
export type TimerCategory = Exclude<EventCategory, 'traffic' | 'mining' | 'tutorial'>;

/** Base timer reset values per timer category (in ticks). */
const BASE_TIMER: Record<TimerCategory, number> = { ...EVENT_BASE_TIMERS };

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
  /** Jam chokepoint key -> tick until which that chokepoint stays silent (#1208). */
  jamSilencedUntil: Record<string, number>;
  /**
   * The result of the most recently resolved event, kept around so the UI's
   * outcome phase has something to read after pendingEvent is cleared. Set by
   * resolveEvent, cleared by clearLastOutcome (the DISMISS action) — not by
   * clearPendingEvent, since the outcome must survive past that point.
   */
  lastOutcome: EventOutcome | null;
  /** Queue of follow-up events to fire. */
  followUpQueue: string[];
  /** Ticks remaining before the head of followUpQueue may fire. */
  followUpDelayTicks: number;
  /** IDs of events that have already fired this level — each fires at most once. */
  firedEventIds: string[];
  /** Tick count of the most recent event fire. Used to gate events by player activity. */
  lastEventTick: number;
  /** Number of player actions since the last event. Used for cooldown gating. */
  actionCountSinceEvent: number;
  /** Multiplier on event frequency (1 = normal, 0 = no events). When 0, all event firing is suppressed. */
  eventFreqMultiplier: number;
  /**
   * Minimum-ticks-since-last-event threshold for the current cooldown window,
   * drawn once (`MIN_EVENT_INTERVAL_TICKS + rng.nextInt(0, MIN_EVENT_INTERVAL_RANDOM_RANGE)`)
   * and reused across every recheck of that window, including the short-retry
   * recheck every 5 ticks while cooldown holds. Without this, a timer that
   * expired while cooldown was still blocking redrew on every retry, so the
   * RNG stream advanced a number of times that depended on tick pacing —
   * inserting ticks/actions upstream reshuffled which event fired downstream
   * even though nothing about *this* window's threshold had changed (#597).
   * Null between events, before the next window's threshold has been drawn;
   * reset to null whenever an event actually fires so the next window draws
   * its own threshold fresh.
   */
  cooldownMinIntervalTicks: number | null;
  /** Action ids an unqualified_task event has already been raised for (#1380). */
  raisedUnqualifiedActionIds?: number[];
}

export interface FiredEvent {
  eventId: string;
  firedAtTick: number;
  /** The jam that fired a traffic_jam event (#1208). */
  jam?: TrafficJam;
  /** The pending actions an unqualified_task event concerns (#1380). */
  unqualifiedActionIds?: number[];
}

/** What kind of value an EventEffect carries — decides which chip color/format the UI uses. */
export type EventEffectKind = 'cash' | 'score' | 'other';

/** One structured line of an event's outcome — a UI-agnostic replacement for a pre-formatted English sentence. */
export interface EventEffect {
  kind: EventEffectKind;
  /** 'cash' for the cash effect; a ScoreState key for a score effect; a free-form tag (e.g. 'corruption', 'followUp') for 'other'. */
  key: string;
  /** Numeric change, 0 for effects with no magnitude (e.g. a follow-up notice). */
  delta: number;
  /** i18n key for effects delta alone can't describe (e.g. "A follow-up situation is developing..."). */
  textKey?: string;
}

/** The structured result of the most recently resolved event, read directly by the UI instead of parsing console text. */
export interface EventOutcome {
  eventId: string;
  resultKey: string;
  effects: EventEffect[];
}

export function createEventSystemState(eventFreqMultiplier: number = 1): EventSystemState {
  const categories: TimerCategory[] = ['union', 'politics', 'weather', 'mafia', 'lawsuit'];
  return {
    timers: categories.map(cat => ({
      category: cat,
      remaining: BASE_TIMER[cat],
      baseInterval: BASE_TIMER[cat],
    })),
    pendingEvent: null,
    jamSilencedUntil: {},
    raisedUnqualifiedActionIds: [],
    lastOutcome: null,
    followUpQueue: [],
    followUpDelayTicks: 0,
    firedEventIds: [],
    lastEventTick: 0,
    actionCountSinceEvent: 0,
    eventFreqMultiplier,
    cooldownMinIntervalTicks: null,
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
  // When eventFreqMultiplier is 0, all timer-based events are suppressed
  if (state.eventFreqMultiplier === 0) return null;

  // Don't fire new events while one is pending
  if (state.pendingEvent) return null;

  if (ctx.protections) pruneProtections(ctx.protections, ctx.tickCount);

  // Follow-up queue: drop stale entries (already fired, unknown, or not follow-up-only),
  // then count down once per tick. While counting, timers run as with an empty queue.
  state.followUpQueue = state.followUpQueue.filter(id =>
    getEventById(id)?.followUpOnly === true
    && (getEventById(id)?.repeatable === true || !state.firedEventIds.includes(id)));
  if (state.followUpQueue.length > 0) {
    state.followUpDelayTicks--;
    if (state.followUpDelayTicks <= 0) {
      const eventId = state.followUpQueue.shift()!;
      state.followUpDelayTicks = FOLLOWUP_DELAY_TICKS;
      if (!state.firedEventIds.includes(eventId)) state.firedEventIds.push(eventId);
      state.pendingEvent = { eventId, firedAtTick: ctx.tickCount };
      state.lastEventTick = ctx.tickCount;
      state.actionCountSinceEvent = 0;
      state.cooldownMinIntervalTicks = null;
      return state.pendingEvent;
    }
  }

  for (const timer of state.timers) {
    timer.remaining--;

    if (timer.remaining <= 0) {
      // Reset timer with score-modulated interval
      timer.remaining = Math.max(MIN_EVENT_TIMER_TICKS, Math.round(
        getModulatedInterval(timer.category, ctx.scores, timer.baseInterval)
        * timerStretchFor(timer.category, ctx.protections ?? [], ctx.tickCount)));

      // Cooldown check — prevent events from firing too rapidly. The random
      // component is drawn once per cooldown window and cached (#597) rather
      // than redrawn on every retry below — see cooldownMinIntervalTicks's
      // doc comment for why that matters.
      if (state.cooldownMinIntervalTicks === null) {
        state.cooldownMinIntervalTicks = MIN_EVENT_INTERVAL_TICKS + rng.nextInt(0, MIN_EVENT_INTERVAL_RANDOM_RANGE);
      }
      const minInterval = state.cooldownMinIntervalTicks;
      const ticksSinceLastEvent = ctx.tickCount - state.lastEventTick;
      if (ticksSinceLastEvent < minInterval || state.actionCountSinceEvent < MIN_EVENT_INTERVAL_ACTIONS) {
        // Short retry delay (5 ticks) before re-checking cooldown — avoids tight loop
        timer.remaining = 5;
        continue;
      }

      // Try to fire an event from this category (already-fired events excluded)
      const event = selectEvent(timer.category, ctx, rng, state.firedEventIds);
      if (event) {
        state.firedEventIds.push(event.id);
        // A judge's bribe dismisses the lawsuit unseen: it counts as fired, nothing is pending.
        if (event.category === 'lawsuit' && ctx.protections
          && consumeDismissal(ctx.protections, 'lawsuit', ctx.tickCount)) {
          return null;
        }
        state.pendingEvent = { eventId: event.id, firedAtTick: ctx.tickCount };
        state.lastEventTick = ctx.tickCount;
        state.actionCountSinceEvent = 0;
        state.cooldownMinIntervalTicks = null;
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

/** Clear the last resolved event's outcome (the DISMISS action, once the player has read it). */
export function clearLastOutcome(state: EventSystemState): void {
  state.lastOutcome = null;
}

/** Queue a follow-up event. */
export function queueFollowUp(state: EventSystemState, eventId: string): void {
  if (state.followUpQueue.length === 0) state.followUpDelayTicks = FOLLOWUP_DELAY_TICKS;
  state.followUpQueue.push(eventId);
}

/** Increment the action count since the last event. Used for cooldown gating. */
export function incrementActionCount(state: EventSystemState): void {
  state.actionCountSinceEvent++;
}

// ── Selection ──

/** Per-category prerequisite gating event selection (#1412). */
export const CATEGORY_PREREQUISITE: Partial<Record<EventCategory, (ctx: EventContext) => boolean>> = {
  union: (ctx) => ctx.employeeCount >= 1,
  // The mafia only approaches a player who has been seen paying (#1407).
  mafia: (ctx) => ctx.corruptionLevel >= MAFIA_UNLOCK_THRESHOLD,
  // A lawsuit needs some cause: pollution/blast, a death, or staff to sue.
  lawsuit: (ctx) => hasEnvironmentalCause(ctx) || ctx.deathCount >= 1 || ctx.employeeCount >= 1,
};

/**
 * Select an event from a category using weighted random selection.
 * Weight = event.weightCoeff(scores). Higher weight = more likely.
 */
export function selectEvent(
  category: EventCategory,
  ctx: EventContext,
  rng: Random,
  firedEventIds: string[] = [],
): EventDef | null {
  if (CATEGORY_PREREQUISITE[category]?.(ctx) === false) return null;
  const events = getEventsByCategory(category);
  const available = events.filter(e => !e.followUpOnly && !firedEventIds.includes(e.id) && e.canFire(ctx)
    && !isEventShielded(e, ctx.protections ?? [], ctx.tickCount));

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
      // Weather is mostly independent of scores (slightly likelier when neighbour relations are poor)
      multiplier = 0.9 + 0.2 * (1 - scores.nuisance / 100);
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

  // Floor of 5 ticks ensures a minimum gap even with extreme score modulation
  return Math.max(MIN_EVENT_TIMER_TICKS, Math.round(baseInterval * multiplier));
}


