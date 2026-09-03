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
import { completePendingAction } from './TaskDispatch.js';
import { completeRestForEmployee } from './RestActionHelpers.js';
import { forceShiftRestIfNeeded, forceShiftRestIfNeededByPolicy } from './ForceShiftRest.js';

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
  // Check for a bunkhouse (living_quarters tier >= 2)
  const hasBunkhouse = state.buildings.buildings.some(
    b => b.type === 'living_quarters' && b.tier >= 2 && b.active,
  );

  // #678: an applied policy (revision > 0 — see SitePolicy.ts's own doc
  // comment on `revision` for why this, not a value comparison, is what
  // "has the player set a policy?" means) runs shift-cycle processing
  // regardless of bunkhouse tier — a tier-1 living_quarters, or no building
  // at all, is a valid rest destination under a policy, not a disqualifier.
  // With no policy ever applied, behaviour is byte-for-byte identical to
  // before #678: gated on hasBunkhouse alone, same legacy rest path below.
  const policyApplied = state.sitePolicy.revision > 0;

  if (!policyApplied && !hasBunkhouse) {
    return { restCompleted: [], shiftRested: [], active: false };
  }

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
    if (policyApplied) {
      forceShiftRestIfNeededByPolicy(state, emp, firedEvents, shiftRested, _emitter);
    } else {
      forceShiftRestIfNeeded(state, emp, firedEvents, shiftRested, _emitter);
    }
  }

  return { restCompleted, shiftRested, active: true };
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
  if (emp.restTicksRemaining === null) return;
  // Rests started by tickCollapse/tickNeedRestoration/autoInsertNeedTasks
  // (Tier-1 living_quarters fatigue), or — once a site policy has
  // been applied (#678) — by forceShiftRestIfNeededByPolicy, all carry a
  // restNeedKey and are owned by tickGeneralRestCompletion instead — skip
  // them here to avoid double-processing. This function only ever runs the
  // legacy no-policy path (processShiftCycle only calls it when !policyApplied).
  if (emp.restNeedKey !== null) return;

  emp.restTicksRemaining -= 1;

  if (emp.restTicksRemaining <= 0) {
    const completedActionId = emp.activeActionId;
    // #928: verify the action activeActionId currently names is actually
    // this rest before deleting it — mirrors tickGeneralRestCompletion's own
    // identical guard (RestCompletion.ts) and the same reasoning: a vehicle-
    // gated action's arrival-promotion race (ArrivalGate.ts) can leave
    // activeActionId naming an unrelated, still-genuinely-in-progress action
    // by the time this rest completes, and completePendingAction on that
    // would delete it outright without ever landing it.
    const completedAction = completedActionId !== null
      ? state.pendingActions.find(a => a.id === completedActionId)
      : undefined;
    completeRestForEmployee(state, emp, 'fatigue');
    // forceShiftRestIfNeeded self-claims this action at creation, so — like
    // tickGeneralRestCompletion's own rest sources — nothing else removes it
    // from pendingActions/ghostPreviews once the rest completes (#547).
    if (completedActionId !== null && completedAction?.type === 'rest') {
      completePendingAction(state, completedActionId);
    }
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
