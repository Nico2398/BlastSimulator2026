// BlastSimulator2026 — Arrival gate
//
// Gates position-dependent entity actions (survey, rest/eating, vehicle
// boarding, hauling) on actual navmesh arrival instead of starting
// timers/effects at claim time. Ticked once per game tick from the game
// loop, after entity movement has been advanced.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { assignDriver } from '../entities/Vehicle.js';
import { tickHaulingProgress } from '../economy/HaulingTask.js';
import { tickBreakProgress } from '../economy/BoulderBreaking.js';
import { tickVehicle, tickVehicleTaskState } from './EntityMovementTick.js';
import { releaseVehicleReservation, reconcileVehicleReservations } from './VehicleReservation.js';
import { seedTaskTimerFields } from './ActionSelection.js';
import { VEHICLE_ROLE_ARRIVAL_TASK } from '../config/balance.js';

/** Summary of what the arrival gate started/cancelled on this tick. */
export interface ArrivalGateResult {
  /** Employee IDs whose rest timer was started this tick because they arrived. */
  restStarted: number[];
  /** Employee IDs whose task timer was started this tick because they arrived. */
  taskStarted: number[];
  /** Employee IDs who successfully boarded a vehicle this tick because they arrived. */
  driversBoarded: number[];
  /** Employee IDs whose pending boarding was cancelled this tick, with a reason. */
  boardingCancelled: Array<{ employeeId: number; reason: 'vehicle_gone' | 'vehicle_taken' | 'vehicle_moved' | string }>;
}

/**
 * Advance the arrival gate by one tick: for every employee/vehicle with a
 * pending position-dependent action, check whether they have arrived at
 * their destination and, if so, start the corresponding timer/effect (or
 * cancel it if the precondition no longer holds).
 *
 * Must run after tickEmployeeMovement/tickVehicle have advanced positions for
 * this tick — arrival is read off their result (destinationX/Z nulled by
 * tickEmployeeMovement on arrival is the same signal EntityMovementTick.ts
 * already uses; this module reuses it rather than tracking arrival a second
 * way).
 */
export function tickArrivalGate(state: GameState, emitter?: EventEmitter): ArrivalGateResult {
  const result: ArrivalGateResult = {
    restStarted: [],
    taskStarted: [],
    driversBoarded: [],
    boardingCancelled: [],
  };

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;

    // tickEmployeeMovement clears destinationX/Z the instant x/z reaches it
    // (and never sets it at all when the employee started already on target)
    // — null on both axes is exactly "nothing left to walk toward this tick".
    const arrived = emp.destinationX === null && emp.destinationZ === null;
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
      // tickTaskProgress (GameLoop.ts) reads them at actual task completion
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

    if (emp.pendingDriverVehicleId !== null) {
      resolveBoarding(state, emp, result, emitter);
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
    const splitFragmentId = tickBreakProgress(state, vehicle);
    if (splitFragmentId !== null) {
      const pieceIds = state.logistics.fragments
        .filter(f => !beforeIds.has(f.fragment.id))
        .map(f => f.fragment.id);
      emitter?.emit('vehicle:boulder_broken', { vehicleId, fragmentId: splitFragmentId, pieceIds });
    }
  }

  // Vehicle-gated actions (#550): drive every boarded, reserved vehicle
  // toward the target GameLoop.promoteActionToActive/promoteVehicleGatedAction
  // set on claim (moveVehicle, or on the tick a boarding above just
  // completed) — the sole place a reserved vehicle's x/z is ever advanced,
  // per this file's header comment. Once it arrives, seed the holder's
  // work-timer fields (deferred at claim time specifically for this) and
  // swap the vehicle from "moving" into its role's arrival task instead of
  // the idle state tickVehicle's own arrival handling would otherwise leave
  // it in.
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.reservedForActionId === null || vehicle.driverId === null) continue;

    const alreadyAtTarget = vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ;
    if (!alreadyAtTarget) {
      tickVehicle(state, vehicle, emitter);
    }
    if (vehicle.x !== vehicle.targetX || vehicle.z !== vehicle.targetZ) continue;

    const action = state.pendingActions.find(a => a.id === vehicle.reservedForActionId);
    if (!action || action.status !== 'assigned') continue; // work already started (or reservation stale) — nothing left to seed

    const holder = action.holderId !== null ? state.employees.employees.find(e => e.id === action.holderId) : undefined;
    if (holder) {
      seedTaskTimerFields(state, holder, action);
    }

    vehicle.task = VEHICLE_ROLE_ARRIVAL_TASK[vehicle.type];
    tickVehicleTaskState(vehicle);
  }

  reconcileVehicleReservations(state);

  return result;
}

/**
 * Resolve a pending driver-boarding request for an employee who has just
 * arrived at the vehicle's position (or cancel it if the vehicle is no
 * longer boardable).
 */
function resolveBoarding(
  state: GameState,
  emp: Employee,
  result: ArrivalGateResult,
  emitter?: EventEmitter,
): void {
  const vehicleId = emp.pendingDriverVehicleId!;
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);

  if (!vehicle) {
    emp.pendingDriverVehicleId = null;
    result.boardingCancelled.push({ employeeId: emp.id, reason: 'vehicle_gone' });
    releaseReservationIfVehicleGated(state, emp);
    return;
  }

  if (vehicle.driverId !== null && vehicle.driverId !== emp.id) {
    emp.pendingDriverVehicleId = null;
    result.boardingCancelled.push({ employeeId: emp.id, reason: 'vehicle_taken' });
    releaseReservationIfVehicleGated(state, emp);
    return;
  }

  if (emp.x !== vehicle.x || emp.z !== vehicle.z) {
    // The employee reached where the vehicle used to be, but it has since
    // moved elsewhere — cancel rather than chase it silently.
    emp.pendingDriverVehicleId = null;
    result.boardingCancelled.push({ employeeId: emp.id, reason: 'vehicle_moved' });
    releaseReservationIfVehicleGated(state, emp);
    return;
  }

  const boarded = assignDriver(state.vehicles, state.employees, vehicle.id, emp.id);
  emp.pendingDriverVehicleId = null;
  if (boarded.success) {
    result.driversBoarded.push(emp.id);
    emitter?.emit('vehicle:driver_boarded', { employeeId: emp.id, vehicleId: vehicle.id });
    // #550: a vehicle-gated action already staged targetX/targetZ on this
    // vehicle at claim time (GameLoop.promoteVehicleGatedAction) but left
    // task alone so an unmanned vehicle never drove itself — now that a
    // driver is aboard, hand it to tickVehicle (ArrivalGate's own vehicle-
    // drive loop, below) the same way moveVehicle would.
    if (vehicle.reservedForActionId !== null) {
      vehicle.task = 'moving';
      vehicle.waitingTicks = 0;
    }
  } else {
    result.boardingCancelled.push({ employeeId: emp.id, reason: boarded.error ?? 'unknown' });
  }
}

/**
 * A cancelled boarding must not leave a dangling vehicle reservation behind
 * (#550) — `emp.activeActionId` still names the vehicle-gated action being
 * walked to at this point (GameLoop sets it before requesting the board), so
 * it's the lookup key back to which reservation, if any, to release.
 */
function releaseReservationIfVehicleGated(state: GameState, emp: Employee): void {
  if (emp.activeActionId === null) return;
  const action = state.pendingActions.find(a => a.id === emp.activeActionId);
  if (action && action.requiredVehicleRole !== null) {
    releaseVehicleReservation(state, action.id);
  }
}
