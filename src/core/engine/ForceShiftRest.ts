// BlastSimulator2026 — Forced shift rest (legacy and site-policy-aware)
//
// forceShiftRestIfNeeded is the legacy fatigue-only, fixed-duration path used
// while no site policy has been applied; forceShiftRestIfNeededByPolicy
// (#678) is the policy-aware variant that consults SitePolicy.shouldForceRest
// once one has. Both are called from ShiftCycle.ts's processShiftCycle. Split
// out of GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';

/**
 * If an active employee has worked enough ticks, force a shift rest:
 * find the nearest living_quarters, create a rest PendingAction, and set restTicksRemaining.
 */
export function forceShiftRestIfNeeded(
  state: GameState,
  emp: Employee,
  firedEvents: FiredEvent[],
  shiftRested: number[],
  _emitter?: EventEmitter,
): void {
  void state; void emp; void firedEvents; void shiftRested; void _emitter;
  // TODO: implement
}

/**
 * Site-policy-aware variant of forceShiftRestIfNeeded (#678) — consults
 * SitePolicy.shouldForceRest so an applied policy (state.sitePolicy.revision
 * > 0) forces rest for real, using any living_quarters tier (tier 1
 * included) or resting in place if none exists. Routes completion through
 * RestCompletion.ts's tickGeneralRestCompletion instead of ShiftCycle.ts's
 * own completeRestTick.
 */
export function forceShiftRestIfNeededByPolicy(
  state: GameState,
  emp: Employee,
  firedEvents: FiredEvent[],
  shiftRested: number[],
  _emitter?: EventEmitter,
): void {
  void state; void emp; void firedEvents; void shiftRested; void _emitter;
  // TODO: implement
}
