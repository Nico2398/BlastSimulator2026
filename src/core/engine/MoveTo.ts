// BlastSimulator2026 — moveTo (#1089)
// The only movement entry point. Plans an itinerary (via planItinerary) to a
// destination or a vehicle, and installs it on the employee for the
// locomotion tick to walk.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { planItinerary, buildBoardLeg, hasFreeSeatFor } from './PlanItinerary.js';
import { leaveBuildingIfInside } from './Mount.js';
import { isMounted } from '../entities/EmployeeLocomotion.js';
import { getBuildingDef, getBuildingPeopleCapacity } from '../entities/Building.js';
import { findBuildingApproachCell, isOnBuildingRing } from '../nav/BuildingApproach.js';
import type { Itinerary } from './Itinerary.js';
import { t } from '../i18n/I18n.js';

type MoveResult = { success: true } | { success: false; error: string };

/** Walk to (x, z), optionally via a named vehicle (a hint, not a command). */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { x: number; z: number },
  // `allowUnreachable` (#1178, single-mover unification): forwarded straight
  // to planItinerary's own opts — a best-effort route instead of a refusal
  // when the target is unreachable right now.
  opts?: { via?: number; allowUnreachable?: boolean },
): MoveResult;
/** Walk to a vehicle and board it — no destination beyond the vehicle itself. */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { vehicleId: number },
): MoveResult;
/**
 * Walk (and, for a vehicle-gated action, drive) the itinerary a PendingAction
 * needs — the 'work' goal, rather than a plain 'reposition' (#1091). Routes
 * through planItinerary exactly like the (x, z) overload above, but for a
 * haul_debris/fragment_debris action this is what actually reaches
 * PlanItinerary.ts's planFragmentTaskItinerary (its fragment/depot legs and
 * load/unload/split effects) instead of the generic single-drive-leg shape a
 * 'reposition' goal to the action's own targetX/targetZ would produce.
 */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { actionId: number },
  opts?: { via?: number; allowUnreachable?: boolean },
): MoveResult;
/**
 * Walk to a building's ring and go inside it (#1202): the itinerary's last
 * leg ends on the approach cell nearest the employee
 * (`findBuildingApproachCell`) with an `enter_building` arrival step. A
 * building that takes no people is refused up front; one that is full when
 * the employee arrives refuses them there, leaving them on foot on its ring.
 * An employee in a vehicle is refused too — they alight first, since an
 * enter step is taken on foot and the vehicle they would park would stand on
 * the very cell they need.
 */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { buildingId: number },
  // #1204: rest-inside-building routing needs the same best-effort-route
  // opt-in `beginRestTravel` already uses for the (x, z) overload — see that
  // overload's own comment. No-op until the implementer threads it through.
  opts?: { allowUnreachable?: boolean },
): MoveResult;
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { x: number; z: number } | { vehicleId: number } | { actionId: number } | { buildingId: number },
  opts?: { via?: number; allowUnreachable?: boolean },
): MoveResult {
  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee) return { success: false, error: t('move_to.employee_not_found') };

  // Every journey starts on the ground: an employee inside a building steps
  // out onto its ring before any route is planned from where they stand.
  const left = leaveBuildingIfInside(state, employee);
  if (!left.success) return left;

  if ('buildingId' in target) {
    const building = state.buildings.buildings.find(b => b.id === target.buildingId);
    if (!building) return { success: false, error: t('move_to.building_not_found') };
    if (getBuildingPeopleCapacity(building.type, building.tier) === 0) {
      return { success: false, error: t('mount.building_takes_no_people') };
    }
    if (isMounted(employee.locomotion)) return { success: false, error: t('move_to.alight_first') };

    const def = getBuildingDef(building.type, building.tier);
    // Already on the ring: nothing to walk, the enter step alone — applied
    // by the locomotion tick like any other arrival.
    const itinerary = isOnBuildingRing(building, def, employee.x, employee.z)
      ? standingItinerary(employee)
      : planToCell(state, employee, findBuildingApproachCell(state.navGrid, building, def, employee.x, employee.z));
    const last = itinerary?.legs[itinerary.legs.length - 1];
    if (!itinerary || !last || last.mode !== 'foot' || last.onArrive.kind !== 'none') {
      return { success: false, error: t('move_to.no_route_available') };
    }
    last.onArrive = { kind: 'enter_building', buildingId: building.id };

    employee.itinerary = itinerary;
    syncItineraryMirrors(employee);
    return { success: true };
  }

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
    syncItineraryMirrors(employee);
    return { success: true };
  }

  if ('actionId' in target) {
    const action = state.pendingActions.find(a => a.id === target.actionId);
    if (!action) return { success: false, error: t('move_to.no_route_available') };

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact', { ...(opts?.via !== undefined ? { via: opts.via } : {}), ...(opts?.allowUnreachable !== undefined ? { allowUnreachable: opts.allowUnreachable } : {}), action });
    if (itinerary === null) return { success: false, error: t('move_to.no_route_available') };

    employee.itinerary = itinerary;
    syncItineraryMirrors(employee);
    return { success: true };
  }

  const itinerary = planItinerary(state, employee, { kind: 'reposition', x: target.x, z: target.z }, 'exact', opts);
  if (itinerary === null) return { success: false, error: t('move_to.no_route_available') };

  employee.itinerary = itinerary;
  syncItineraryMirrors(employee);
  return { success: true };
}

/** A reposition itinerary to `cell`, or null when the planner finds none. */
function planToCell(state: GameState, employee: Employee, cell: { x: number; z: number }): Itinerary | null {
  return planItinerary(state, employee, { kind: 'reposition', x: cell.x, z: cell.z }, 'exact');
}

/** A single zero-length foot leg on the employee's own cell — for an arrival step taken where they stand. */
function standingItinerary(employee: Employee): Itinerary {
  return {
    legs: [{
      mode: 'foot', vehicleId: null, destX: employee.x, destZ: employee.z,
      arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 0,
    }],
    goal: { kind: 'reposition', x: employee.x, z: employee.z },
    workTicks: 0,
    estTotalTicks: 0,
  };
}

/**
 * Turns the itinerary `employee` is currently on into one that ends with
 * them stepping off the vehicle: the final leg's arrival step becomes
 * `alight`. Used by an evacuation drive (Zone.ts's `clearZone`), where the
 * driver is expected to be back on foot the moment the vehicle is clear —
 * an ordinary player-ordered reposition leaves them in the cab instead, so
 * this is a property of the order, not of the `reposition` goal itself
 * (#1092 — replaces the `pendingEvacuationDestination` marker and the
 * separate arrival sweep that used to dismount off it).
 *
 * No-op when the employee has no itinerary, or when its last leg already
 * carries an arrival step of its own (a board, or a haul/break effect) —
 * that step is what the journey exists for and is never overwritten.
 */
export function alightOnArrival(employee: Employee | undefined): void {
  const legs = employee?.itinerary?.legs;
  if (legs === undefined || legs.length === 0) return;
  const last = legs[legs.length - 1]!;
  if (last.onArrive.kind !== 'none') return;
  last.onArrive = { kind: 'alight' };
}

/**
 * Keeps `employee.pendingDriverVehicleId` and `employee.destinationX/Z` — the
 * read-only mirrors of the itinerary's current leg — in agreement with it.
 * `pendingDriverVehicleId` (ForceShiftRest.ts/TaskCancellation.ts/
 * tutorialGuide.ts/FleetPanel.ts) is set while that leg's arrival step is a
 * board naming a vehicle, null otherwise (no itinerary, or a foot/drive leg
 * that isn't a board). `destinationX/Z` (#1178, single-mover unification) is
 * set from that same leg's own destX/destZ regardless of mode — foot or
 * drive — null only when there is no current leg at all (RestActionHelpers.ts's
 * `beginRestTravel` tests, #1178: a mounted employee's own rest-travel drive
 * leg mirrors here exactly like a foot leg would). Every call site that needs
 * to distinguish "walking on foot" from "driving a vehicle" reads the
 * itinerary's own current leg mode directly instead (e.g.
 * `isMidEvacuationDrive`, EvacuationHold.ts) rather than relying on this
 * mirror to encode that distinction on its own.
 * `isMidEvacuationWalk` (Evacuation.ts) and `isIdleForReposition`
 * (VehicleDriverAssignment.ts) read it to mean "still travelling toward
 * something" (an itinerary check already guards both ahead of it). Called
 * from every point this module and Locomotion.ts mutate `employee.itinerary`,
 * so neither mirror ever drifts from what the employee is actually en route
 * to.
 */
export function syncItineraryMirrors(employee: Employee): void {
  const leg = employee.itinerary?.legs[0];
  employee.pendingDriverVehicleId = leg !== undefined && leg.onArrive.kind === 'board'
    ? leg.onArrive.vehicleId
    : null;
  employee.destinationX = leg !== undefined ? leg.destX : null;
  employee.destinationZ = leg !== undefined ? leg.destZ : null;
}
