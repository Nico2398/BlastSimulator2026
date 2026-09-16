// BlastSimulator2026 — Board/alight: the only entry points that change an
// employee's Locomotion and a vehicle's occupantIds together.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { Employee } from '../entities/Employee.js';
import { canAssignDriver, unassignDriver } from '../entities/Vehicle.js';
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { t } from '../i18n/I18n.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { isImpassable } from '../nav/Pathfinding.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';

type MountResult = { success: true } | { success: false; error: string };

/**
 * Whether two points are within one tile of each other (Chebyshev distance
 * <= 1) — the "close enough to board" test `board` itself uses. Locomotion.ts's
 * own adjacent-arrival leg check (#1089) computes the identical Chebyshev
 * test inline rather than importing this, so it stays module-private.
 */
function isWithinBoardingRange(ax: number, az: number, bx: number, bz: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz)) <= 1;
}

/**
 * Board an employee onto a vehicle: the employee must be within one tile
 * (Chebyshev distance) of the vehicle, licensed and otherwise eligible per
 * `canAssignDriver`, and the vehicle must have a free seat
 * (`VEHICLE_SEAT_COUNT`). On success, snaps the employee onto the vehicle's
 * position and marks them mounted — the vehicle's `driverId` mirror is
 * maintained only from here and from `alight`.
 */
export function board(state: GameState, vehicleId: number, employeeId: number, emitter?: EventEmitter): MountResult {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: t('mount.vehicle_not_found') };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: t('mount.employee_not_found') };

  if (!isWithinBoardingRange(employee.x, employee.z, vehicle.x, vehicle.z)) {
    return { success: false, error: t('mount.too_far_to_board') };
  }

  const eligible = canAssignDriver(state.vehicles, state.employees, vehicleId, employeeId);
  if (!eligible.success) return { success: false, error: eligible.error };

  if (vehicle.occupantIds.length >= VEHICLE_SEAT_COUNT[vehicle.type]) {
    return { success: false, error: t('mount.vehicle_full') };
  }

  vehicle.occupantIds.push(employeeId);
  vehicle.driverId = vehicle.occupantIds[0] ?? null;
  employee.x = vehicle.x;
  employee.z = vehicle.z;
  employee.locomotion = { kind: 'mounted', vehicleId };

  // #1083's lifetime counter — every prior mover (requestBoardVehicle/
  // ArrivalGate.resolveBoarding, pre-#1089) incremented it on a successful
  // board; this is now the one place a board ever succeeds. Scoped to the
  // seat that actually becomes the driver (occupantIds[0]) rather than every
  // successful board, so a future multi-seat passenger doesn't inflate it.
  if (vehicle.driverId === employeeId) {
    state.vehicles.driverBoardingCount++;
  }

  emitter?.emit('employee:mounted', { employeeId, vehicleId });
  emitter?.emit('vehicle:driver_boarded', { employeeId, vehicleId });

  return { success: true };
}

/**
 * Alight the driving/riding employee from a vehicle. Refuses mid-haul (via
 * `unassignDriver`'s own fail-closed guard) so a haul never gets orphaned
 * mid-flight. On success, the employee steps onto a free walkable cell
 * within one tile of the vehicle (or the vehicle's own cell, as a fallback)
 * and returns to `on_foot`.
 */
export function alight(state: GameState, vehicleId: number, emitter?: EventEmitter): MountResult {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: t('mount.vehicle_not_found') };

  const employeeId = vehicle.occupantIds[0] ?? null;
  if (employeeId === null) return { success: false, error: t('mount.vehicle_no_driver') };

  const guard = unassignDriver(state.vehicles, vehicleId);
  if (!guard.success) return { success: false, error: guard.error ?? t('mount.alight_failed') };

  vehicle.occupantIds = vehicle.occupantIds.filter(id => id !== employeeId);

  const employee = state.employees.employees.find(e => e.id === employeeId);
  const cell = findAlightCell(state, vehicle);
  if (employee) {
    employee.x = cell.x;
    employee.z = cell.z;
    employee.locomotion = { kind: 'on_foot' };
    // #1089 regression fix: any itinerary this employee was mid-flight on
    // named THIS vehicle (a drive leg, or a board leg for it) — now stale
    // the instant they alight, since they no longer occupy it. Locomotion.ts
    // always advances a non-null `itinerary` before ever falling back to
    // destinationX/Z, so a caller that alights an employee and then, this
    // same tick, sets a fresh legacy walk target (beginRestWalk, a
    // reassigned foot task) had that walk silently ignored: Locomotion still
    // takes the itinerary branch, spends the whole tick self-healing the now
    // impossible drive leg (advanceLeg's own occupant-mismatch check aborts
    // it) instead of ever looking at destinationX/Z, and the walk doesn't
    // actually start until the NEXT tick — one tick later than it should
    // every single time an employee is dismounted with a stale itinerary
    // still attached. Confirmed live: a `set_policy mode:continuous` forced
    // rest interrupting a driller mid-drive (ForceShiftRest.ts) lost exactly
    // one tick per rest this way, compounding into vibration-budget.json's
    // own 22-tick-slower drift and level2/3-playthrough-win.json's cash
    // drift over a run with many such cycles. Clearing it here, the one
    // place an employee ever stops being mounted, fixes every caller
    // (dismountVehicleDriver, the console `vehicle driver <id> none`
    // command, and any future one) at its root instead of each one
    // separately remembering to.
    employee.itinerary = null;
    employee.pendingDriverVehicleId = null;
  }

  emitter?.emit('employee:alighted', { employeeId, vehicleId });

  return { success: true };
}

/**
 * Alight `employee` if currently mounted, otherwise a no-op. #1090: nothing
 * dismounts automatically on interruption/completion any more, so an
 * employee about to start an on-foot walk (beginRestWalk's legacy
 * destinationX/Z fields, or promoteActionToActive's moveTo/destinationX/Z
 * fallback) can still be mounted from a vehicle-gated action that just
 * ended or was interrupted. Alight first so mount state stays consistent
 * with the walk about to start — shared by every such call site
 * (ForceShiftRest.ts, NeedRestoration.ts, EmployeeDispatchSteps.ts's
 * promoteActionToActive).
 */
export function alightIfMounted(state: GameState, employee: Employee, emitter?: EventEmitter): void {
  if (isMounted(employee.locomotion)) {
    alight(state, mountedVehicleId(employee.locomotion)!, emitter);
  }
}

/**
 * First free, walkable cell among the vehicle's 8 neighbours (in the shared
 * neighbour-offset declaration order), or the vehicle's own cell when none
 * qualifies or no NavGrid has been built yet.
 */
function findAlightCell(state: GameState, vehicle: Vehicle): { x: number; z: number } {
  const grid = state.navGrid;
  if (!grid) return { x: vehicle.x, z: vehicle.z };

  for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
    const x = vehicle.x + dx;
    const z = vehicle.z + dz;
    const cell = grid.cellAt(x, z);
    if (cell && !isImpassable(cell, true)) {
      return { x, z };
    }
  }

  return { x: vehicle.x, z: vehicle.z };
}
