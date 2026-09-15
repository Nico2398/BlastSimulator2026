// BlastSimulator2026 — Board/alight: the only entry points that change an
// employee's Locomotion and a vehicle's occupantIds together.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { canAssignDriver, unassignDriver } from '../entities/Vehicle.js';
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { isImpassable } from '../nav/Pathfinding.js';

type MountResult = { success: true } | { success: false; error: string };

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
  if (!vehicle) return { success: false, error: 'Vehicle not found' };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found' };

  const distance = Math.max(Math.abs(employee.x - vehicle.x), Math.abs(employee.z - vehicle.z));
  if (distance > 1) return { success: false, error: 'Employee is too far from the vehicle to board' };

  const eligible = canAssignDriver(state.vehicles, state.employees, vehicleId, employeeId);
  if (!eligible.success) return { success: false, error: eligible.error };

  if (vehicle.occupantIds.length >= VEHICLE_SEAT_COUNT[vehicle.type]) {
    return { success: false, error: 'Vehicle is full' };
  }

  vehicle.occupantIds.push(employeeId);
  vehicle.driverId = vehicle.occupantIds[0] ?? null;
  employee.x = vehicle.x;
  employee.z = vehicle.z;
  employee.locomotion = { kind: 'mounted', vehicleId };

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
  if (!vehicle) return { success: false, error: 'Vehicle not found' };

  const employeeId = vehicle.occupantIds[0] ?? null;
  if (employeeId === null) return { success: false, error: 'Vehicle has no driver' };

  const guard = unassignDriver(state.vehicles, vehicleId);
  if (!guard.success) return { success: false, error: guard.error ?? 'Cannot alight' };

  vehicle.occupantIds = vehicle.occupantIds.filter(id => id !== employeeId);

  const employee = state.employees.employees.find(e => e.id === employeeId);
  const cell = findAlightCell(state, vehicle);
  if (employee) {
    employee.x = cell.x;
    employee.z = cell.z;
    employee.locomotion = { kind: 'on_foot' };
  }

  emitter?.emit('employee:alighted', { employeeId, vehicleId });

  return { success: true };
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
