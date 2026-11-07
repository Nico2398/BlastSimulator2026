// BlastSimulator2026 — Minor-event notices: answering one, and resolving the ignored ones (#2146)

import type { GameState } from '../state/GameState.js';
import type { Random } from '../math/Random.js';
import { applyCorruptionDelta } from '../economy/Corruption.js';
import { getEventById } from './EventPool.js';
import { resolveEvent, type ResolutionResult } from './EventResolver.js';
import { noticeTicksLeft } from './EventSystem.js';
import { defaultNoticeOption } from './EventWeight.js';
import type { EventWorld } from './TrafficJamEffects.js';

/** Mirror a resolution onto the flat state: cash and corruption, as `event choose` does for a major. */
export function applyResolutionToState(state: GameState, result: ResolutionResult): void {
  state.cash += result.cashChange;
  if (result.corruptionChange !== 0) applyCorruptionDelta(state.corruption, result.corruptionChange);
}

/**
 * Resolve the notice for `eventId` with option `optionIndex`, applying its effects. Records `lastNoticeOutcome`
 * and leaves `pendingEvent` and `lastOutcome` as they were. Null when there is no such notice or option.
 */
export function resolveNotice(
  state: GameState, eventId: string, optionIndex: number, rng: Random, world: EventWorld, auto = false,
): ResolutionResult | null {
  const events = state.events;
  const at = events.minorNotices.findIndex(n => n.eventId === eventId);
  if (at < 0) return null;
  const notice = events.minorNotices[at]!;
  if (!getEventById(eventId)) {
    events.minorNotices.splice(at, 1);
    return null;
  }

  // resolveEvent reads the pending event: seat the notice there, then put back what was.
  const heldPending = events.pendingEvent;
  const heldOutcome = events.lastOutcome;
  events.pendingEvent = notice;
  const result = resolveEvent(events, state.finances, state.scores, optionIndex, state.tickCount, rng, world);
  events.pendingEvent = heldPending;
  events.lastOutcome = heldOutcome;
  if (!result) return null;

  events.minorNotices.splice(events.minorNotices.findIndex(n => n === notice), 1);
  applyResolutionToState(state, result);
  events.lastNoticeOutcome = {
    eventId, resultKey: result.resultKey, auto, seq: (events.lastNoticeOutcome?.seq ?? 0) + 1,
  };
  return result;
}

/** Resolve every notice whose countdown has ended to its default option. */
export function expireNotices(state: GameState, rng: Random, world: EventWorld): void {
  for (const notice of [...state.events.minorNotices]) {
    if (noticeTicksLeft(notice, state.tickCount) > 0) continue;
    const def = getEventById(notice.eventId);
    if (!def) {
      state.events.minorNotices = state.events.minorNotices.filter(n => n !== notice);
      continue;
    }
    resolveNotice(state, notice.eventId, defaultNoticeOption(def), rng, world, true);
  }
}
