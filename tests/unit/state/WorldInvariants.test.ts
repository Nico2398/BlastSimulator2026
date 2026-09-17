// BlastSimulator2026 — Unit tests: World-state invariant checks (#1084)
//
// One describe block per invariant I1–I9 (translated to today's GameState
// fields — see the issue's own translation table, not the target mount/
// itinerary shape in gameplay-vehicle-fleet). Each case pair constructs a
// GameState that either satisfies the invariant (assertWorldInvariants
// returns []) or breaks it (returns exactly one Violation of the matching
// kind, with the relevant entity id(s) populated). Plus two acceptance-level
// cases from the issue's Verification section.
//
// Red phase: WorldInvariants.ts's assertWorldInvariants and
// tests/helpers/worldInvariants.ts's expectNoWorldInvariantViolations are
// both stubs that throw 'not implemented' — every test below is expected to
// fail against that stub, not against a syntax/import error.

import { describe, it, expect } from 'vitest';
import { assertWorldInvariants } from '../../../src/core/state/WorldInvariants.js';
import { expectNoWorldInvariantViolations } from '../../helpers/worldInvariants.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { FragmentState } from '../../../src/core/economy/Logistics.js';
import { Random } from '../../../src/core/math/Random.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { VEHICLE_SEAT_COUNT } from '../../../src/core/config/balance.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeState(): GameState {
  return createGame({ seed: 42 });
}

/** Hires a `driver` employee (a generic role for these fixtures) and applies overrides. */
function addEmployee(state: GameState, overrides: Partial<Employee> = {}): Employee {
  const rng = new Random(1);
  const { employee } = hireEmployee(state.employees, 'driver', rng, overrides.x ?? 0, overrides.z ?? 0);
  Object.assign(employee, overrides);
  return employee;
}

/** Purchases a `debris_hauler` (a generic role for these fixtures) and applies overrides. */
function addVehicle(state: GameState, overrides: Partial<Vehicle> = {}): Vehicle {
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', overrides.x ?? 0, overrides.z ?? 0);
  Object.assign(vehicle, overrides);
  return vehicle;
}

/** Pushes a minimal PendingAction fixture, mirroring vehicles.integration.test.ts's own makeVehicleGatedAction shape. */
function addAction(state: GameState, overrides: Partial<PendingAction> & { id: number }): PendingAction {
  const action: PendingAction = {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
  state.pendingActions.push(action);
  return action;
}

/** Pushes a minimal TrackedFragment into state.logistics.fragments with the given id/state. */
function addFragment(state: GameState, id: number, fragState: FragmentState = 'on_ground'): void {
  state.logistics.fragments.push({
    fragment: {
      id,
      position: { x: 0, y: 0, z: 0 },
      volume: 1,
      mass: 10,
      rockId: 'cruite',
      oreDensities: {},
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
      halfExtents: { x: 1, y: 1, z: 1 },
      shapeSeed: 1,
    },
    state: fragState,
    vehicleId: null,
  });
}

// ── I1-I3: occupantIds/locomotion agreement (#1087) ────────────────────────
// Mount/itinerary phase 2 retargeted I1/I2/I3 from driverId-only checks to
// occupantIds/locomotion-based ones — driverId is now a plain mirror, not
// the source of truth, so these fixtures set occupantIds/locomotion
// directly rather than driverId.

describe('assertWorldInvariants — I1, occupant/locomotion agreement (#1087)', () => {
  it('no violation when a mounted employee is listed in their vehicle\'s occupantIds', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0 });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = [emp.id];

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when locomotion says mounted on V but V.occupantIds does not contain the employee', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0 });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = []; // mismatch: locomotion claims this vehicle, occupantIds disagrees

    const violations = assertWorldInvariants(state);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(x => x.vehicleId === v.id && x.employeeId === emp.id)).toBe(true);
  });

  it('violation when V.occupantIds contains the employee but their locomotion is not mounted on V', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0 });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'on_foot' }; // mismatch: occupantIds claims this employee, locomotion disagrees
    v.occupantIds = [emp.id];

    const violations = assertWorldInvariants(state);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(x => x.vehicleId === v.id && x.employeeId === emp.id)).toBe(true);
  });
});

describe('assertWorldInvariants — I2, mounted employee position agreement (#1087)', () => {
  it('no violation when a mounted employee\'s x/z matches their vehicle\'s x/z', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 12, z: 7 });
    const emp = addEmployee(state, { x: 12, z: 7 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = [emp.id];

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when a mounted employee\'s x/z disagrees with their vehicle\'s x/z', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 20, z: 20 });
    const emp = addEmployee(state, { x: 12, z: 7 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = [emp.id];

    const violations = assertWorldInvariants(state);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(x => x.vehicleId === v.id && x.employeeId === emp.id)).toBe(true);
  });
});

describe('assertWorldInvariants — I3, seat cap and no-double-occupancy (#1087)', () => {
  it('no violation when occupantIds stays within VEHICLE_SEAT_COUNT and no employee occupies two vehicles', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0 });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = [emp.id];

    expect(v.occupantIds.length).toBeLessThanOrEqual(VEHICLE_SEAT_COUNT[v.type]);
    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when occupantIds.length exceeds VEHICLE_SEAT_COUNT for that role', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0 });
    const emp1 = addEmployee(state, { x: 0, z: 0 });
    const emp2 = addEmployee(state, { x: 0, z: 0 });
    emp1.locomotion = { kind: 'mounted', vehicleId: v.id };
    emp2.locomotion = { kind: 'mounted', vehicleId: v.id };
    // debris_hauler's seat count is 1 — two occupants overflows it.
    v.occupantIds = [emp1.id, emp2.id];

    const violations = assertWorldInvariants(state);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(x => x.vehicleId === v.id)).toBe(true);
  });

  it('violation when the same employee id appears in two different vehicles\' occupantIds', () => {
    const state = makeState();
    const v1 = addVehicle(state, { x: 0, z: 0 });
    const v2 = addVehicle(state, { x: 1, z: 1 });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v1.id };
    v1.occupantIds = [emp.id];
    v2.occupantIds = [emp.id]; // same employee, two vehicles

    const violations = assertWorldInvariants(state);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(x => x.employeeId === emp.id)).toBe(true);
  });
});

// ── I4: vehicle moved without occupant (#1089) ──────────────────────────────
// Mount/itinerary phase 3b retargeted I4 from a driverId/state-based check
// (moving/haulingPhase/breakPhase implying a driver) to a position-delta
// check against vehiclePositionsAtTickStart — a vehicle only ever moves as a
// side effect of its occupant's own locomotion now (WorldInvariants.ts's own
// #1089 header comment).

describe('assertWorldInvariants — I4_vehicle_moved_without_occupant (#1089)', () => {
  it('vacuously satisfied with no vehiclePositionsAtTickStart snapshot supplied', () => {
    const state = makeState();
    addVehicle(state, { x: 10, z: 10, occupantIds: [] });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when an unoccupied vehicle stayed exactly where it was at tick start', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 10, z: 10, occupantIds: [] });
    const snapshot = new Map([[v.id, { x: 10, z: 10 }]]);

    expect(assertWorldInvariants(state, snapshot)).toEqual([]);
  });

  it('no violation when an occupied vehicle moved this tick', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 15, z: 15 });
    const v = addVehicle(state, { x: 15, z: 15, occupantIds: [emp.id] });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    const snapshot = new Map([[v.id, { x: 10, z: 10 }]]);

    expect(assertWorldInvariants(state, snapshot)).toEqual([]);
  });

  it('no violation for a vehicle with no baseline entry (created this tick)', () => {
    const state = makeState();
    addVehicle(state, { x: 15, z: 15, occupantIds: [] });
    const snapshot = new Map<number, { x: number; z: number }>(); // no entry at all

    expect(assertWorldInvariants(state, snapshot)).toEqual([]);
  });

  it('violation when an unoccupied vehicle\'s position differs from its tick-start snapshot', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 15, z: 15, occupantIds: [] });
    const snapshot = new Map([[v.id, { x: 10, z: 10 }]]);

    const violations = assertWorldInvariants(state, snapshot);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I4_vehicle_moved_without_occupant');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I5: reservation without valid holder ────────────────────────────────────

describe('assertWorldInvariants — I5_reservation_without_valid_holder', () => {
  it('no violation when the reservation\'s holder is the vehicle\'s own driver', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v = addVehicle(state, { occupantIds: [emp.id], x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'in_progress' });
    reserveVehicle(state.vehicles, v.id, action.id);

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the reservation\'s holder is mid-walk to board it (pendingDriverVehicleId)', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 5, z: 5, pendingDriverVehicleId: 1 });
    const v = addVehicle(state, { x: 0, z: 0 });
    emp.pendingDriverVehicleId = v.id;
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'assigned' });
    reserveVehicle(state.vehicles, v.id, action.id);

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the action\'s own holderId is absent but falls back to the vehicle\'s occupantIds[0]', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v = addVehicle(state, { occupantIds: [emp.id], x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: null, status: 'in_progress' });
    reserveVehicle(state.vehicles, v.id, action.id);

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when reservedForActionId names a PendingAction that no longer exists', () => {
    const state = makeState();
    const v = addVehicle(state, {});
    reserveVehicle(state.vehicles, v.id, 12345);

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I5_reservation_without_valid_holder');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when the reservation\'s holder is neither the driver nor mid-walk to board it', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 9, z: 9, pendingDriverVehicleId: null });
    const v = addVehicle(state, { x: 0, z: 0 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'assigned' });
    reserveVehicle(state.vehicles, v.id, action.id);

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I5_reservation_without_valid_holder');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I6: empty itinerary (#1089) ──────────────────────────────────────────────
// Mount/itinerary phase 3b retargeted I6 from a partially-set legacy
// destinationX/Z check to "an itinerary must never sit empty instead of
// being cleared to null" (WorldInvariants.ts's own #1089 header comment).

describe('assertWorldInvariants — I6_empty_itinerary (#1089)', () => {
  it('no violation when itinerary is null', () => {
    const state = makeState();
    addEmployee(state, {});

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the itinerary carries at least one leg', () => {
    const state = makeState();
    const emp = addEmployee(state, {});
    emp.itinerary = {
      legs: [{ mode: 'foot', vehicleId: null, destX: 5, destZ: 5, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1 }],
      goal: { kind: 'reposition', x: 5, z: 5 },
      workTicks: 0,
      estTotalTicks: 1,
    };

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when the itinerary is non-null but its legs array is empty', () => {
    const state = makeState();
    const emp = addEmployee(state, {});
    emp.itinerary = { legs: [], goal: { kind: 'reposition', x: 5, z: 5 }, workTicks: 0, estTotalTicks: 0 };

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I6_empty_itinerary');
    expect(violations[0]!.employeeId).toBe(emp.id);
  });
});

// ── I7: drive leg without mount (#1089) ─────────────────────────────────────
// Mount/itinerary phase 3b retargeted I7 from an in-progress-action/driverId
// mismatch check to "a drive leg's employee must actually be mounted in that
// leg's vehicle" (WorldInvariants.ts's own #1089 header comment).

describe('assertWorldInvariants — I7_drive_leg_without_mount (#1089)', () => {
  it('no violation when the current leg is a foot leg (drive-leg check does not apply)', () => {
    const state = makeState();
    const emp = addEmployee(state, {});
    emp.itinerary = {
      legs: [{ mode: 'foot', vehicleId: null, destX: 5, destZ: 5, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1 }],
      goal: { kind: 'reposition', x: 5, z: 5 },
      workTicks: 0,
      estTotalTicks: 1,
    };

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the current leg is a drive leg and the employee is mounted in that exact vehicle', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0, occupantIds: [] });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.locomotion = { kind: 'mounted', vehicleId: v.id };
    v.occupantIds = [emp.id];
    emp.itinerary = {
      legs: [{ mode: 'drive', vehicleId: v.id, destX: 5, destZ: 5, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1 }],
      goal: { kind: 'reposition', x: 5, z: 5 },
      workTicks: 0,
      estTotalTicks: 1,
    };

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when the current leg is a drive leg but the employee is not mounted in that vehicle', () => {
    const state = makeState();
    const v = addVehicle(state, { x: 0, z: 0, occupantIds: [] });
    const emp = addEmployee(state, { x: 0, z: 0 });
    emp.itinerary = {
      legs: [{ mode: 'drive', vehicleId: v.id, destX: 5, destZ: 5, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1 }],
      goal: { kind: 'reposition', x: 5, z: 5 },
      workTicks: 0,
      estTotalTicks: 1,
    };

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I7_drive_leg_without_mount');
    expect(violations[0]!.employeeId).toBe(emp.id);
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I8: payload not in transit ──────────────────────────────────────────────
//
// #1091: `Vehicle.payload` replaces the old `payloadKg`/`haulingFragmentId`
// pair with one `{ fragmentId; massKg } | null` field — mass and fragment
// identity travel together, so there is no longer a "payloadKg set but
// haulingFragmentId null" state to represent. I8 now reads: `payload !==
// null` implies that fragment's logistics state is `in_transit`.

describe('assertWorldInvariants — I8_payload_not_in_transit', () => {
  it('no violation when payload is null', () => {
    const state = makeState();
    addVehicle(state, { payload: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when payload names a fragment that is in_transit', () => {
    const state = makeState();
    addFragment(state, 1, 'in_transit');
    addVehicle(state, { payload: { fragmentId: 1, massKg: 500 } });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when payload names a fragment id that does not exist in logistics at all', () => {
    const state = makeState();
    const v = addVehicle(state, { payload: { fragmentId: 999, massKg: 500 } });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I8_payload_not_in_transit');
    expect(violations[0]!.vehicleId).toBe(v.id);
    expect(violations[0]!.fragmentId).toBe(999);
  });

  it('violation when payload names a fragment that is on_ground, not in_transit', () => {
    const state = makeState();
    addFragment(state, 1, 'on_ground');
    const v = addVehicle(state, { payload: { fragmentId: 1, massKg: 500 } });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I8_payload_not_in_transit');
    expect(violations[0]!.vehicleId).toBe(v.id);
    expect(violations[0]!.fragmentId).toBe(1);
  });

  it('violation when payload names a fragment that is already stored', () => {
    const state = makeState();
    addFragment(state, 1, 'stored');
    const v = addVehicle(state, { payload: { fragmentId: 1, massKg: 500 } });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I8_payload_not_in_transit');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I9: executing task still travelling ─────────────────────────────────────

describe('assertWorldInvariants — I9_executing_task_still_travelling', () => {
  it('no violation when taskTicksRemaining is null, regardless of destination', () => {
    const state = makeState();
    addEmployee(state, { taskTicksRemaining: null, destinationX: 5, destinationZ: 5 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when taskTicksRemaining is set and destination is null', () => {
    const state = makeState();
    addEmployee(state, { taskTicksRemaining: 10, destinationX: null, destinationZ: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when taskTicksRemaining is set, destination is null, and itinerary is null', () => {
    const state = makeState();
    addEmployee(state, {
      taskTicksRemaining: 10, destinationX: null, destinationZ: null, itinerary: null,
    });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when taskTicksRemaining is set but a destination is still set', () => {
    const state = makeState();
    const emp = addEmployee(state, { taskTicksRemaining: 10, destinationX: 5, destinationZ: 5 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I9_executing_task_still_travelling');
    expect(violations[0]!.employeeId).toBe(emp.id);
  });

  it('violation when taskTicksRemaining is set but a non-null itinerary is still set, with no stray destination', () => {
    const state = makeState();
    const emp = addEmployee(state, {
      taskTicksRemaining: 10,
      destinationX: null,
      destinationZ: null,
      itinerary: {
        legs: [{
          mode: 'foot', vehicleId: null, destX: 5, destZ: 5,
          arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
        }],
        goal: { kind: 'reposition', x: 5, z: 5 },
        workTicks: 0,
        estTotalTicks: 5,
      } satisfies Itinerary,
    });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I9_executing_task_still_travelling');
    expect(violations[0]!.employeeId).toBe(emp.id);
  });
});

// ── Acceptance-level cases (issue #1084's own Verification section) ────────

describe('assertWorldInvariants — acceptance', () => {
  it('returns [] for a freshly created game', () => {
    const state = createGame({ seed: 42 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('returns [] for a staffed site after a few hundred ticks of real simulation', () => {
    const ctx = makeGameContext({ seed: 42, staffed: true, cash: 1000000 });

    for (let i = 0; i < 300; i++) {
      const result = tickCommand(ctx, ['1'], {});
      expect(result.success).toBe(true);
    }

    // Exercises expectNoWorldInvariantViolations's own contract — its stub
    // throws 'not implemented' at this stage, same red-phase failure as the
    // direct assertWorldInvariants calls above.
    expectNoWorldInvariantViolations(ctx.state!);
  });
});
