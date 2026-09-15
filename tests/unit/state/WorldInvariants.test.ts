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
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { FragmentState } from '../../../src/core/economy/Logistics.js';
import { Random } from '../../../src/core/math/Random.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { tickCommand } from '../../../src/console/commands/events.js';

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

// ── I1: dangling driver reference ───────────────────────────────────────────

describe('assertWorldInvariants — I1_dangling_driver_reference', () => {
  it('no violation when driverId is null', () => {
    const state = makeState();
    addVehicle(state, { driverId: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when driverId names a living employee', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    addVehicle(state, { driverId: emp.id, x: 0, z: 0 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when driverId names an id with no matching employee at all', () => {
    const state = makeState();
    const v = addVehicle(state, { driverId: 999 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I1_dangling_driver_reference');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when driverId names an employee who is no longer alive', () => {
    const state = makeState();
    const emp = addEmployee(state, { alive: false });
    const v = addVehicle(state, { driverId: emp.id });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I1_dangling_driver_reference');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I2: driver position mismatch ────────────────────────────────────────────

describe('assertWorldInvariants — I2_driver_position_mismatch', () => {
  it('no violation when the driver stands exactly where the vehicle is', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 12, z: 7 });
    addVehicle(state, { driverId: emp.id, x: 12, z: 7 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when the driver\'s x/z disagrees with the vehicle\'s x/z', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 12, z: 7 });
    const v = addVehicle(state, { driverId: emp.id, x: 20, z: 20 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I2_driver_position_mismatch');
    expect(violations[0]!.vehicleId).toBe(v.id);
    expect(violations[0]!.employeeId).toBe(emp.id);
  });
});

// ── I3: employee drives two vehicles ────────────────────────────────────────

describe('assertWorldInvariants — I3_employee_drives_two_vehicles', () => {
  it('no violation when every driverId is unique (or null)', () => {
    const state = makeState();
    const emp1 = addEmployee(state, { x: 0, z: 0 });
    const emp2 = addEmployee(state, { x: 1, z: 1 });
    addVehicle(state, { driverId: emp1.id, x: 0, z: 0 });
    addVehicle(state, { driverId: emp2.id, x: 1, z: 1 });
    addVehicle(state, { driverId: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when two vehicles share the same non-null driverId — reported once, against the second vehicle claiming it', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v1 = addVehicle(state, { driverId: emp.id, x: 0, z: 0 });
    const v2 = addVehicle(state, { driverId: emp.id, x: 0, z: 0 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I3_employee_drives_two_vehicles');
    expect(violations[0]!.employeeId).toBe(emp.id);
    // The second vehicle to claim the shared driverId, in fleet iteration
    // order, is the one reported — v1 is the "legitimate" first claim.
    expect(violations[0]!.vehicleId).toBe(v2.id);
    expect(violations[0]!.vehicleId).not.toBe(v1.id);
  });
});

// ── I4: moving vehicle without driver ───────────────────────────────────────

describe('assertWorldInvariants — I4_moving_vehicle_without_driver', () => {
  it('no violation when a moving vehicle has a driver aboard', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    addVehicle(state, { state: 'moving', driverId: emp.id, x: 0, z: 0 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation for an idle, undriven vehicle', () => {
    const state = makeState();
    addVehicle(state, { state: 'idle', driverId: null, haulingPhase: null, breakPhase: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when state is "moving" but driverId is null', () => {
    const state = makeState();
    const v = addVehicle(state, { state: 'moving', driverId: null });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I4_moving_vehicle_without_driver');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when haulingPhase is set but driverId is null', () => {
    const state = makeState();
    const v = addVehicle(state, { state: 'idle', haulingPhase: 'to_fragment', driverId: null });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I4_moving_vehicle_without_driver');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when breakPhase is set but driverId is null', () => {
    const state = makeState();
    const v = addVehicle(state, { state: 'idle', breakPhase: 'to_boulder', driverId: null });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I4_moving_vehicle_without_driver');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I5: reservation without valid holder ────────────────────────────────────

describe('assertWorldInvariants — I5_reservation_without_valid_holder', () => {
  it('no violation when the reservation\'s holder is the vehicle\'s own driver', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v = addVehicle(state, { driverId: emp.id, x: 0, z: 0 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'in_progress' });
    v.reservedForActionId = action.id;

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the reservation\'s holder is mid-walk to board it (pendingDriverVehicleId)', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 5, z: 5, pendingDriverVehicleId: 1 });
    const v = addVehicle(state, { driverId: null, x: 0, z: 0 });
    emp.pendingDriverVehicleId = v.id;
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'assigned' });
    v.reservedForActionId = action.id;

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when the action\'s own holderId is absent but falls back to the vehicle\'s driverId', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v = addVehicle(state, { driverId: emp.id, x: 0, z: 0 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: null, status: 'in_progress' });
    v.reservedForActionId = action.id;

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when reservedForActionId names a PendingAction that no longer exists', () => {
    const state = makeState();
    const v = addVehicle(state, { reservedForActionId: 12345 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I5_reservation_without_valid_holder');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when the reservation\'s holder is neither the driver nor mid-walk to board it', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 9, z: 9, pendingDriverVehicleId: null });
    const v = addVehicle(state, { driverId: null, x: 0, z: 0 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', holderId: emp.id, status: 'assigned' });
    v.reservedForActionId = action.id;

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I5_reservation_without_valid_holder');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I6: destination partially set ───────────────────────────────────────────

describe('assertWorldInvariants — I6_destination_partially_set', () => {
  it('no violation when both destinationX and destinationZ are null', () => {
    const state = makeState();
    addEmployee(state, { destinationX: null, destinationZ: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when both destinationX and destinationZ are set', () => {
    const state = makeState();
    addEmployee(state, { destinationX: 5, destinationZ: 5 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when destinationX is set but destinationZ is null', () => {
    const state = makeState();
    const emp = addEmployee(state, { destinationX: 5, destinationZ: null });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I6_destination_partially_set');
    expect(violations[0]!.employeeId).toBe(emp.id);
  });

  it('violation when destinationZ is set but destinationX is null', () => {
    const state = makeState();
    const emp = addEmployee(state, { destinationX: null, destinationZ: 5 });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I6_destination_partially_set');
    expect(violations[0]!.employeeId).toBe(emp.id);
  });
});

// ── I7: in-progress vehicle action driver mismatch ──────────────────────────

describe('assertWorldInvariants — I7_in_progress_vehicle_action_driver_mismatch', () => {
  it('no violation when the reserved vehicle\'s driver matches the action\'s holder', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const v = addVehicle(state, { driverId: emp.id, x: 0, z: 0 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', status: 'in_progress', holderId: emp.id });
    v.reservedForActionId = action.id;

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when no vehicle is reserved for the in-progress action at all (skipped, not violated)', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', status: 'in_progress', holderId: emp.id });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when the reserved vehicle\'s driverId disagrees with the in-progress action\'s holderId', () => {
    const state = makeState();
    const emp = addEmployee(state, { x: 0, z: 0 });
    const otherEmp = addEmployee(state, { x: 1, z: 1 });
    const v = addVehicle(state, { driverId: otherEmp.id, x: 1, z: 1 });
    const action = addAction(state, { id: 1, requiredVehicleRole: 'debris_hauler', status: 'in_progress', holderId: emp.id });
    v.reservedForActionId = action.id;

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I7_in_progress_vehicle_action_driver_mismatch');
    expect(violations[0]!.actionId).toBe(action.id);
    expect(violations[0]!.vehicleId).toBe(v.id);
  });
});

// ── I8: payload not in transit ──────────────────────────────────────────────

describe('assertWorldInvariants — I8_payload_not_in_transit', () => {
  it('no violation when payloadKg is 0 and haulingFragmentId is null', () => {
    const state = makeState();
    addVehicle(state, { payloadKg: 0, haulingFragmentId: null });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when payloadKg is 0 but haulingFragmentId is set — the drive-to-fragment phase before pickup', () => {
    const state = makeState();
    addFragment(state, 1, 'on_ground');
    addVehicle(state, { payloadKg: 0, haulingFragmentId: 1 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('no violation when payloadKg > 0, haulingFragmentId is set, and the fragment is in_transit', () => {
    const state = makeState();
    addFragment(state, 1, 'in_transit');
    addVehicle(state, { payloadKg: 500, haulingFragmentId: 1 });

    expect(assertWorldInvariants(state)).toEqual([]);
  });

  it('violation when payloadKg > 0 but haulingFragmentId is null', () => {
    const state = makeState();
    const v = addVehicle(state, { payloadKg: 500, haulingFragmentId: null });

    const violations = assertWorldInvariants(state);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('I8_payload_not_in_transit');
    expect(violations[0]!.vehicleId).toBe(v.id);
  });

  it('violation when payloadKg > 0, haulingFragmentId is set, but the fragment is not in_transit', () => {
    const state = makeState();
    addFragment(state, 1, 'on_ground');
    const v = addVehicle(state, { payloadKg: 500, haulingFragmentId: 1 });

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

  it('violation when taskTicksRemaining is set but a destination is still set', () => {
    const state = makeState();
    const emp = addEmployee(state, { taskTicksRemaining: 10, destinationX: 5, destinationZ: 5 });

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
