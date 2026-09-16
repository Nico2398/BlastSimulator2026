// BlastSimulator2026 — moveTo (#1089)
// The only movement entry point. Plans an itinerary (via planItinerary) to a
// destination or a vehicle, and installs it on the employee for the
// locomotion tick to walk.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { planItinerary, buildBoardLeg, hasFreeSeatFor } from './PlanItinerary.js';
import { t } from '../i18n/I18n.js';

type MoveResult = { success: true } | { success: false; error: string };

/** Walk to (x, z), optionally via a named vehicle (a hint, not a command). */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { x: number; z: number },
  opts?: { via?: number },
): MoveResult;
/** Walk to a vehicle and board it — no destination beyond the vehicle itself. */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { vehicleId: number },
): MoveResult;
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { x: number; z: number } | { vehicleId: number },
  opts?: { via?: number },
): MoveResult {
  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee) return { success: false, error: t('move_to.employee_not_found') };

  if ('vehicleId' in target) {
    const vehicle = state.vehicles.vehicles.find(v => v.id === target.vehicleId);
    if (!vehicle) return { success: false, error: t('move_to.vehicle_not_found') };
    if (!hasFreeSeatFor(vehicle, employee)) return { success: false, error: t('move_to.vehicle_unavailable') };

    const leg = buildBoardLeg(state, employee, vehicle, 'exact');
    if (leg === null) return { success: false, error: t('move_to.no_route_to_vehicle') };

    employee.itinerary = {
      legs: [leg],
      goal: { kind: 'reposition', x: vehicle.x, z: vehicle.z },
      workTicks: 0,
      estTotalTicks: leg.estTicks,
    };
    syncPendingDriverVehicleId(employee);
    return { success: true };
  }

  const itinerary = planItinerary(state, employee, { kind: 'reposition', x: target.x, z: target.z }, 'exact', opts);
  if (itinerary === null) return { success: false, error: t('move_to.no_route_available') };

  employee.itinerary = itinerary;
  syncPendingDriverVehicleId(employee);
  return { success: true };
}

/**
 * Keeps `employee.pendingDriverVehicleId` — the read-only mirror
 * ForceShiftRest.ts/TaskCancellation.ts/tutorialGuide.ts/FleetPanel.ts read to
 * mean "currently walking to board a vehicle" — in agreement with the
 * itinerary's own current leg: set while that leg's arrival step is a board
 * naming a vehicle, null otherwise (no itinerary, or a foot/drive leg that
 * isn't a board). Called from every point this module and Locomotion.ts
 * mutate `employee.itinerary`, so the mirror never drifts from what the
 * employee is actually walking toward.
 */
export function syncPendingDriverVehicleId(employee: Employee): void {
  const leg = employee.itinerary?.legs[0];
  employee.pendingDriverVehicleId = leg !== undefined && leg.onArrive.kind === 'board'
    ? leg.onArrive.vehicleId
    : null;
}
