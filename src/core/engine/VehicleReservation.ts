// BlastSimulator2026 — Vehicle reservation for vehicle-gated actions (#550)
// Owns the exclusive claim a PendingAction holds on a Vehicle from the
// moment an employee claims a vehicle-gated action until the action
// completes, is cancelled, or the vehicle is destroyed underneath it.
// Core-pure: imports only from entities/ and state/.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';

/** True when `employee` holds the licence a vehicle of `role` requires (ROLE_LICENCE_REQUIRED, VehicleDriverAssignment.ts). */
export function isLicensedForRole(employee: Employee, role: VehicleRole): boolean {
  void employee; void role;
  // TODO: implement
  throw new Error('not implemented');
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
  void state; void role; void employee;
  // TODO: implement
  throw new Error('not implemented');
}

/** Marks `vehicle` reserved for `actionId`. Caller must have already confirmed the vehicle came from findFreeVehicleForRole this same tick. */
export function reserveVehicle(vehicle: Vehicle, actionId: number): void {
  void vehicle; void actionId;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Unconditional release: clears reservedForActionId, and if the vehicle
 * currently has a driver, unassigns them and resets task/state to idle.
 * Used by cancellation, needs-interruption, and the death/destruction
 * reconciliation sweep. No-op if no vehicle is reserved for `actionId`.
 */
export function releaseVehicleReservation(state: GameState, actionId: number): void {
  void state; void actionId;
  // TODO: implement
  throw new Error('not implemented');
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
  void state; void employee; void completedActionId;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Per-tick reconciliation: releases any reservation whose PendingAction
 * no longer exists or whose holder is dead, and interrupts any employee
 * whose vehicle-gated active action's reserved vehicle no longer exists
 * in state.vehicles.vehicles (destroyed underneath them) — before they've
 * started the work timer. Never touches an employee already mid-work-timer.
 */
export function reconcileVehicleReservations(state: GameState): void {
  void state;
  // TODO: implement
  throw new Error('not implemented');
}
