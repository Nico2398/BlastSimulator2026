// BlastSimulator2026 — World-state invariant checks (#1084)
//
// Pure inspection of a GameState for internal-consistency violations —
// dangling references, mismatched positions, conflicting assignments — that
// should never occur if the mount/itinerary/task machinery is correct.
// Returns a list rather than throwing so callers (tick pipeline, tests) can
// decide how to react.

import type { GameState } from './GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Locomotion } from '../entities/EmployeeLocomotion.js';
import { isMounted, mountedVehicleId, isInsideBuilding } from '../entities/EmployeeLocomotion.js';
import { vehicleDriverId, getVehicleReservation } from '../entities/Vehicle.js';
import { getBuildingPeopleCapacity } from '../entities/Building.js';
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { resolveReservationHolder, isPendingReserveAhead } from '../engine/VehicleReservation.js';
import { findInTransitFragment } from '../economy/Logistics.js';

export type ViolationKind =
  | 'I1_occupant_locomotion_mismatch'
  | 'I2_mounted_position_mismatch'
  | 'I3_employee_drives_two_vehicles'
  | 'I3_seat_capacity_exceeded'
  // #1202: the building case of the same occupancy model.
  | 'I3_building_capacity_exceeded'
  | 'I3_employee_in_two_hosts'
  | 'I5_reservation_without_valid_holder'
  | 'I8_payload_not_in_transit'
  | 'I9_executing_task_still_travelling'
  // #1089 (mount/itinerary phase 3b): the itinerary/tickLocomotion model's
  // own I4/I6/I7 semantics, replacing the pre-itinerary checks of the same
  // number.
  | 'I4_vehicle_moved_without_occupant'
  | 'I6_empty_itinerary'
  | 'I7_drive_leg_without_mount';

export interface Violation {
  kind: ViolationKind;
  employeeId?: number;
  vehicleId?: number;
  buildingId?: number;
  actionId?: number;
  fragmentId?: number;
}

function findLivingDriver(state: GameState, driverId: number): Employee | undefined {
  const employee = state.employees.employees.find(e => e.id === driverId);
  return employee && employee.alive ? employee : undefined;
}

/**
 * One thing an employee can be inside — a vehicle or a building (#1202) —
 * seen the way I1 and I3 check it: who it lists, how many it holds, and
 * whether an employee's `locomotion` names it.
 */
interface OccupancyHostView {
  ref: { vehicleId: number } | { buildingId: number };
  occupantIds: readonly number[];
  capacity: number;
  isNamedBy: (locomotion: Locomotion) => boolean;
}

function occupancyHosts(state: GameState): OccupancyHostView[] {
  return [
    ...state.vehicles.vehicles.map((v): OccupancyHostView => ({
      ref: { vehicleId: v.id },
      occupantIds: v.occupantIds,
      capacity: VEHICLE_SEAT_COUNT[v.type],
      isNamedBy: loc => isMounted(loc) && loc.vehicleId === v.id,
    })),
    ...state.buildings.buildings.map((b): OccupancyHostView => ({
      ref: { buildingId: b.id },
      occupantIds: b.occupantIds,
      capacity: getBuildingPeopleCapacity(b.type, b.tier),
      isNamedBy: loc => isInsideBuilding(loc) && loc.buildingId === b.id,
    })),
  ];
}

/**
 * I1: a host's `occupantIds` and its occupants' `Employee.locomotion` must
 * agree in both directions — every occupant must be mounted on / inside that
 * exact host, and every mounted or inside employee must appear in their
 * host's `occupantIds`. Vehicles and buildings alike (#1202).
 */
function checkI1OccupantLocomotionMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];
  const hosts = occupancyHosts(state);

  for (const host of hosts) {
    for (const employeeId of host.occupantIds) {
      const e = findLivingDriver(state, employeeId);
      if (!e || !host.isNamedBy(e.locomotion)) {
        violations.push({ kind: 'I1_occupant_locomotion_mismatch', ...host.ref, employeeId });
      }
    }
  }

  for (const e of state.employees.employees) {
    if (!e.alive || e.locomotion.kind === 'on_foot') continue;
    const host = hosts.find(h => h.isNamedBy(e.locomotion));
    if (!host || !host.occupantIds.includes(e.id)) {
      const ref = isMounted(e.locomotion) ? { vehicleId: e.locomotion.vehicleId }
        : isInsideBuilding(e.locomotion) ? { buildingId: e.locomotion.buildingId } : {};
      violations.push({ kind: 'I1_occupant_locomotion_mismatch', ...ref, employeeId: e.id });
    }
  }

  return violations;
}

/** I2: a mounted employee's position must equal their vehicle's position. */
function checkI2MountedPositionMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (!e.alive || !isMounted(e.locomotion)) continue;
    const vehicleId = mountedVehicleId(e.locomotion)!;
    const v = state.vehicles.vehicles.find(veh => veh.id === vehicleId);
    if (!v) continue; // already reported by I1
    if (e.x !== v.x || e.z !== v.z) {
      violations.push({ kind: 'I2_mounted_position_mismatch', vehicleId: v.id, employeeId: e.id });
    }
  }
  return violations;
}

/**
 * I3: a host's `occupantIds` may not exceed its capacity —
 * `VEHICLE_SEAT_COUNT[type]` for a vehicle, `getBuildingPeopleCapacity` for a
 * building (#1202) — and no employee id may appear in more than one host's
 * `occupantIds`. Two vehicles keep their original kinds; any case involving
 * a building reports the building kinds.
 */
function checkI3OccupantCapacityViolation(state: GameState): Violation[] {
  const violations: Violation[] = [];
  const seenIn = new Map<number, OccupancyHostView>();
  for (const host of occupancyHosts(state)) {
    const isVehicle = 'vehicleId' in host.ref;
    if (host.occupantIds.length > host.capacity) {
      violations.push({ kind: isVehicle ? 'I3_seat_capacity_exceeded' : 'I3_building_capacity_exceeded', ...host.ref });
    }
    for (const employeeId of host.occupantIds) {
      const earlier = seenIn.get(employeeId);
      if (earlier === undefined) {
        seenIn.set(employeeId, host);
        continue;
      }
      const bothVehicles = isVehicle && 'vehicleId' in earlier.ref;
      violations.push({ kind: bothVehicles ? 'I3_employee_drives_two_vehicles' : 'I3_employee_in_two_hosts', ...host.ref, employeeId });
    }
  }
  return violations;
}

/**
 * I4: a vehicle whose x/z changed this tick must have been driven there by a
 * genuine, occupant-validated drive leg — a vehicle only ever moves as a side
 * effect of its occupant driver's own locomotion (#1089).
 * `vehiclePositionsAtTickStart`, when supplied, is the position snapshot
 * TickPipeline.ts captures before locomotion runs this tick; when omitted (a
 * caller with no such snapshot to hand, e.g. a unit test), this check is
 * vacuously satisfied rather than requiring every caller to supply one.
 *
 * `vehiclesDrivenThisTick`, when supplied, is `tickLocomotion`'s own
 * `LocomotionResult.vehiclesMoved` (#1115 fix) — the authoritative set of
 * vehicle ids `advanceLeg` (Locomotion.ts) actually wrote a position for this
 * tick, which only ever happens after it has confirmed
 * `vehicle.occupantIds[0] === emp.id`. This is checked INSTEAD of the
 * vehicle's own tick-end `occupantIds` (which a driver who alights on arrival
 * within that same tick — a mounted-rest arrival, RestActionHelpers.ts/
 * NeedRestoration.ts, or a #1093 transport ride's own drop-off — empties out
 * by the time this check runs, even though nothing about the move itself was
 * unoccupied) and instead of a tick-START occupancy snapshot (which cannot
 * tell a real "moved with nobody ever driving it" bug apart from a same-tick
 * board-then-drive-then-alight cycle, unoccupied at both ends of the tick yet
 * genuinely, briefly driven in between — confirmed live via
 * tutorial-interactive-revolt.integration.test.ts's own #707 repro, a
 * one-cell reposition drive that boards, drives, and alights within a single
 * tick). Confirmed live via needs.integration.test.ts's own #1122
 * mounted-rest-arrival case and vehicles.integration.test.ts's own #1093
 * transport-ride cases too, both of which drive-then-alight in the arrival
 * tick and, before this fix, tripped I4 the instant it became fatal.
 */
function checkI4VehicleMovedWithoutOccupant(
  state: GameState,
  vehiclePositionsAtTickStart?: ReadonlyMap<number, { x: number; z: number }>,
  vehiclesDrivenThisTick?: ReadonlySet<number>,
): Violation[] {
  if (!vehiclePositionsAtTickStart) return [];

  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    const before = vehiclePositionsAtTickStart.get(v.id);
    if (!before) continue; // created this tick — no baseline to compare against
    const moved = before.x !== v.x || before.z !== v.z;
    if (moved && !(vehiclesDrivenThisTick?.has(v.id) ?? false)) {
      violations.push({ kind: 'I4_vehicle_moved_without_occupant', vehicleId: v.id });
    }
  }
  return violations;
}

function checkI5ReservationWithoutValidHolder(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    const reservedForActionId = getVehicleReservation(state.vehicles, v.id);
    if (reservedForActionId === null) continue;
    const action = state.pendingActions.find(a => a.id === reservedForActionId);
    if (!action) {
      violations.push({ kind: 'I5_reservation_without_valid_holder', vehicleId: v.id, actionId: reservedForActionId });
      continue;
    }
    const holderId = action.holderId ?? vehicleDriverId(v);
    if (holderId == null) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: reservedForActionId,
      });
      continue;
    }
    const holder = resolveReservationHolder(state, v, action);
    if (!holder) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: reservedForActionId,
        employeeId: holderId,
      });
      continue;
    }
    // #1103: a vehicle reserved for an action still sitting in its holder's
    // OWN taskQueue (reserveOnePoolActionAhead, EmployeeDispatchSteps.ts) is
    // legitimately not yet boarded — but only while the action is still in
    // the holder's taskQueue and the holder is not resting
    // (isPendingReserveAhead: restTicksRemaining and pendingRestDuration both
    // null, taskQueue.includes(actionId)), regardless of whether
    // activeActionId happens to be null in the one-tick gap between the
    // holder going idle and dispatch promoting this action, or still set to a
    // different in-progress action they're genuinely busy working
    // (VehicleContinuity.ts's tryContinueVehicleGatedAction is the common
    // case for the latter: continuity transfers the ABOUT-TO-FREE vehicle
    // straight onto it instead). Neither vehicleDriverId(v) nor pendingDriverVehicleId
    // reflects that yet, so without this the check flagged this ordinary,
    // transient "reserved ahead, not yet started" state as a violation on
    // every multi-action taskQueue — confirmed live on
    // level2-playthrough-win.json (pre-existing on main too, unrelated to
    // #1089/#1103's own mover work). Deliberately excludes a RESTING holder
    // (restTicksRemaining/pendingRestDuration set): both #1096 (tickCollapse,
    // fixed #1107) and #1110 (shift-rest interruption, fixed) now release a
    // holder's taskQueue-held reservation before it starts resting, so a
    // resting holder should never legitimately reach isPendingReserveAhead
    // with an unreleased reservation. The exclusion stays as a regression
    // guard: if I5 ever flags one, this exact gap reopened — pin coverage in
    // vehicles.integration.test.ts's #922 interrupt/resume case.
    const valid = vehicleDriverId(v) === holderId
      || holder.pendingDriverVehicleId === v.id
      // isPendingReserveAhead (VehicleReservation.ts) is this exact "busy
      // elsewhere, reserved ahead in taskQueue" shape — shared with
      // reconcileVehicleReservations's own identical staleness test (#1089).
      || isPendingReserveAhead(holder, action.id);
    if (!valid) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: reservedForActionId,
        employeeId: holderId,
      });
    }
  }
  return violations;
}

/** I6: an itinerary must never sit empty instead of being cleared to null. */
function checkI6EmptyItinerary(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (e.itinerary !== null && e.itinerary.legs.length === 0) {
      violations.push({ kind: 'I6_empty_itinerary', employeeId: e.id });
    }
  }
  return violations;
}

/** I7: a drive leg's employee must actually be mounted in that leg's vehicle. */
function checkI7DriveLegWithoutMount(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (!e.alive || e.itinerary === null || e.itinerary.legs.length === 0) continue;
    const leg = e.itinerary.legs[0]!;
    if (leg.mode !== 'drive') continue;
    if (!isMounted(e.locomotion) || mountedVehicleId(e.locomotion) !== leg.vehicleId) {
      const violation: Violation = { kind: 'I7_drive_leg_without_mount', employeeId: e.id };
      if (leg.vehicleId !== null) violation.vehicleId = leg.vehicleId;
      violations.push(violation);
    }
  }
  return violations;
}

/**
 * I8: a vehicle carrying `payload` must have its named fragment tracked
 * `in_transit` in logistics — the two are meant to move together (#1091,
 * `vehicle.payload` replaces the old payloadKg/haulingFragmentId pair). A
 * mismatch here means the fragment and cargo bookkeeping have desynced.
 */
function checkI8PayloadNotInTransit(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.payload === null) continue;
    const tracked = findInTransitFragment(state.logistics, v.payload.fragmentId);
    if (!tracked) {
      violations.push({ kind: 'I8_payload_not_in_transit', vehicleId: v.id, fragmentId: v.payload.fragmentId });
    }
  }
  return violations;
}

/**
 * Violation kinds severe enough to abort the tick outright rather than
 * merely being collected and reported (#1091, #1115). I8: a desynced
 * payload/logistics pairing corrupts every later tick that computes against
 * it. I4/I5 (#1115): a vehicle moved with no occupant, or a reservation with
 * no valid holder, means the mount/reservation bookkeeping has already
 * desynced from the itinerary that is supposed to drive it — every later
 * dispatch/locomotion tick built on top of that state is unreliable in the
 * same way an I8 desync is. TickPipeline.ts's dev/test-only invariant check
 * throws the instant it finds one of these instead of letting the game keep
 * running on bad state. Every other violation kind keeps the existing
 * collect-and-continue behavior.
 */
export const FATAL_VIOLATION_KINDS: ReadonlySet<ViolationKind> = new Set<ViolationKind>([
  'I4_vehicle_moved_without_occupant',
  'I5_reservation_without_valid_holder',
  'I8_payload_not_in_transit',
]);

/**
 * I9: an executing task's employee should not still be travelling — via
 * (#1090) an unconsumed itinerary, whose destinationX/Z fields are a pure
 * derived mirror of it (#1178) and so are checked as the same mechanism.
 * A task shouldn't be running (taskTicksRemaining set) while the employee
 * still has movement left to do.
 */
function checkI9ExecutingTaskStillTravelling(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (e.taskTicksRemaining !== null
      && (e.destinationX !== null || e.destinationZ !== null || e.itinerary !== null)) {
      violations.push({ kind: 'I9_executing_task_still_travelling', employeeId: e.id });
    }
  }
  return violations;
}

export function assertWorldInvariants(
  state: GameState,
  // #1089: vehicle x/z captured before this tick's locomotion step, so I4 can
  // tell "moved" from "stationary" without re-deriving it from vehicle.state.
  // TickPipeline.ts's own runTick captures and passes this; a caller with no
  // snapshot to hand gets I4 vacuously satisfied.
  vehiclePositionsAtTickStart?: ReadonlyMap<number, { x: number; z: number }>,
  // #1115: `tickLocomotion`'s own LocomotionResult.vehiclesMoved — the vehicle
  // ids a genuine, occupant-validated drive leg actually wrote a position for
  // this tick. See checkI4VehicleMovedWithoutOccupant's own doc comment for
  // why I4 needs this rather than re-deriving occupancy from vehicle.state.
  vehiclesDrivenThisTick?: ReadonlySet<number>,
): Violation[] {
  return [
    ...checkI1OccupantLocomotionMismatch(state),
    ...checkI2MountedPositionMismatch(state),
    ...checkI3OccupantCapacityViolation(state),
    ...checkI4VehicleMovedWithoutOccupant(state, vehiclePositionsAtTickStart, vehiclesDrivenThisTick),
    ...checkI5ReservationWithoutValidHolder(state),
    ...checkI6EmptyItinerary(state),
    ...checkI7DriveLegWithoutMount(state),
    ...checkI8PayloadNotInTransit(state),
    ...checkI9ExecutingTaskStillTravelling(state),
  ];
}
