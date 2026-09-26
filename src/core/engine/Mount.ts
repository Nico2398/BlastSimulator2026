// BlastSimulator2026 — The occupancy model's single writer (#1087, #1202).
// An employee can be inside a vehicle (mounted) or inside a building; both
// are one model — a host's `occupantIds` capped by its capacity, mirrored by
// the employee's `locomotion` — and this module is the only place either
// side is written. `board`/`alight` are its vehicle case, `enterBuilding`/
// `leaveBuilding` its building case; both go through the same
// `admitOccupant`/`releaseOccupant` pair below.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { Employee } from '../entities/Employee.js';
import type { Locomotion } from '../entities/EmployeeLocomotion.js';
import { canAssignDriver, canReleaseDriver, vehicleDriverId } from '../entities/Vehicle.js';
import { getBuildingDef, getBuildingPeopleCapacity } from '../entities/Building.js';
import { isMounted, isInsideBuilding } from '../entities/EmployeeLocomotion.js';
import { findBuildingExitCell, isOnBuildingRing } from '../nav/BuildingApproach.js';
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { t } from '../i18n/I18n.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { isStepClimbable } from '../nav/NavGrid.js';
import { isImpassable } from '../nav/Pathfinding.js';

type MountResult = { success: true } | { success: false; error: string };

/** Anything an employee can be inside of — a vehicle or a building. */
interface OccupancyHost {
  occupantIds: number[];
}

/**
 * The one admission step every host shares: refuses when `host` is already at
 * `capacity`, otherwise adds the employee to its occupants and sets the
 * matching `locomotion` — both sides of the fact together, as invariant I1
 * requires. Callers run their own host-specific eligibility checks first.
 */
function admitOccupant(host: OccupancyHost, capacity: number, employee: Employee, locomotion: Locomotion): boolean {
  if (host.occupantIds.length >= capacity) return false;
  host.occupantIds.push(employee.id);
  employee.locomotion = locomotion;
  return true;
}

/**
 * The one release step every host shares: removes `employeeId` from `host`'s
 * occupants and, when the employee still exists, stands them on foot at
 * (x, z) with no journey in flight.
 */
function releaseOccupant(host: OccupancyHost | undefined, employeeId: number, employee: Employee | undefined, x: number, z: number): void {
  if (host) host.occupantIds = host.occupantIds.filter(id => id !== employeeId);
  if (!employee) return;
  employee.x = x;
  employee.z = z;
  employee.locomotion = { kind: 'on_foot' };
  // #1089 regression fix: any itinerary this employee was mid-flight on
  // named the host they just left (a drive leg, or a board leg for it) — now
  // stale the instant they step out, since they no longer occupy it.
  // Locomotion.ts always advances a non-null `itinerary`, so a caller that
  // releases an employee and then, this same tick, starts a fresh walk
  // (beginRestTravel, a reassigned foot task) had that walk silently ignored:
  // Locomotion still took the itinerary branch, spending the whole tick
  // self-healing the now impossible drive leg (advanceLeg's own
  // occupant-mismatch check aborts it) instead of picking up the fresh one,
  // so the new walk didn't actually start until the NEXT tick — one tick
  // later than it should every single time an employee is dismounted with a
  // stale itinerary still attached. Confirmed live: a `set_policy
  // mode:continuous` forced rest interrupting a driller mid-drive
  // (ForceShiftRest.ts) lost exactly one tick per rest this way, compounding
  // into vibration-budget.json's own 22-tick-slower drift and
  // level2/3-playthrough-win.json's cash drift over a run with many such
  // cycles. Clearing it here, the one place an employee ever leaves a host,
  // fixes every caller at its root instead of each one separately
  // remembering to.
  employee.itinerary = null;
  employee.pendingDriverVehicleId = null;
  // #1178: destinationX/Z is a read-only mirror of the itinerary's current
  // leg (MoveTo.ts's syncItineraryMirrors) — nulled here too so a release
  // mid-itinerary doesn't leave it stale, which would otherwise read as
  // "still walking" to isMidEvacuationWalk (Evacuation.ts) and
  // isIdleForReposition (VehicleDriverAssignment.ts).
  employee.destinationX = null;
  employee.destinationZ = null;
}

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
 * position and marks them mounted — this module is the only writer of
 * `occupantIds`, whose first entry IS the driver (#1092).
 */
export function board(state: GameState, vehicleId: number, employeeId: number, emitter?: EventEmitter): MountResult {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: t('mount.vehicle_not_found') };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: t('mount.employee_not_found') };
  if (isInsideBuilding(employee.locomotion)) return { success: false, error: t('mount.not_on_foot') };

  if (!isWithinBoardingRange(employee.x, employee.z, vehicle.x, vehicle.z)) {
    return { success: false, error: t('mount.too_far_to_board') };
  }

  const eligible = canAssignDriver(state.vehicles, state.employees, vehicleId, employeeId);
  if (!eligible.success) return { success: false, error: eligible.error };

  if (!admitOccupant(vehicle, VEHICLE_SEAT_COUNT[vehicle.type], employee, { kind: 'mounted', vehicleId })) {
    return { success: false, error: t('mount.vehicle_full') };
  }
  employee.x = vehicle.x;
  employee.z = vehicle.z;

  // #1083's lifetime counter — every prior mover (requestBoardVehicle/
  // ArrivalGate.resolveBoarding, pre-#1089) incremented it on a successful
  // board; this is now the one place a board ever succeeds. Scoped to the
  // seat that actually becomes the driver (occupantIds[0]) rather than every
  // successful board, so a future multi-seat passenger doesn't inflate it.
  if (vehicleDriverId(vehicle) === employeeId) {
    state.vehicles.driverBoardingCount++;
  }

  emitter?.emit('employee:mounted', { employeeId, vehicleId });
  emitter?.emit('vehicle:driver_boarded', { employeeId, vehicleId });

  return { success: true };
}

/**
 * Alight the driving/riding employee from a vehicle. Refuses mid-haul (via
 * `canReleaseDriver`'s own fail-closed guard) so a haul never gets orphaned
 * mid-flight. On success, the employee steps onto a free walkable cell
 * within one tile of the vehicle (or the vehicle's own cell, as a fallback)
 * and returns to `on_foot`.
 */
export function alight(state: GameState, vehicleId: number, emitter?: EventEmitter): MountResult {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: t('mount.vehicle_not_found') };

  const employeeId = vehicle.occupantIds[0] ?? null;
  if (employeeId === null) return { success: false, error: t('mount.vehicle_no_driver') };

  const guard = canReleaseDriver(state.vehicles, vehicleId);
  if (!guard.success) return { success: false, error: guard.error ?? t('mount.alight_failed') };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  const cell = findAlightCell(state, vehicle);
  releaseOccupant(vehicle, employeeId, employee, cell.x, cell.z);

  emitter?.emit('employee:alighted', { employeeId, vehicleId });

  return { success: true };
}

/**
 * First free, walkable cell among the vehicle's 8 neighbours (in the shared
 * neighbour-offset declaration order) that the driver could actually have
 * walked onto, or the vehicle's own cell when none qualifies or no NavGrid
 * has been built yet.
 *
 * The climb gate (#1151) is not decoration: alighting is the one movement in
 * the game that places an employee without routing them, and nothing ever
 * relocates an on-foot employee afterwards. Under the slope-based rule a
 * neighbour can be walkable, unoccupied, and still be a cell no agent could
 * ever reach on foot — so dropping a driver onto it strands them there for
 * the rest of the run, with their vehicle parked one cell away and no way to
 * board it again. Confirmed live on level1-playthrough-win: the hauler is
 * repositioned to (2,7) on sound, fully-connected ground, its driver steps
 * down onto (2,6) — 0.66m higher over a 1m run, past NAV_MAX_SLOPE_RATIO —
 * and that cell's own climb-reachable set is exactly one cell, itself. The
 * whole rubble haul never happened, and the level went bankrupt paying a
 * driver who could not move.
 *
 * The vehicle's own cell stays the fallback: whatever the terrain around it,
 * the vehicle drove there, so standing on it is reachable by construction.
 */
function findAlightCell(state: GameState, vehicle: Vehicle): { x: number; z: number } {
  const grid = state.navGrid;
  if (!grid) return { x: vehicle.x, z: vehicle.z };

  const from = grid.cellAt(vehicle.x, vehicle.z)?.surfaceY;
  for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
    const x = vehicle.x + dx;
    const z = vehicle.z + dz;
    const cell = grid.cellAt(x, z);
    if (!cell || isImpassable(cell, true)) continue;
    if (!isStepClimbable(from, cell.surfaceY, Math.hypot(dx, dz))) continue;
    return { x, z };
  }

  return { x: vehicle.x, z: vehicle.z };
}

/**
 * Dismount emp from their vehicle if currently mounted. No-op if on foot,
 * or if alight's own guard (e.g. a mid-haul lock) refuses. Shared by
 * every call site that needs an unconditional "give up the vehicle"
 * policy — #1103's non-rest dispatch promotion, #1118's hard-threshold
 * collapse.
 */
export function alightIfMounted(state: GameState, emp: Employee, emitter?: EventEmitter): void {
  if (isMounted(emp.locomotion)) {
    alight(state, emp.locomotion.vehicleId, emitter);
  }
}

// ── Building case (#1202) ──

/**
 * Take an on-foot employee standing on a building's ring (the cells just
 * outside its footprint) inside it. Refused when the building takes no
 * people or is already at its people capacity (`getBuildingPeopleCapacity`).
 * The employee keeps the ring cell they entered from as their x/z — the cell
 * they are put back out near on leaving — but holds no ground while inside:
 * no character is drawn, picked or shown on the minimap for them.
 */
export function enterBuilding(state: GameState, buildingId: number, employeeId: number, emitter?: EventEmitter): MountResult {
  const building = state.buildings.buildings.find(b => b.id === buildingId);
  if (!building) return { success: false, error: t('mount.building_not_found') };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: t('mount.employee_not_found') };

  if (employee.locomotion.kind !== 'on_foot') return { success: false, error: t('mount.not_on_foot') };

  if (!isOnBuildingRing(building, getBuildingDef(building.type, building.tier), employee.x, employee.z)) {
    return { success: false, error: t('mount.too_far_to_enter') };
  }

  const capacity = getBuildingPeopleCapacity(building.type, building.tier);
  if (capacity === 0) return { success: false, error: t('mount.building_takes_no_people') };
  if (!admitOccupant(building, capacity, employee, { kind: 'inside', buildingId })) {
    return { success: false, error: t('building.full') };
  }

  emitter?.emit('employee:entered_building', { employeeId, buildingId });
  return { success: true };
}

/**
 * Put an employee inside a building back out on foot, on the free ring cell
 * nearest the one they entered from (`findBuildingExitCell`). When their
 * building no longer exists — destroyed or demolished around them — they are
 * put out where they entered, which was on its ring.
 */
export function leaveBuilding(state: GameState, employeeId: number, emitter?: EventEmitter): MountResult {
  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee) return { success: false, error: t('mount.employee_not_found') };
  if (!isInsideBuilding(employee.locomotion)) return { success: false, error: t('mount.not_inside') };

  const buildingId = employee.locomotion.buildingId;
  const building = state.buildings.buildings.find(b => b.id === buildingId);
  const cell = building
    ? findBuildingExitCell(state.navGrid, building, getBuildingDef(building.type, building.tier), employee.x, employee.z)
    : { x: employee.x, z: employee.z };
  releaseOccupant(building, employeeId, employee, cell.x, cell.z);

  emitter?.emit('employee:left_building', { employeeId, buildingId });
  return { success: true };
}

/** Leave the building `emp` is inside, if any — the building counterpart of `alightIfMounted`. */
export function leaveBuildingIfInside(state: GameState, emp: Employee, emitter?: EventEmitter): MountResult {
  if (!isInsideBuilding(emp.locomotion)) return { success: true };
  return leaveBuilding(state, emp.id, emitter);
}

/**
 * Put out everyone still inside a building that no longer exists. A
 * building is removed from `state.buildings` by several paths — blast
 * clearing, projection or seismic damage, demolition, an upgrade's
 * replace — none of which can reach the employees, so the release happens
 * here, once per tick (TickPipeline.ts) and straight after a console
 * demolition. Returns the ids put out.
 */
export function releaseOccupantsOfRemovedBuildings(state: GameState, emitter?: EventEmitter): number[] {
  const released: number[] = [];
  for (const emp of state.employees.employees) {
    if (!isInsideBuilding(emp.locomotion)) continue;
    const buildingId = emp.locomotion.buildingId;
    if (state.buildings.buildings.some(b => b.id === buildingId)) continue;
    leaveBuilding(state, emp.id, emitter);
    released.push(emp.id);
  }
  return released;
}
