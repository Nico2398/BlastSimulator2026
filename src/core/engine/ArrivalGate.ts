// BlastSimulator2026 — Arrival gate
//
// Gates position-dependent entity actions (survey, rest/eating, vehicle
// boarding, hauling) on actual navmesh arrival instead of starting
// timers/effects at claim time. Ticked once per game tick from the game
// loop, after entity movement has been advanced.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { findVehicleReservedForAction } from '../entities/Vehicle.js';
import { reconcileVehicleReservations } from './VehicleReservation.js';
import { interruptActiveAction } from './TaskDispatch.js';
import { seedTaskTimerFields } from './ActionSelection.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';

/** Summary of what the arrival gate started/cancelled on this tick. */
export interface ArrivalGateResult {
  /** Employee IDs whose rest timer was started this tick because they arrived. */
  restStarted: number[];
  /** Employee IDs whose task timer was started this tick because they arrived. */
  taskStarted: number[];
  /**
   * Employee IDs who successfully boarded a vehicle this tick because they
   * arrived. Boarding itself now resolves inside tickLocomotion's own arrival
   * step (#1089) rather than here — always empty; kept on the shape so
   * console/tick.ts's existing report formatting stays untouched.
   */
  driversBoarded: number[];
  /**
   * Employee IDs whose pending boarding was cancelled this tick, with a
   * reason. Always empty for the same reason as `driversBoarded` above.
   */
  boardingCancelled: Array<{ employeeId: number; reason: 'vehicle_gone' | 'vehicle_taken' | 'vehicle_moved' | string }>;
}

/**
 * Advance the arrival gate by one tick: for every employee/vehicle with a
 * pending position-dependent action, check whether they have arrived at
 * their destination and, if so, start the corresponding timer/effect.
 *
 * Must run after tickLocomotion has advanced positions for this tick —
 * arrival is read off its result: destinationX/Z nulled by the legacy
 * foot-only mover, itinerary nulled by the itinerary mover, on arrival
 * (#1089) — this module reuses those signals rather than tracking arrival a
 * second way.
 *
 * `grid`, when provided, is threaded through to a vehicle-gated action's own
 * seedTaskTimerFields call below so a `dig_ramp_segment` action's duration
 * can be computed off the live voxel count (#924).
 */
export function tickArrivalGate(state: GameState, grid?: VoxelGrid): ArrivalGateResult {
  // #1092: an evacuation driver is dismounted by their own itinerary's final
  // `alight` arrival step (Zone.ts's clearZone, via MoveTo's alightOnArrival)
  // the tick the drive lands, so there is no separate arrived-driver sweep
  // here any more.
  const result: ArrivalGateResult = {
    restStarted: [],
    taskStarted: [],
    driversBoarded: [],
    boardingCancelled: [],
  };

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;

    // "Arrived" now covers both movers: tickEmployeeMovement's own legacy
    // destinationX/Z clears the instant x/z reaches it (and is never set at
    // all when the employee started already on target), and tickLocomotion
    // clears itinerary the instant the employee's final leg completes —
    // whichever one (never both) is currently in flight for this employee
    // must have finished for "nothing left to travel toward this tick" to
    // hold. A vehicle-gated action's own itinerary keeps `itinerary` non-null
    // for its whole foot-to-vehicle-and-drive journey (#1089) — this is what
    // used to need the now-deleted generic vehicle-drive loop's own separate
    // arrival check; an itinerary that only clears at the true destination
    // makes that special-casing unnecessary.
    const arrived = emp.destinationX === null && emp.destinationZ === null && emp.itinerary === null;
    if (!arrived) continue;

    let workStarted = false;

    if (emp.pendingRestDuration !== null) {
      emp.restTicksRemaining = emp.pendingRestDuration;
      emp.restNeedKey = emp.pendingRestNeedKey;
      emp.pendingRestDuration = null;
      emp.pendingRestNeedKey = null;
      result.restStarted.push(emp.id);
      workStarted = true;
    }

    if (emp.pendingTaskDuration !== null) {
      emp.taskTicksRemaining = emp.pendingTaskDuration;
      emp.activeTaskTotalTicks = emp.pendingTaskDuration;
      emp.pendingTaskDuration = null;
      // pendingActionType/pendingActionPayload deliberately survive arrival —
      // tickTaskProgress (TaskProgress.ts) reads them at actual task completion
      // to know what work just finished (e.g. resolving a survey) and clears
      // them itself. Clearing them here would make every task's completion
      // handler blind to what it just did (see survey.integration.test.ts).
      result.taskStarted.push(emp.id);
      workStarted = true;
    } else if (emp.taskTicksRemaining === null && emp.activeActionId !== null) {
      // A vehicle-gated action's own work timer is never staged at claim
      // time (VehicleReservation.promoteVehicleGatedAction's own doc
      // comment, #1089) — compute and start it here instead, the instant
      // the employee (and, by I2, their vehicle) actually reaches the
      // target, mirroring the pre-itinerary vehicle-drive loop's identical
      // deferral. haul_debris/fragment_debris are excluded — a haul/break
      // itinerary's own final effect (ArrivalEffects.ts's haul_unload/
      // boulder_split) already completes the action and clears
      // activeActionId the very same tick it fires, before this employee's
      // itinerary ever empties out to reach "arrived" here at all; this
      // exclusion is a defensive backstop should that invariant ever slip,
      // not the thing that makes it true. Also requires the employee to still be genuinely mounted
      // in the vehicle reserved for this action — "arrived" (itinerary ===
      // null) also covers a drive leg that just ABORTED (its vehicle
      // destroyed/reassigned underneath it, Locomotion.advanceLeg), which
      // leaves the employee back on_foot with the same activeActionId still
      // set; that case must fall through to reconcileVehicleReservations's
      // own interruption below instead of being mistaken for a real arrival.
      const action = state.pendingActions.find(a => a.id === emp.activeActionId);
      if (action && action.requiredVehicleRole !== null
        && action.type !== 'haul_debris' && action.type !== 'fragment_debris') {
        const vehicle = findVehicleReservedForAction(state.vehicles, action.id);
        if (vehicle && isMounted(emp.locomotion) && mountedVehicleId(emp.locomotion) === vehicle.id) {
          seedTaskTimerFields(state, emp, action, grid);
          emp.taskTicksRemaining = emp.pendingTaskDuration!;
          emp.activeTaskTotalTicks = emp.pendingTaskDuration!;
          emp.pendingTaskDuration = null;
          result.taskStarted.push(emp.id);
          workStarted = true;
        }
      }
    }

    // The employee has physically reached the target and started working —
    // promote the PendingAction from 'assigned' (claimed, still walking) to
    // 'in_progress' (#547).
    if (workStarted && emp.activeActionId !== null) {
      const action = state.pendingActions.find(a => a.id === emp.activeActionId);
      if (action) action.status = 'in_progress';
    }
  }

  // The old per-vehicle haul/break phase-machine loops lived here (#1091):
  // ArrivalEffects.ts's haul_load/haul_unload/boulder_split now fire from
  // inside Locomotion.ts's own itinerary walk, at the instant each drive leg
  // that carries one actually arrives — including the 'vehicle:haul_loaded'/
  // 'vehicle:haul_delivered'/'vehicle:boulder_broken' events those loops used
  // to emit here, now emitted by the effect handlers themselves
  // (ArrivalEffects.ts).

  // reconcileVehicleReservations only reports which active actions need
  // interrupting (their reserved vehicle vanished underneath them) rather
  // than interrupting them itself — that call lives in TaskDispatch.ts,
  // which VehicleReservation.ts cannot import without a cycle (TaskDispatch.ts
  // imports releaseVehicleReservation from VehicleReservation.ts).
  for (const { employee, actionId } of reconcileVehicleReservations(state)) {
    interruptActiveAction(state, employee, actionId);
  }

  return result;
}
