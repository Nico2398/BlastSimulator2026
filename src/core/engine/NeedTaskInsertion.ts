// BlastSimulator2026 — Proactive need-task insertion
//
// Inserts rest PendingActions for employees whose need gauges have fallen
// below their warning thresholds, for both idle and busy employees (unlike
// NeedRestoration.ts's tickNeedRestoration, which only handles idle ones and
// claims immediately — this leaves a busy employee's rest action queued,
// unclaimed, for dispatch to pick up later). Split out of GameLoop.ts as part
// of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { NeedKey } from '../entities/Employee.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { createRestPendingAction, findNearestBuildingOfType, resolveBuildingApproach } from './RestActionHelpers.js';
import { NEED_WARNING_THRESHOLDS, NEED_REST_DURATIONS, NEED_REST_BUILDING_TYPES, NEED_REST_NO_BUILDING_DURATION_MULTIPLIER } from '../config/balance.js';

export interface NeedInsertionResult {
  /** Employee/need pairs that had a rest PendingAction inserted. */
  inserted: Array<{ employeeId: number; needKey: NeedKey }>;
  /** Employee/need pairs that were skipped with a reason. */
  skipped: Array<{ employeeId: number; needKey: NeedKey; reason: string }>;
}

/**
 * Proactively inserts rest PendingActions for employees whose need gauges
 * have fallen below their warning thresholds (NEED_WARNING_THRESHOLDS).
 *
 * Unlike tickNeedRestoration() which handles only idle employees and
 * immediately assigns the action (sets activeActionId), this function handles
 * both idle and busy employees. For busy employees, the rest action is
 * inserted into the pending queue without claiming it.
 *
 * Dead, injured, and collapsing employees are skipped.
 * Employees that already have a rest PendingAction in the queue are skipped.
 *
 * `justCompletedRestEmployeeIds` (#593) skips an employee whose rest
 * completed earlier this very tick (tickGeneralRestCompletion, called before
 * this function every tick — events.ts). A building's replenishment is
 * deliberately modest — a Tier-1 living_quarters lands well under its own
 * warning threshold (gameplay-employee-needs: "restores about 11", warning
 * at 25-35) — so without this guard, an employee who just finished a
 * genuine collapse-rest at a living_quarters immediately qualifies for
 * another one, self-targeted (targetEmployeeId set below) and zero distance
 * away. claimActionsTargetedAtEmployee (tickEmployees, this file) claims and
 * promotes a self-targeted action unconditionally, ahead of ever reaching
 * fillIdleEmployeeFromQueueOrPool's cost-based pool selection — so the
 * interrupted task this employee was doing before they collapsed (still
 * queued, open-pool) never gets a chance to be reclaimed. The employee
 * cycles rest-to-rest at the building forever instead. One tick's grace is
 * enough: dispatch (tickEmployees, later this same tick) gets first crack at
 * sending the employee back to their interrupted work; if the gauge is still
 * under warning once they're busy again, the next tick's insertion just
 * enqueues behind that work instead of preempting it (reserveOnePoolActionAhead).
 * The no-building path never needed this — NEED_REST_NO_BUILDING_CAP clears
 * every warning threshold in one completion, so autoInsertNeedTasks never
 * had a next rest to offer in the first place.
 */
export function autoInsertNeedTasks(
  state: GameState,
  _firedEvents?: FiredEvent[],
  _emitter?: EventEmitter,
  justCompletedRestEmployeeIds?: ReadonlySet<number>,
): NeedInsertionResult {
  const result: NeedInsertionResult = { inserted: [], skipped: [] };

  for (const emp of state.employees.employees) {
    // Skip dead, injured, or collapsing employees
    if (!emp.alive || emp.injured || emp.collapsing) continue;
    if (justCompletedRestEmployeeIds?.has(emp.id)) continue;

    // Skip employees already mid-rest — resting, or (#437) still walking to
    // rest with the timer not yet started. Their gauge is still below its
    // warning threshold — the replenishment only lands when the rest
    // completes — so without this check a second rest is queued every cycle,
    // claimed the instant the first one ends, and charged again: one wasted
    // rest and one extra NEED_REST_COSTS payment per dip below the threshold.
    // Rests created by tickCollapse/tickNeedRestoration stay in pendingActions
    // and are caught by the hasRestAction check below; a rest claimed through
    // tickEmployees is consumed from the queue, so only restTicksRemaining/
    // pendingRestDuration still mark it.
    if (emp.restTicksRemaining !== null || emp.pendingRestDuration !== null) continue;

    // Determine which gauges are below warning thresholds
    const triggeredGauges: NeedKey[] = [];
    const gauges: Array<{ key: NeedKey; value: number }> = [
      { key: 'hunger', value: emp.hunger },
      { key: 'fatigue', value: emp.fatigue },
      { key: 'breakNeed', value: emp.breakNeed },
    ];
    for (const { key, value } of gauges) {
      if (value < NEED_WARNING_THRESHOLDS[key]) {
        triggeredGauges.push(key);
      }
    }

    // If no gauges are below threshold, skip entirely
    if (triggeredGauges.length === 0) continue;

    // Check if employee already has a rest PendingAction queued
    const hasRestAction = state.pendingActions.some(
      action => action.targetEmployeeId === emp.id && action.type === 'rest',
    );

    if (hasRestAction) {
      // Record all triggered gauges as skipped
      for (const gauge of triggeredGauges) {
        result.skipped.push({ employeeId: emp.id, needKey: gauge, reason: 'rest_action_already_queued' });
        _firedEvents?.push({ eventId: 'need_warning', firedAtTick: state.tickCount });
        _emitter?.emit('employee:need_warning', { employeeId: emp.id, needKey: gauge });
      }
      continue;
    }

    // Use the first triggered gauge as the primary one (array is non-empty due to check above)
    const primaryGauge = triggeredGauges[0]!;
    const buildingType = NEED_REST_BUILDING_TYPES[primaryGauge];
    const building = findNearestBuildingOfType(state, buildingType, emp.x, emp.z);

    const approach = building ? resolveBuildingApproach(state, building, emp.x, emp.z) : null;
    const targetX = approach?.x ?? emp.x;
    const targetZ = approach?.z ?? emp.z;
    // With nowhere to go the employee rests in place, which takes longer and
    // (in completeRestForEmployee) tops the gauge out at NEED_REST_NO_BUILDING_CAP.
    const restDuration = building
      ? NEED_REST_DURATIONS[primaryGauge]
      : NEED_REST_DURATIONS[primaryGauge] * NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;

    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: {
        buildingId: building?.id,
        restDuration,
        triggeredBy: triggeredGauges,
        // Read by tickEmployees when this action is claimed, to start the
        // rest timer for the employee (see resolveRestNeedKey).
        needKey: primaryGauge,
      },
    });

    state.pendingActions.push(restAction);

    // Record each triggered gauge as inserted
    for (const gauge of triggeredGauges) {
      result.inserted.push({ employeeId: emp.id, needKey: gauge });
    }
  }

  return result;
}
