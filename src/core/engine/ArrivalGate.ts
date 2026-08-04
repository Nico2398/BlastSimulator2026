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

    if (emp.pendingRestDuration !== null) {
      emp.restTicksRemaining = emp.pendingRestDuration;
      emp.restNeedKey = emp.pendingRestNeedKey;
      emp.pendingRestDuration = null;
      emp.pendingRestNeedKey = null;
      result.restStarted.push(emp.id);
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
    return;
  }

  if (vehicle.driverId !== null && vehicle.driverId !== emp.id) {
    emp.pendingDriverVehicleId = null;
    result.boardingCancelled.push({ employeeId: emp.id, reason: 'vehicle_taken' });
    return;
  }

  if (emp.x !== vehicle.x || emp.z !== vehicle.z) {
    // The employee reached where the vehicle used to be, but it has since
    // moved elsewhere — cancel rather than chase it silently.
    emp.pendingDriverVehicleId = null;
    result.boardingCancelled.push({ employeeId: emp.id, reason: 'vehicle_moved' });
    return;
  }

  const boarded = assignDriver(state.vehicles, state.employees, vehicle.id, emp.id);
  emp.pendingDriverVehicleId = null;
  if (boarded.success) {
    result.driversBoarded.push(emp.id);
    emitter?.emit('vehicle:driver_boarded', { employeeId: emp.id, vehicleId: vehicle.id });
  } else {
    result.boardingCancelled.push({ employeeId: emp.id, reason: boarded.error ?? 'unknown' });
  }
}
