// BlastSimulator2026 — Shift cycle (always site-policy-driven)
//
// Processes the shift/rest cycle for employees through the policy-aware path
// (ForceShiftRest.ts's forceShiftRestIfNeededByPolicy), always in force.
// Split out of GameLoop.ts as part of #759's file-size split; re-exported
// there so GameLoop.ts stays the single public surface for tick-orchestration
// callers.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { completeIfOwnedRestAction } from './TaskDispatch.js';
import { completeRestForEmployee, findPendingActionById, resolveRestBuildingId } from './RestActionHelpers.js';
import { forceShiftRestIfNeededByPolicy } from './ForceShiftRest.js';

export interface ShiftCycleResult {
  /** Employee IDs whose rest period completed this tick. */
  restCompleted: number[];
  /** Employee IDs that transitioned from shift-working to shift-resting this tick. */
  shiftRested: number[];
  /** Whether any employee shift logic was processed this tick (always true). */
  active: boolean;
}

/**
 * Process the shift/rest cycle for employees. The site policy path is always
 * in force (#1379): it runs for every alive/non-injured employee regardless of
 * building tier or whether the player ever applied a policy, and routes
 * force-rest through forceShiftRestIfNeededByPolicy. A new game's default
 * policy (shift_8h, threshold 60) therefore protects the crew from tick 0.
 *
 * Each employee is processed in a single pass through three sequential phases:
 *   1. Complete rests — decrement restTicksRemaining, replenish fatigue on completion
 *   2. Increment ticksWorked — for active employees not currently resting
 *   3. Force shift rest — when SitePolicy.shouldForceRest trips
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
  const restCompleted: number[] = [];
  const shiftRested: number[] = [];

  // Single pass per employee — phases are independent per-employee so
  // merging from three loops to one produces identical behaviour.
  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured) continue;

    // Phase 1: Decrement rest, replenish fatigue on completion
    completeRestTick(state, emp, restCompleted);

    // Phase 2: Count work ticks for active employees not resting
    incrementWorkTick(state, emp);

    // Phase 3: Force shift rest when work quota is met
    forceShiftRestIfNeededByPolicy(state, emp, firedEvents, shiftRested, _emitter);
  }

  return { restCompleted, shiftRested, active: true };
}

/**
 * Decrement restTicksRemaining for an employee who is currently resting
 * that still carries no restNeedKey (a pre-#1379 save).
 * If rest is complete (reaches ≤ 0), replenish fatigue, clear state, and record completion.
 */
export function completeRestTick(
  state: GameState,
  emp: Employee,
  restCompleted: number[],
): void {
  if (emp.restTicksRemaining === null) return;
  // Rests started by tickCollapse/tickNeedRestoration/autoInsertNeedTasks
  // (Tier-1 living_quarters fatigue) or by forceShiftRestIfNeededByPolicy
  // all carry a restNeedKey and are owned by tickGeneralRestCompletion
  // instead — skip them here to avoid double-processing. Only a keyless rest
  // restored from a pre-#1379 save reaches the code below.
  if (emp.restNeedKey !== null) return;

  emp.restTicksRemaining -= 1;

  if (emp.restTicksRemaining <= 0) {
    const completedActionId = emp.activeActionId;
    const completedAction = findPendingActionById(state, completedActionId);
    completeRestForEmployee(state, emp, 'fatigue', completedAction !== undefined ? resolveRestBuildingId(completedAction.payload) : undefined);
    // forceShiftRestIfNeeded self-claims this action at creation, so — like
    // tickGeneralRestCompletion's own rest sources — nothing else removes it
    // from pendingActions/ghostPreviews once the rest completes (#547).
    //
    // #928: completeIfOwnedRestAction (TaskLifecycleCore.ts) verifies
    // completedActionId still names a 'rest' PendingAction before deleting
    // it, rather than assuming activeActionId always still names this
    // employee's own rest action — mirrors tickGeneralRestCompletion's own
    // use of the same shared helper (RestCompletion.ts) and the same
    // reasoning: a vehicle-gated action's arrival-promotion race
    // (ArrivalGate.ts) could otherwise leave activeActionId naming an
    // unrelated, still-genuinely-in-progress action by the time this rest
    // completes, and an unconditional delete would remove it outright
    // without ever landing it.
    completeIfOwnedRestAction(state, completedActionId);
    emp.ticksWorked = 0;
    restCompleted.push(emp.id);
  }
}

/**
 * Increment ticksWorked for an active (non-idle) employee who is not currently resting
 * and does not already have a pending rest action queued.
 */
export function incrementWorkTick(
  state: GameState,
  emp: Employee,
): void {
  if (emp.activeActionId === null) return;
  if (emp.restTicksRemaining !== null) return;
  // Walking to a rest whose timer hasn't started yet is not work either
  // (#437) — without this, a claimed-but-not-yet-arrived rest still counted
  // toward the shift-cycle work quota for every tick of the walk.
  if (emp.pendingRestDuration !== null) return;

  // Skip if employee already has a pending rest action (voluntary rest)
  const hasRestAction = state.pendingActions.some(
    a => a.type === 'rest' && a.targetEmployeeId === emp.id,
  );
  if (hasRestAction) return;

  emp.ticksWorked += 1;
}
