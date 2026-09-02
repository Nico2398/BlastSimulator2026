// BlastSimulator2026 — Need-gauge-driven rest routing (idle employees) and
// collapse handling
//
// tickNeedRestoration auto-routes idle employees below a warning threshold to
// the nearest living_quarters; tickCollapse handles the harder collapse case
// for any alive, non-injured employee regardless of busy/idle state,
// interrupting whatever active action they held. Split out of GameLoop.ts as
// part of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { checkCollapse, type NeedKey } from '../entities/Employee.js';
import { interruptActiveAction, completePendingAction } from './TaskDispatch.js';
import {
  createRestPendingAction, findNearestBuildingOfType, findNearestLivingQuarters, resolveBuildingApproach,
} from './RestActionHelpers.js';
import { isMidEvacuationWalk } from './Evacuation.js';
import {
  NEED_WARNING_THRESHOLDS, NEED_REST_DURATIONS, NEED_REST_BUILDING_TYPES, NEED_REST_NO_BUILDING_DURATION_MULTIPLIER,
  needRestSearchRadius,
} from '../config/balance.js';

export interface NeedRestorationResult {
  /** Employee IDs that were routed to a rest action. */
  routed: number[];
  /** Employee IDs that need rest but no living_quarters building was available. */
  noBuilding: number[];
}

/**
 * Auto-routes idle employees to the nearest active living_quarters building
 * when fatigue drops below its warning threshold.
 * Busy (activeActionId set), injured, and dead employees are skipped;
 * unreachable employees (no living_quarters available) are recorded in result.noBuilding.
 */
export function tickNeedRestoration(state: GameState): NeedRestorationResult {
  const result: NeedRestorationResult = { routed: [], noBuilding: [] };

  for (const emp of state.employees.employees) {
    // Skips a busy employee (activeActionId !== null) same as always, plus —
    // via isMidEvacuationWalk — one currently walking a safe-cell order
    // outside the claim system entirely (evacuateZone). Without the latter,
    // this routine would happily self-claim a fresh rest action over that
    // walk, overwriting the evacuation destination with a walk back toward
    // whatever building is nearest. See isMidEvacuationWalk's own doc
    // comment (Evacuation.ts) for the shared reasoning across all four call
    // sites (#557).
    if (!emp.alive || emp.injured || emp.activeActionId !== null || isMidEvacuationWalk(emp)) continue;
    const needsRest = emp.fatigue < NEED_WARNING_THRESHOLDS.fatigue;

    if (!needsRest) continue;

    const needKey: NeedKey = 'fatigue';
    const restDuration = NEED_REST_DURATIONS[needKey];

    const building = findNearestLivingQuarters(state, emp.x, emp.z);
    if (!building) {
      result.noBuilding.push(emp.id);
      continue;
    }

    const approach = resolveBuildingApproach(state, building, emp.x, emp.z);

    // Immediately claimed (unlike autoInsertNeedTasks) — status/holderId
    // reflect that from creation (#547).
    const restAction = createRestPendingAction(state, {
      targetX: approach.x,
      targetZ: approach.z,
      targetEmployeeId: emp.id,
      payload: { buildingId: building.id, needKey, restDuration },
    }, emp.id);

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
    // The rest timer itself does not start until ArrivalGate.tickArrivalGate
    // confirms the employee has walked to the building (#437).
    emp.pendingRestDuration = restDuration;
    emp.pendingRestNeedKey = needKey;
    emp.destinationX = approach.x;
    emp.destinationZ = approach.z;
    result.routed.push(emp.id);
  }

  return result;
}

export interface CollapseResult {
  /** Employee IDs that collapsed this tick. */
  collapsed: number[];
}

/**
 * Check all alive, non-injured employees for collapse thresholds.
 * On collapse, creates a rest PendingAction targeting nearest suitable building.
 */
export function tickCollapse(state: GameState, _firedEvents?: FiredEvent[], _emitter?: EventEmitter): CollapseResult {
  const result: CollapseResult = { collapsed: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured) continue;
    // Without this guard, an employee whose needs cross the collapse
    // threshold while mid-evacuation (isMidEvacuationWalk — see its own doc
    // comment, Evacuation.ts, #557) gets redirected here to the nearest
    // suitable building — which, for an employee just evacuated FROM the
    // area around that same building, routes them right back inside the
    // danger zone they were ordered out of, and does so on every subsequent
    // tick once the resulting rest completes, since evacuateZone only ever
    // runs once at `zone clear` time and never re-fires to correct it —
    // confirmed live via tutorial-interactive.json's `wait_until
    // dangerZoneClear` never resolving because two evacuating employees
    // collapsed mid-walk and orbited back to their pre-evacuation
    // living_quarters forever.
    if (isMidEvacuationWalk(emp)) continue;

    // checkCollapse nulls activeActionId itself on collapse, so the previous
    // active action (if any) must be captured before calling it — otherwise
    // there is nothing left to release back to the pool.
    const priorActionId = emp.activeActionId;
    const collapsedGauge = checkCollapse(emp);
    if (!collapsedGauge) continue;

    // Needs-driven interruption (#549): release the ONE active action back to
    // 'queued' (holder/exclusivity cleared) instead of leaving it permanently
    // orphaned on the old employee — its payload is preserved on
    // interruptedActionPayload, and taskQueue is left untouched so the
    // employee's remaining queued work survives the collapse.
    if (priorActionId !== null) {
      interruptActiveAction(state, emp, priorActionId);
    }

    result.collapsed.push(emp.id);
    _firedEvents?.push({ eventId: 'employee_collapsed', firedAtTick: state.tickCount });
    _emitter?.emit('employee:collapsed', { employeeId: emp.id, needKey: collapsedGauge });

    // Determine rest duration
    let restDuration = NEED_REST_DURATIONS[collapsedGauge];

    // Find nearest suitable building
    const buildingType = NEED_REST_BUILDING_TYPES[collapsedGauge];
    const building = findNearestBuildingOfType(state, buildingType, emp.x, emp.z);

    let targetX = emp.x;
    let targetZ = emp.z;
    let buildingId: number | undefined;

    if (building) {
      const distSq = (building.x - emp.x) ** 2 + (building.z - emp.z) ** 2;
      const searchRadius = needRestSearchRadius(state.world?.sizeX ?? 0);
      if (distSq <= searchRadius ** 2) {
        const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
        targetX = approach.x;
        targetZ = approach.z;
        buildingId = building.id;
      } else {
        // Building exists but too far — the employee rests in place
        restDuration *= NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;
      }
    } else {
      // No building at all — the employee rests in place
      restDuration *= NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;
    }

    // A warning-threshold rest queued by autoInsertNeedTasks while this employee
    // was busy is now superseded: the collapse rest services the same gauge and
    // is claimed immediately. Left in the queue it is claimed the moment the
    // collapse rest ends — a second rest cycle and a second NEED_REST_COSTS
    // charge for one collapse, listed alongside the active one in the roster panel.
    // completePendingAction removes both the record and its ghost — a
    // superseded action is discarded outright, not completed by an employee,
    // but the removal shape (record + ghost, together) is the same (#547).
    for (const superseded of state.pendingActions.filter(
      a => a.type === 'rest' && a.targetEmployeeId === emp.id,
    )) {
      completePendingAction(state, superseded.id);
    }

    // Immediately claimed — status/holderId reflect that from creation (#547).
    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: { buildingId, collapsedNeed: collapsedGauge, needKey: collapsedGauge, restDuration },
    }, emp.id);

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
    // The rest timer itself does not start until
    // ArrivalGate.tickArrivalGate confirms arrival (mirrors tickNeedRestoration, #437).
    // When resting in place (targetX/Z === emp.x/z, the two no-building branches
    // above) the employee is already "arrived" and the gate resolves next tick.
    emp.pendingRestDuration = restDuration;
    emp.pendingRestNeedKey = collapsedGauge;
    emp.destinationX = targetX;
    emp.destinationZ = targetZ;
  }

  return result;
}
