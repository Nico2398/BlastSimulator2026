// BlastSimulator2026 — Shift cycle (Bunkhouse Tier 2+ / site-policy-driven)
//
// Processes the shift/rest cycle for employees: legacy fatigue-only fixed-
// duration path when no site policy has been applied, or the policy-aware
// path (ForceShiftRest.ts's forceShiftRestIfNeededByPolicy) once one has.
// Split out of GameLoop.ts as part of #759's file-size split; re-exported
// there so GameLoop.ts stays the single public surface for tick-orchestration
// callers.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';

export interface ShiftCycleResult {
  /** Employee IDs whose rest period completed this tick. */
  restCompleted: number[];
  /** Employee IDs that transitioned from shift-working to shift-resting this tick. */
  shiftRested: number[];
  /** Whether any employee shift logic was processed this tick. */
  active: boolean;
}

/**
 * Process the shift/rest cycle for employees. With no site policy ever
 * applied, this is gated on bunkhouse tier >= 2 and uses the legacy
 * fatigue-only, fixed-duration ForceShiftRest.ts's forceShiftRestIfNeeded/
 * completeRestTick path. Once a policy has been applied, it runs for every
 * alive/non-injured employee regardless of bunkhouse tier and routes
 * force-rest through the policy-aware forceShiftRestIfNeededByPolicy.
 *
 * Each employee is processed in a single pass through three sequential phases:
 *   1. Complete rests — decrement restTicksRemaining, replenish fatigue on completion
 *   2. Increment ticksWorked — for active employees not currently resting
 *   3. Force shift rest — when ticksWorked reaches the work-duration threshold
 *      (legacy path), or when SitePolicy.shouldForceRest trips (policy path)
 *
 * @param state - The game state (mutated in place)
 * @param firedEvents - Accumulator for events fired this tick
 * @returns Result summary of shift transitions
 */
export function processShiftCycle(
  state: GameState,
  firedEvents: FiredEvent[],
  _emitter?: EventEmitter,
): ShiftCycleResult {
  void state; void firedEvents; void _emitter;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Decrement restTicksRemaining for an employee who is currently resting
 * under the legacy (no-policy) path.
 * If rest is complete (reaches ≤ 0), replenish fatigue, clear state, and record completion.
 */
export function completeRestTick(
  state: GameState,
  emp: Employee,
  restCompleted: number[],
): void {
  void state; void emp; void restCompleted;
  // TODO: implement
}

/**
 * Increment ticksWorked for an active (non-idle) employee who is not currently resting
 * and does not already have a pending rest action queued.
 */
export function incrementWorkTick(
  state: GameState,
  emp: Employee,
): void {
  void state; void emp;
  // TODO: implement
}
