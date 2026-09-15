// BlastSimulator2026 — Arrival gate
//
// Gates position-dependent entity actions (survey, rest/eating, vehicle
// boarding, hauling) on actual navmesh arrival instead of starting
// timers/effects at claim time. Ticked once per game tick from the game
// loop, after entity movement has been advanced.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { releaseArrivedEvacuationDrivers } from './EvacuationHold.js';
import { tickHaulingProgress } from '../economy/HaulingTask.js';
import { tickBreakProgress } from '../economy/BoulderBreaking.js';
import { reconcileVehicleReservations } from './VehicleReservation.js';
import { interruptActiveAction } from './TaskDispatch.js';

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
  /**
   * Vehicle-gated actions (haul_debris/fragment_debris and any future
   * vehicle-gated action) whose work completed on this tick via the vehicle
   * drive loop below, for GameLoop's completion pass to finish off with
   * completeVehicleGatedActionIfApplicable (#552).
   */
  completedVehicleActions: Array<{ actionId: number; employeeId: number }>;
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
 */
export function tickArrivalGate(state: GameState, emitter?: EventEmitter): ArrivalGateResult {
  // Dismount any evacuation driver whose vehicle has reached its
  // pendingEvacuationDestination this tick (#1042) — before the employee/
  // vehicle loops below, so a just-arrived driver is free to be picked up by
  // ordinary dispatch/rest routing the same tick, exactly like an ordinary
  // on-foot evacuee arriving at their own safe cell.
  releaseArrivedEvacuationDrivers(state, emitter);

  const result: ArrivalGateResult = {
    restStarted: [],
    taskStarted: [],
    driversBoarded: [],
    boardingCancelled: [],
    completedVehicleActions: [],
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
    }

    // The employee has physically reached the target and started working —
    // promote the PendingAction from 'assigned' (claimed, still walking) to
    // 'in_progress' (#547).
    if (workStarted && emp.activeActionId !== null) {
      const action = state.pendingActions.find(a => a.id === emp.activeActionId);
      if (action) action.status = 'in_progress';
    }
  }

  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.haulingPhase === null) continue;

    const prevPhase = vehicle.haulingPhase;
    const prevFragmentId = vehicle.haulingFragmentId;

    tickHaulingProgress(state, vehicle);

    if (prevPhase === 'to_fragment' && vehicle.haulingPhase === 'to_depot' && prevFragmentId !== null) {
      emitter?.emit('vehicle:haul_loaded', { vehicleId: vehicle.id, fragmentId: prevFragmentId });
    } else if (prevPhase === 'to_depot' && vehicle.haulingPhase === null && prevFragmentId !== null) {
      const tracked = state.logistics.fragments.find(f => f.fragment.id === prevFragmentId);
      if (tracked?.state === 'stored') {
        emitter?.emit('vehicle:haul_delivered', { vehicleId: vehicle.id, fragmentId: prevFragmentId });
        // #552: a full deliver cycle just completed for a vehicle-gated
        // haul_debris action (reservedForActionId survives a successful
        // haul — see abortHaul's doc comment) — report it so GameLoop's
        // completion pass (completeVehicleGatedActionIfApplicable) can clear
        // the PendingAction/ghost and let the employee continue.
        if (vehicle.reservedForActionId !== null && vehicle.driverId !== null) {
          result.completedVehicleActions.push({ actionId: vehicle.reservedForActionId, employeeId: vehicle.driverId });
        }
      }
    }
  }

  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.breakPhase === null) continue;

    // tickBreakProgress only returns the original fragment's id on the tick
    // it actually splits the boulder — mirror the haul loop above by
    // detecting that (rather than threading an emitter into the tick
    // function itself) and deriving the produced piece ids from what
    // appeared in logistics.fragments during this call.
    const beforeIds = new Set(state.logistics.fragments.map(f => f.fragment.id));
    const vehicleId = vehicle.id;
    // Captured before tickBreakProgress runs: a successful split leaves
    // reservedForActionId/driverId alone (see tickBreakProgress's own
    // doc comment), but reading them up front is what lets this loop report
    // the completion below regardless of that detail.
    const reservedActionId = vehicle.reservedForActionId;
    const driverId = vehicle.driverId;
    const splitFragmentId = tickBreakProgress(state, vehicle);
    if (splitFragmentId !== null) {
      const pieceIds = state.logistics.fragments
        .filter(f => !beforeIds.has(f.fragment.id))
        .map(f => f.fragment.id);
      emitter?.emit('vehicle:boulder_broken', { vehicleId, fragmentId: splitFragmentId, pieceIds });
      // #552: a fragment_debris action's work completed in this same tick
      // (breaking is atomic, unlike hauling's two-leg trip) — report it so
      // GameLoop's completion pass can clear the PendingAction/ghost and let
      // the employee continue.
      if (reservedActionId !== null && driverId !== null) {
        result.completedVehicleActions.push({ actionId: reservedActionId, employeeId: driverId });
      }
    }
  }

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
