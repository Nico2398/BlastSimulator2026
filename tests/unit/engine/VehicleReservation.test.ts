// BlastSimulator2026 — Tests for VehicleReservation.ts (issue #550, #1090)
//
// Owns the exclusive claim a vehicle-gated PendingAction holds on a Vehicle
// from the moment an employee claims it until the action completes, is
// cancelled, or the vehicle is destroyed underneath it.
//
// #1090 (vehicle-fleet migration phase 4): releaseVehicleReservation is now
// claim-only — it clears reservedForActionId and never dismounts the driver
// as a side effect, on completion or on interruption alike. Continuity is an
// emergent property of a mounted employee's next planned itinerary having a
// zero-length first leg (PlanItinerary.ts), not a bolted-on mechanism, so
// findFreeVehicleForRole's own hardcoded driverId===employee.id shortcut is
// gone too — a mounted employee's own vehicle still wins ties because it
// sits at the employee's own position (distance 0), not because of a special
// case. releaseVehicleReservationKeepDriver and canReassignStrandedReservation
// are deleted outright (VehicleContinuity.ts's mechanism no longer exists).
// completeVehicleGatedAction replaces VehicleContinuity.ts's
// completeVehicleGatedActionIfApplicable as the sole vehicle-gated completion
// entry point.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, vehicleDriverId, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import {
  isLicensedForRole,
  findFreeVehicleForRole,
  reserveVehicle,
  releaseVehicleReservation,
  releaseVehicleOnCompletion,
  reconcileVehicleReservations,
  isMidVehicleGatedWork,
  completeVehicleGatedAction,
  hasBlockedQueuedActionForVehicleRole,
} from '../../../src/core/engine/VehicleReservation.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments, pickupFragment } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
// reconcileVehicleReservations no longer performs the interruption itself
// (import-cycle fix, #550) — it only reports which actions need it. Unit
// tests are allowed to import interruptActiveAction directly to perform the
// interruption the way ArrivalGate.tickArrivalGate now does, so the
// end-to-end effect can still be asserted at this level.
import { interruptActiveAction } from '../../../src/core/engine/TaskDispatch.js';
// #922: real call chains that release a vehicle-gated reservation mid-drive
// — cancellation and forced shift rest — both eventually call
// releaseVehicleReservation above, but the tests below drive them through
// their actual entry points rather than calling it directly, so a future
// regression in either chain (e.g. skipping the release, or snapping to a
// stale position) is caught here too.
import { cancelAction } from '../../../src/core/engine/TaskCancellation.js';
import { forceShiftRestIfNeeded } from '../../../src/core/engine/ForceShiftRest.js';
import { tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import { WORK_DURATION_TICKS } from '../../../src/core/config/balance.js';

const SEED = 42;

/** Minimal PendingAction fixture, mirroring EmployeeDispatch.test.ts's makeAction. */
function makeAction(_state: GameState, overrides: Partial<PendingAction> & { id: number }): PendingAction {
  return {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: 'drill_rig',
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'assigned',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
}

describe('isLicensedForRole', () => {
  it('is true when the employee holds the role\'s required licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    expect(isLicensedForRole(employee, 'drill_rig')).toBe(true);
  });

  it('is false when the employee lacks the role\'s required licence', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Driller's only starting qualification is 'blasting', not 'driving.drill_rig'.

    expect(isLicensedForRole(employee, 'drill_rig')).toBe(false);
  });
});

describe('findFreeVehicleForRole', () => {
  it('picks a free licensed vehicle of the right role, ignoring wrong-role and broken vehicles', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: wrongRole } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const { vehicle: broken } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 1);
    broken.hp = 0;
    const { vehicle: free } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 2);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(free.id);
    expect(picked!.id).not.toBe(wrongRole.id);
    expect(picked!.id).not.toBe(broken.id);
  });

  // #1090: the old continuity shortcut (`qualifying.find(v => v.driverId ===
  // employee.id)`, checked before the distance comparison) is gone —
  // continuity is now an emergent property of distance alone, since a
  // mounted employee's own vehicle sits at their exact position (distance 0)
  // by construction (Locomotion.ts writes a mounted vehicle's x/z from its
  // occupant's own). This pins that the mounted vehicle still wins, but
  // because it is nearer, not because of a special case for driverId.
  it('picks a mounted vehicle at the employee\'s own position (distance 0) over a farther, lower-id free one — distance alone, no continuity shortcut (#1090)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: fartherLowerId } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 20);
    const { vehicle: mounted } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    mounted.occupantIds = [employee.id];
    expect(mounted.id).toBeGreaterThan(fartherLowerId.id);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(mounted.id);
  });

  // A mounted vehicle is NOT preferred purely by driverId once it is no
  // longer the nearest — proves the shortcut is genuinely gone, not merely
  // untested for the tie case above.
  it('does not favor a mounted vehicle once a different, unreserved free vehicle is strictly nearer (#1090: no continuity shortcut)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: mountedButFar } = purchaseVehicle(state.vehicles, 'drill_rig', 30, 30);
    mountedButFar.occupantIds = [employee.id];
    const { vehicle: nearerFree } = purchaseVehicle(state.vehicles, 'drill_rig', 6, 5);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(nearerFree.id);
  });

  // #1002: an id-only tie-break could hand a nearby, freshly released
  // reservation's own vehicle to a lower-id but farther one instead — see
  // findFreeVehicleForRole's own doc comment.
  it('picks the nearest free vehicle by distance over a farther, lower-id one (#1002)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: fartherLowerId } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const { vehicle: nearer } = purchaseVehicle(state.vehicles, 'drill_rig', 11, 10);
    expect(nearer.id).toBeGreaterThan(fartherLowerId.id);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(nearer.id);
  });

  it('falls back to lowest id when two free vehicles are exactly equidistant (#1002)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle: lowerId } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 10);
    const { vehicle: higherId } = purchaseVehicle(state.vehicles, 'drill_rig', 15, 10);
    expect(higherId.id).toBeGreaterThan(lowerId.id);

    const picked = findFreeVehicleForRole(state, 'drill_rig', employee);

    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(lowerId.id);
  });

  it('returns null when the only matching vehicle is already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 999);

    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
  });

  it('returns null when the employee lacks the role licence, even though a free vehicle exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // No driving.drill_rig qualification assigned.
    purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
  });

  // #974's original exclusion (a dedicated haulingPhase/breakPhase check) no
  // longer applies (#1091): a vehicle mid vehicle-gated fragment work now
  // carries a non-null reservedForActionId for its whole itinerary, with no
  // separate phase field left to check (see findFreeVehicleForRole's own doc
  // comment). That case is already covered above by "returns null when the
  // only matching vehicle is already reserved for another action" — nothing
  // else distinguishes "mid-haul"/"mid-break" from any other reservation any
  // more, so the three dedicated haulingPhase/breakPhase-set/both-null cases
  // this block used to carry are redundant with that coverage and were
  // removed rather than rewritten against fields that no longer exist on
  // `Vehicle`.
});

describe('reserveVehicle', () => {
  it('sets the reservation in VehicleState.reservations, keyed by vehicleId (#1138 — replaces the old Vehicle.reservedForActionId write)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    reserveVehicle(state.vehicles, vehicle.id, 42);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(42);
  });

  it('overwrites a previous reservation for the same vehicleId rather than appending a second entry (boundary: re-reservation)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 7);

    reserveVehicle(state.vehicles, vehicle.id, 99);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(99);
    expect(state.vehicles.reservations.filter(r => r.vehicleId === vehicle.id)).toHaveLength(1);
  });
});

describe('releaseVehicleReservation (#1090: claim-only — never dismounts)', () => {
  it('clears the reservation, but leaves a boarded driver mounted', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    releaseVehicleReservation(state, 5);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    // #1090: releasing the claim is no longer a dismount — the driver stays
    // exactly where they were, still mounted.
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('is a no-op when no vehicle is reserved for the given actionId', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    expect(() => releaseVehicleReservation(state, 123)).not.toThrow();
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicleDriverId(vehicle)).toBeNull();
  });
});

// ── issue #922 / #1090: traced through the real call chains a player
// actually triggers (cancellation, forced shift rest, a hard fatigue
// collapse), not just releaseVehicleReservation called directly. Drives the
// vehicle several cells with the real tickLocomotion stepper (#1091 —
// replaces the deleted driveVehicleTowardTarget: install a plain 'reposition'
// itinerary via moveTo, already-mounted continuity keeps it a drive leg with
// no boarding walk, and tick the itinerary mover the same way the real game
// loop would) first, so "the vehicle has moved since boarding" is genuine.
//
// #1090 changes what these three chains actually do: releaseVehicleReservation
// is now claim-only, so cancelAction and tickCollapse leave the driver
// mounted exactly where the vehicle stopped — no snap needed, because they
// were never displaced. forceShiftRestIfNeeded's mid-drive interruption is
// the one exception: its rest-walk needs the employee on foot, so
// finishForceRest (ForceShiftRest.ts) deliberately alights them — landing at
// the vehicle's current cell (Mount.alight's own fallback with no NavGrid
// built), same observable landing spot as before #1090, just via a
// deliberate call instead of an automatic side effect of releasing the claim.

/** Vehicle-gated PendingAction fixture matching makeAction, with a fixed holder. */
function makeVehicleGatedHeldAction(id: number, holderId: number): PendingAction {
  return makeAction({} as GameState, {
    id, holderId, status: 'in_progress', targetX: 30, targetZ: 0, requiredVehicleRole: 'drill_rig',
  });
}

describe("releaseVehicleReservation's real call chains (#922, #1090)", () => {
  it('cancelAction (TaskCancellation.ts) releases the claim but leaves the driver mounted, still parked wherever the vehicle actually stopped (#1090: claim-only release)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeVehicleGatedHeldAction(30, employee.id);
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    employee.x = 0;
    employee.z = 0;

    // Real driving — several cells, no NavGrid (state.navGrid is null on a
    // freshly-created game), so tickVehicleDirectLine advances one cell/tick.
    moveTo(state, employee.id, { x: 30, z: 0 });
    for (let i = 0; i < 5; i++) tickLocomotion(state);
    expect(vehicle.x).toBeGreaterThan(0); // sanity: it actually moved

    const vehicleXAtCancel = vehicle.x;
    const vehicleZAtCancel = vehicle.z;

    const result = cancelAction(state, action.id);

    expect(result.success).toBe(true);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    // #1090: cancelling the action no longer dismounts the driver as a side
    // effect — they stay exactly where the vehicle was, still mounted.
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.x).toBe(vehicleXAtCancel);
    expect(employee.z).toBe(vehicleZAtCancel);
    // Never the original boarding cell — the vehicle demonstrably moved.
    expect(employee.x).not.toBe(0);
  });

  it('forceShiftRestIfNeeded (ForceShiftRest.ts) keeps the driver mounted and drives them to the rest destination (#1118) — not the alight-before-rest-walk guard #1090 briefly added and #1118 supersedes', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeVehicleGatedHeldAction(31, employee.id);
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    employee.x = 0;
    employee.z = 0;

    moveTo(state, employee.id, { x: 30, z: 0 });
    for (let i = 0; i < 5; i++) tickLocomotion(state);
    expect(vehicle.x).toBeGreaterThan(0);

    const vehicleXAtRest = vehicle.x;
    const vehicleZAtRest = vehicle.z;

    employee.ticksWorked = WORK_DURATION_TICKS;
    forceShiftRestIfNeeded(state, employee, [], []);

    // #1118: beginRestTravel (RestActionHelpers.ts) routes the rest through
    // moveTo/planItinerary, preserving mount continuity for a 'reposition'
    // goal — the driver stays seated and drives to the rest destination
    // instead of alighting where the interruption landed.
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.x).toBe(vehicleXAtRest);
    expect(employee.z).toBe(vehicleZAtRest);
    expect(employee.x).not.toBe(0);
  });

  // #1062: tickCollapse (NeedRestoration.ts) is the real hard-threshold call
  // chain — checkCollapse fires once fatigue reaches NEED_HARD_THRESHOLDS.fatigue
  // (0) and tickCollapse releases the interrupted action through the same
  // interruptActiveAction -> releaseActionToOpenPool -> releaseVehicleReservation
  // chain the cancelAction test above exercises.
  it('tickCollapse (NeedRestoration.ts) releases the claim and explicitly alights the driver before the rest walk (#1090 — one of the two deliberate alight-before-foot-dispatch guards, not the deleted dismount-on-completion mechanism)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeVehicleGatedHeldAction(32, employee.id);
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    employee.x = 0;
    employee.z = 0;

    moveTo(state, employee.id, { x: 30, z: 0 });
    for (let i = 0; i < 5; i++) tickLocomotion(state);
    expect(vehicle.x).toBeGreaterThan(0);

    const vehicleXAtCollapse = vehicle.x;
    const vehicleZAtCollapse = vehicle.z;

    employee.fatigue = 0; // NEED_HARD_THRESHOLDS.fatigue

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    // #1090: the collapse releases the claim (claim-only — no dismount as a
    // side effect of that release), but tickCollapse's own explicit alight
    // call right before beginRestWalk (one of the two deliberate
    // alight-before-foot-dispatch guards, alongside ForceShiftRest.ts's) does
    // dismount the driver here — a legacy destinationX/Z walk about to start
    // would otherwise desync a still-"mounted" employee's position from
    // their vehicle's (I2).
    expect(vehicleDriverId(vehicle)).toBeNull();
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(getVehicleReservation(state.vehicles, vehicle.id)).not.toBe(action.id);
    // No navGrid in this fixture — findAlightCell (Mount.ts) falls back to
    // the vehicle's own cell.
    expect(employee.x).toBe(vehicleXAtCollapse);
    expect(employee.z).toBe(vehicleZAtCollapse);
    expect(employee.x).not.toBe(0);
  });
});

describe('releaseVehicleOnCompletion', () => {
  it('frees the reservation when reservedForActionId still matches the completed action, leaving the driver mounted (#1090: releaseVehicleReservation is claim-only)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, 7);

    releaseVehicleOnCompletion(state, employee, 7);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('leaves driver and reservation untouched when a same-role follow-up already reserved the vehicle for a different action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    reserveVehicle(state.vehicles, vehicle.id, 8); // follow-up action, not the one that just completed

    releaseVehicleOnCompletion(state, employee, 7);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(8);
  });
});

describe('reconcileVehicleReservations', () => {
  it('releases a reservation whose PendingAction id no longer exists in state.pendingActions, leaving a living driver mounted (#1090: claim-only release)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 99);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    // No PendingAction with id 99 exists — orphaned reservation.

    reconcileVehicleReservations(state);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
  });

  it('releases the reservation when the reservation holder is dead (#1090: releaseVehicleReservation no longer dismounts — a dead holder\'s own driverId is a pre-existing dangling reference this call never introduces)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 10, holderId: employee.id, status: 'assigned' });
    state.pendingActions.push(action);
    employee.activeActionId = 10;
    reserveVehicle(state.vehicles, vehicle.id, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    killEmployee(state.employees, employee.id);
    reconcileVehicleReservations(state);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });

  it("interrupts (status back to 'queued') an employee whose reserved vehicle no longer exists, while still travelling (taskTicksRemaining null)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 20, holderId: employee.id, status: 'assigned', targetX: 10, targetZ: 10 });
    state.pendingActions.push(action);
    employee.activeActionId = 20;
    reserveVehicle(state.vehicles, vehicle.id, 20);
    vehicle.occupantIds = [employee.id];
    employee.taskTicksRemaining = null;

    // Vehicle destroyed underneath the employee mid-drive.
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== vehicle.id);

    const interruptions = reconcileVehicleReservations(state);

    // reconcileVehicleReservations itself is side-effect-free for this case —
    // it only reports the need to interrupt (import-cycle fix, #550). The
    // caller (ArrivalGate.tickArrivalGate) is the one that actually performs
    // it via interruptActiveAction; mirror that here.
    expect(interruptions).toEqual([{ employee, actionId: 20 }]);
    for (const { employee: emp, actionId } of interruptions) {
      interruptActiveAction(state, emp, actionId);
    }

    const reconciled = state.pendingActions.find(a => a.id === 20)!;
    expect(reconciled.status).toBe('queued');
    expect(reconciled.holderId).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('never touches an employee already mid-work-timer (taskTicksRemaining non-null), even if the vehicle is gone', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 21, holderId: employee.id, status: 'in_progress', targetX: 10, targetZ: 10 });
    state.pendingActions.push(action);
    employee.activeActionId = 21;
    reserveVehicle(state.vehicles, vehicle.id, 21);
    vehicle.occupantIds = [employee.id];
    employee.taskTicksRemaining = 5; // already working — vehicle physically arrived

    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== vehicle.id);

    reconcileVehicleReservations(state);

    const untouched = state.pendingActions.find(a => a.id === 21)!;
    expect(untouched.status).toBe('in_progress');
    expect(untouched.holderId).toBe(employee.id);
    expect(employee.activeActionId).toBe(21);
    expect(employee.taskTicksRemaining).toBe(5);
  });
});

// #945 follow-up: isMidVehicleGatedWork previously had no dedicated unit
// coverage of its own — only indirectly exercised via ForceShiftRest.test.ts's
// policy-guard cases, which only reached its true-branch and the
// requiredVehicleRole === null false-branch. Direct coverage here for every
// branch, including the three TaskCancellation.ts's own #945 follow-up
// (mid-drive interrupt pinning) now also depends on.
describe('isMidVehicleGatedWork', () => {
  it('is true when the employee is the boarded driver of the vehicle reserved for their own active, vehicle-gated action', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 1, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.occupantIds = [employee.id];

    expect(isMidVehicleGatedWork(state, employee)).toBe(true);
  });

  it('is false when the employee has no active action (boundary: activeActionId null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = null;

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it('is false when the active action id no longer names any PendingAction', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 999; // no matching entry in state.pendingActions

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it('is false when the active action requires no vehicle role', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const action = makeAction(state, { id: 2, holderId: employee.id, status: 'in_progress', requiredVehicleRole: null });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });

  it("is false when the vehicle reserved for the action is driven by someone else (rejection: driverId mismatch)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { employee: otherDriver } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 3, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.occupantIds = [otherDriver.id]; // reservation exists, but this employee never boarded it

    expect(isMidVehicleGatedWork(state, employee)).toBe(false);
  });
});

// #1090: completeVehicleGatedAction replaces VehicleContinuity.ts's
// completeVehicleGatedActionIfApplicable — cost (and any same-role follow-up)
// is now the planner's own concern (resolveActionCost/planItinerary), so this
// no longer needs its own continuity fast path or a boolean "did it handle
// this" contract: it just releases the reservation (claim-only, #1090) and
// completes the PendingAction.
describe('completeVehicleGatedAction (#1090)', () => {
  it('releases the reservation and completes the PendingAction, leaving a boarded driver mounted (happy path)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const action = makeAction(state, { id: 1, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    completeVehicleGatedAction(state, employee, action.id);

    expect(state.pendingActions.find(a => a.id === action.id)).toBeUndefined();
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    // Nothing dismounts on completion (#1090) — continuity for a same-role
    // follow-up is now entirely the planner's own emergent ranking.
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('is a no-op (does not throw) when actionId does not resolve to any PendingAction (boundary)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);

    expect(() => completeVehicleGatedAction(state, employee, 999999)).not.toThrow();
    expect(state.pendingActions).toHaveLength(0);
  });

  it('a vehicle-gated action with no reservation held (already released) still completes the PendingAction cleanly (rejection: nothing to release)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const action = makeAction(state, { id: 2, holderId: employee.id, status: 'in_progress' });
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    // No vehicle purchased/reserved at all for this action.

    expect(() => completeVehicleGatedAction(state, employee, action.id)).not.toThrow();
    expect(state.pendingActions.find(a => a.id === action.id)).toBeUndefined();
  });
});

// #1090: canReassignStrandedReservation (and the stranded-reservation-
// reassignment branch in EmployeeDispatchSteps.ts that called it) is deleted
// — the whole mechanism it existed for (VehicleContinuity.ts) is gone.

// ── #974: releaseVehicleReservation must abort vehicle-gated fragment work
// (haul/break in flight) BEFORE unassigning the driver. canReleaseDriver
// (Vehicle.ts) refuses to unassign while haulingPhase !== null, and the old
// code discarded that failure — leaving driverId permanently stuck and any
// cargo already picked up permanently lost. abortVehicleGatedFragmentWork
// (FragmentTaskLifecycle.ts) must run first so the unassign that follows
// always succeeds.

function makeCargoFragment(id: number, mass = 850): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

describe('releaseVehicleReservation aborts in-flight vehicle-gated fragment work first (#974, updated for #1090\'s claim-only release)', () => {
  it('a vehicle mid-haul (to_depot, cargo loaded) releases fully: haul state cleared, cargo fragment returned to the ground instead of permanently lost, reservation cleared, driver left mounted (#1090)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850)]);
    pickupFragment(state.logistics, 1, String(vehicle.id));

    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, 100);
    vehicle.payload = { fragmentId: 1, massKg: 850 };

    releaseVehicleReservation(state, 100);

    // The #974 bug this regression pins: without aborting the haul first,
    // canReleaseDriver refuses while payload !== null (#1091: replaces the old
    // haulingPhase guard) and driverId stays stuck forever. #1090: the driver
    // is never unassigned by a plain release any more anyway — only the
    // fragment-work abort's own cleanup (haul state, cargo) matters here now.
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.payload).toBeNull();

    // The cargo already picked up is not permanently lost — back on the ground.
    const cargo = state.logistics.fragments.find(f => f.fragment.id === 1)!;
    expect(cargo.state).toBe('on_ground');
    expect(cargo.vehicleId).toBeNull();
  });

  it('the released vehicle remains claimable by its own still-mounted driver via findFreeVehicleForRole — continuity by distance, not a special case (#1090)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850)]);
    pickupFragment(state.logistics, 1, String(vehicle.id));

    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, 101);
    vehicle.payload = { fragmentId: 1, massKg: 850 };

    releaseVehicleReservation(state, 101);

    // #1090: the driver is still mounted, so the vehicle qualifies for them
    // again (findFreeVehicleForRole's own driverId === employee.id branch of
    // its qualifying filter) — reclaimed via ordinary distance-based ranking,
    // not a dedicated continuity shortcut.
    const picked = findFreeVehicleForRole(state, 'debris_hauler', employee);
    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(vehicle.id);
  });

  it('a vehicle mid-break releases fully: break state cleared, reservation cleared, driver left mounted (#1090)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_fragmenter, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    addBlastFragments(state.logistics, [makeCargoFragment(2, 5000)]);

    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, 102);

    releaseVehicleReservation(state, 102);

    // Breaking never sets `payload` (it splits the boulder in place) — the
    // only observable state to clear here is the reservation itself, same
    // as the "neither phase set" case below (#1091: no dedicated
    // breakPhase/breakFragmentId left to distinguish "mid-break" from any
    // other reservation).
    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.payload).toBeNull();
  });

  it('a vehicle with neither phase set: same claim-only release as the plain case (#1090)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, 103);

    releaseVehicleReservation(state, 103);

    expect(vehicleDriverId(vehicle)).toBe(employee.id);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });
});

// #1090: releaseVehicleReservationKeepDriver is deleted — releaseVehicleReservation
// itself is now claim-only (see the describe blocks above), so a dedicated
// driver-retaining variant is redundant and gone along with it.

describe('hasBlockedQueuedActionForVehicleRole (#1091: untargeted haul_debris exclusion)', () => {
  it('an untargeted queued haul_debris action does not count as blocked while no active freight_warehouse exists — the #1091 exclusion, since nobody could complete it either way', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    state.pendingActions.push(makeAction(state, {
      id: 1, type: 'haul_debris', requiredVehicleRole: 'debris_hauler',
      status: 'queued', targetEmployeeId: null,
    }));
    // No freight_warehouse placed at all — hasActiveFreightWarehouse is false.

    expect(hasBlockedQueuedActionForVehicleRole(state, 'debris_hauler', employee.id)).toBe(false);
  });

  it('the same untargeted queued haul_debris action counts as blocked once an active freight_warehouse exists — genuine demand somebody else could now claim', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    state.pendingActions.push(makeAction(state, {
      id: 1, type: 'haul_debris', requiredVehicleRole: 'debris_hauler',
      status: 'queued', targetEmployeeId: null,
    }));
    const placed = placeBuilding(state.buildings, 'freight_warehouse', 10, 10, 64, 64);
    if (!placed.success) throw new Error(`Setup: placeBuilding failed — ${placed.error}`);

    expect(hasBlockedQueuedActionForVehicleRole(state, 'debris_hauler', employee.id)).toBe(true);
  });

  it('a queued haul_debris action targeted at a DIFFERENT employee still counts as blocked regardless of warehouse existence — the original #1090 hostage case the exclusion does not touch', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    const { employee: other } = hireEmployee(state.employees, 'driver', rng);
    state.pendingActions.push(makeAction(state, {
      id: 1, type: 'haul_debris', requiredVehicleRole: 'debris_hauler',
      status: 'queued', targetEmployeeId: other.id,
    }));
    // No freight_warehouse — would exclude an untargeted action, but this one
    // is targeted at `other`, so the exclusion's own `a.targetEmployeeId !== null`
    // branch already keeps it counted.

    expect(hasBlockedQueuedActionForVehicleRole(state, 'debris_hauler', employee.id)).toBe(true);
  });

  it('a non-haul_debris queued action of the same role counts as blocked with no warehouse involved — the exclusion is scoped to haul_debris only', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    state.pendingActions.push(makeAction(state, {
      id: 1, type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter',
      status: 'queued', targetEmployeeId: null,
    }));

    expect(hasBlockedQueuedActionForVehicleRole(state, 'rock_fragmenter', employee.id)).toBe(true);
  });
});
