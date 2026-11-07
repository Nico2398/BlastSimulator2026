// BlastSimulator2026 — Minor-event notices: answering one, and resolving the ignored ones (#2146)

import type { GameState } from '../state/GameState.js';
import type { Random } from '../math/Random.js';
import type { ResolutionResult } from './EventResolver.js';
import type { EventWorld } from './TrafficJamEffects.js';

/** Mirror a resolution onto the flat state: cash and corruption, as `event choose` does for a major. */
export function applyResolutionToState(_state: GameState, _result: ResolutionResult): void {
  throw new Error('not implemented');
}

/**
 * Resolve the notice for `eventId` with option `optionIndex`, applying its effects. Records `lastNoticeOutcome`
 * and leaves `pendingEvent` and `lastOutcome` as they were. Null when there is no such notice or option.
 */
export function resolveNotice(
  _state: GameState, _eventId: string, _optionIndex: number, _rng: Random, _world: EventWorld, _auto = false,
): ResolutionResult | null {
  throw new Error('not implemented');
}

/** Resolve every notice whose countdown has ended to its default option. */
export function expireNotices(_state: GameState, _rng: Random, _world: EventWorld): void {
  throw new Error('not implemented');
}
