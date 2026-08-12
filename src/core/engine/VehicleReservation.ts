// BlastSimulator2026 — Vehicle reservation for vehicle-gated actions (#550)
// Owns the exclusive claim a PendingAction holds on a Vehicle from the
// moment an employee claims a vehicle-gated action until the action
// completes, is cancelled, or the vehicle is destroyed underneath it.
// Core-pure: imports only from entities/, state/, and EntityMovementTick.js
// (one-way, EntityMovementTick.ts never imports back). Deliberately does NOT
// import TaskDispatch.ts — TaskDispatch.ts imports releaseVehicleReservation
// from here, so calling into it back would be a cycle. Where reconciliation
// needs to interrupt an active action (case (c) below), it reports the need
// to its caller instead of performing the interruption itself — see
// reconcileVehicleReservations's return type and ArrivalGate.ts, the sole
// caller, which already imports both modules safely.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';
import { unassignDriver } from '../entities/Vehicle.js';
import { ROLE_LICENCE_REQUIRED } from '../entities/VehicleDriverAssignment.js';
import { setVehicleIdle } from './EntityMovementTick.js';

/** True when `employee` holds the licence a vehicle of `role` requires (ROLE_LICENCE_REQUIRED, VehicleDriverAssignment.ts). */
export function isLicensedForRole(employee: Employee, role: VehicleRole): boolean {
  const requiredLicence = ROLE_LICENCE_REQUIRED[role];
  return employee.qualifications.some(q => q.category === requiredLicence);
}

/**
 * Cheapest-eligible free vehicle of `role` for `employee`: unreserved
 * (reservedForActionId === null), not `broken`, and either undriven
 * (driverId === null) or already driven by `employee` themself (the
 * continuity case — lets a claim naturally re-pick the vehicle the
 * employee is already sitting in for their next same-role task).
 * Ties broken by lowest vehicle id. Read-only — never mutates.
 * Returns null when none qualify.
 */
export function findFreeVehicleForRole(state: GameState, role: VehicleRole, employee: Employee): Vehicle | null {
  if (!isLicensedForRole(employee, role)) return null;

  const qualifying = state.vehicles.vehicles.filter(v =>
    v.type === role &&
    v.state !== 'broken' &&
    v.reservedForActionId === null &&
    (v.driverId === null || v.driverId === employee.id),
  );
  if (qualifying.length === 0) return null;

  const continuity = qualifying.find(v => v.driverId === employee.id);
  if (continuity) return continuity;

  return qualifying.reduce((lowest, v) => (v.id < lowest.id ? v : lowest));
}

/** Marks `vehicle` reserved for `actionId`. Caller must have already confirmed the vehicle came from findFreeVehicleForRole this same tick. */
export function reserveVehicle(vehicle: Vehicle, actionId: number): void {
  vehicle.reservedForActionId = actionId;
}

/**
 * Unconditional release: clears reservedForActionId, and if the vehicle
 * currently has a driver, unassigns them and resets task/state to idle.
 * Used by cancellation, needs-interruption, and the death/destruction
 * reconciliation sweep. No-op if no vehicle is reserved for `actionId`.
 */
export function releaseVehicleReservation(state: GameState, actionId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === actionId);
  if (!vehicle) return;

  vehicle.reservedForActionId = null;
  if (vehicle.driverId !== null) {
    unassignDriver(state.vehicles, vehicle.id);
    setVehicleIdle(vehicle);
  }
}

/**
 * Natural-completion release: called once a vehicle-gated action finishes
 * its work timer. If the vehicle's reservedForActionId still equals
 * `completedActionId`, dismounts the driver and frees the vehicle.
 * If it now names a different action id, a same-role follow-up already
 * claimed this same vehicle — leaves driverId/reservation untouched so
 * the employee stays mounted.
 */
export function releaseVehicleOnCompletion(state: GameState, employee: Employee, completedActionId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === completedActionId);
  if (!vehicle) return;
  // Defensive: only the driver whose action just completed may trigger the
  // release — a mismatch here means the reservation/driver bookkeeping has
  // already drifted, and reconcileVehicleReservations is the one to fix it.
  if (vehicle.driverId !== null && vehicle.driverId !== employee.id) return;

  releaseVehicleReservation(state, completedActionId);
}

/** One active action reconcileVehicleReservations found needing interruption — its reserved vehicle vanished before the holder started their work timer. The caller (ArrivalGate.ts) performs the actual interruptActiveAction call, since that lives in TaskDispatch.ts and this module cannot import it without a cycle. */
export interface VehicleGoneInterruption {
  employee: Employee;
  actionId: number;
}

/**
 * Per-tick reconciliation: releases any reservation whose PendingAction
 * no longer exists or whose holder is dead, and reports any employee whose
 * vehicle-gated active action's reserved vehicle no longer exists in
 * state.vehicles.vehicles (destroyed underneath them) — before they've
 * started the work timer — so the caller can interrupt it. Never touches an
 * employee already mid-work-timer. Returns an empty array when nothing needs
 * interrupting.
 */
export function reconcileVehicleReservations(state: GameState): VehicleGoneInterruption[] {
  // (a) / (b): every still-reserved vehicle whose PendingAction vanished or
  // whose reserving employee died — release the reservation outright.
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.reservedForActionId === null) continue;
    const actionId = vehicle.reservedForActionId;
    const action = state.pendingActions.find(a => a.id === actionId);

    if (!action) {
      releaseVehicleReservation(state, actionId);
      continue;
    }

    const holderId = action.holderId ?? vehicle.driverId;
    const holder = holderId !== null ? state.employees.employees.find(e => e.id === holderId) : undefined;
    if (!holder || !holder.alive) {
      releaseVehicleReservation(state, actionId);
    }
  }

  // (c): a vehicle-gated action still claimed, still pre-work-timer, whose
  // reserved vehicle no longer exists at all — can't be caught by iterating
  // vehicles (there's nothing left to iterate), so walk actions instead.
  const interruptions: VehicleGoneInterruption[] = [];
  for (const action of state.pendingActions) {
    if (action.requiredVehicleRole === null) continue;
    if (action.holderId === null) continue;

    const holder = state.employees.employees.find(e => e.id === action.holderId);
    if (!holder || holder.taskTicksRemaining !== null) continue;

    const vehicleStillExists = state.vehicles.vehicles.some(v => v.reservedForActionId === action.id);
    if (vehicleStillExists) continue;

    interruptions.push({ employee: holder, actionId: action.id });
  }

  return interruptions;
}
