import { describe, it, expect } from 'vitest';
import { computeVehicleStatus } from '../../../src/core/entities/VehicleStatus.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';
import { Random } from '../../../src/core/math/Random.js';
import { VEHICLE_ROLE_ARRIVAL_TASK } from '../../../src/core/config/balance.js';

// #1138: computeVehicleStatus(v, vehicleState, occupant?) derives every
// status but 'broken' purely off the occupant's own fields — Vehicle itself
// carries no display state any more (task/state/waitingTicks/isMoveStuck are
// all gone). `vehicleState` is only consulted for the debris_hauler-hauling
// branch's reservation lookup.

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
    payload: null,
    occupantIds: [],
    ...overrides,
  };
}

function makeOccupant(overrides: Partial<Employee> = {}): Employee {
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(7), 0, 0);
  return Object.assign(employee, overrides);
}

function makeItinerary(): Itinerary {
  return {
    legs: [{ mode: 'drive', vehicleId: 1, destX: 9, destZ: 9, arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 6 }],
    goal: { kind: 'reposition', x: 9, z: 9 },
    workTicks: 0,
    estTotalTicks: 6,
  };
}

describe('computeVehicleStatus — broken (hp <= 0) pre-empts everything', () => {
  it('reports broken for hp <= 0, with no occupant', () => {
    const vs = createVehicleState();
    const v = makeVehicle({ hp: 0 });
    expect(computeVehicleStatus(v, vs)).toEqual({ kind: 'broken', ticks: null, haulingPhase: null, task: null });
  });

  it('reports broken for hp <= 0 even with a stuck occupant aboard', () => {
    const vs = createVehicleState();
    const v = makeVehicle({ hp: 0 });
    const occupant = makeOccupant({ isMoveStuck: true, moveConsecutiveFailures: 9 });
    expect(computeVehicleStatus(v, vs, occupant).kind).toBe('broken');
  });

  it('reports broken for negative hp too', () => {
    const vs = createVehicleState();
    const v = makeVehicle({ hp: -5 });
    expect(computeVehicleStatus(v, vs).kind).toBe('broken');
  });

  it('a vehicle with hp === 1 (just above the threshold) is not broken', () => {
    const vs = createVehicleState();
    const v = makeVehicle({ hp: 1 });
    expect(computeVehicleStatus(v, vs).kind).not.toBe('broken');
  });
});

describe('computeVehicleStatus — no occupant', () => {
  it('reports idle with no occupant and no reservation', () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    expect(computeVehicleStatus(v, vs)).toEqual({ kind: 'idle', ticks: null, haulingPhase: null, task: null });
  });

  // #1138 plan-vs-implementation contradiction, pinned rather than guessed:
  // the plan's acceptance criteria claims "an unmounted debris_hauler
  // mid-reservation → hauling, not idle", i.e. that the hauling check runs
  // independent of an occupant-undefined guard. The shipped implementation
  // does not do this — `if (occupant === undefined) return IDLE;` sits
  // *before* the hauling branch, so a debris_hauler with an active
  // reservation and nobody aboard reads 'idle', not 'hauling'. This test
  // pins the actual (idle) behaviour; see this run's report for the flag.
  it('an unreserved-occupant debris_hauler with an active reservation but no occupant reads idle, not hauling (plan/impl mismatch — see comment above)', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 1);
    expect(computeVehicleStatus(vehicle, vs).kind).toBe('idle');
  });
});

describe('computeVehicleStatus — occupant-derived stuck/waiting', () => {
  it("reports stuck using the occupant's moveConsecutiveFailures as ticks", () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ isMoveStuck: true, moveConsecutiveFailures: 14 });
    const status = computeVehicleStatus(v, vs, occupant);
    expect(status.kind).toBe('stuck');
    expect(status.ticks).toBe(14);
  });

  it("reports waiting using the occupant's vehicleWaitingTicks as ticks, when not stuck", () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ isMoveStuck: false, vehicleWaitingTicks: 5 });
    const status = computeVehicleStatus(v, vs, occupant);
    expect(status.kind).toBe('waiting');
    expect(status.ticks).toBe(5);
  });

  it('stuck takes priority over waiting when both are set', () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ isMoveStuck: true, moveConsecutiveFailures: 9, vehicleWaitingTicks: 3 });
    const status = computeVehicleStatus(v, vs, occupant);
    expect(status.kind).toBe('stuck');
    expect(status.ticks).toBe(9);
  });

  it('vehicleWaitingTicks === 0 does not report waiting', () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ isMoveStuck: false, vehicleWaitingTicks: 0, taskTicksRemaining: null, itinerary: null });
    expect(computeVehicleStatus(v, vs, occupant).kind).toBe('idle');
  });
});

describe('computeVehicleStatus — hauling (debris_hauler + active reservation)', () => {
  it('reports hauling with phase to_fragment when payload is null (not yet loaded)', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 1);
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: null });
    const status = computeVehicleStatus(vehicle, vs, occupant);
    expect(status.kind).toBe('hauling');
    expect(status.haulingPhase).toBe('to_fragment');
  });

  it('reports hauling with phase to_depot when payload is set (already loaded)', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    vehicle.payload = { fragmentId: 1, massKg: 100 };
    reserveVehicle(vs, vehicle.id, 1);
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: null });
    const status = computeVehicleStatus(vehicle, vs, occupant);
    expect(status.kind).toBe('hauling');
    expect(status.haulingPhase).toBe('to_depot');
  });

  it('a non-debris_hauler role with an active reservation is not "hauling"', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    reserveVehicle(vs, vehicle.id, 1);
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: null });
    expect(computeVehicleStatus(vehicle, vs, occupant).kind).not.toBe('hauling');
  });

  it('a debris_hauler occupant with no active reservation is not "hauling"', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: null });
    expect(computeVehicleStatus(vehicle, vs, occupant).kind).not.toBe('hauling');
  });

  it('stuck still wins over a reserved hauler with a driver aboard', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 1);
    const occupant = makeOccupant({ isMoveStuck: true, moveConsecutiveFailures: 4 });
    expect(computeVehicleStatus(vehicle, vs, occupant).kind).toBe('stuck');
  });
});

describe('computeVehicleStatus — occupant-derived working/moving', () => {
  it("reports working off the occupant's own task timer, with task = the role's arrival task", () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'drill_rig');
    const occupant = makeOccupant({ taskTicksRemaining: 4, itinerary: null });

    const status = computeVehicleStatus(vehicle, vs, occupant);

    expect(status.kind).toBe('working');
    expect(status.task).toBe(VEHICLE_ROLE_ARRIVAL_TASK['drill_rig']);
  });

  it("reports moving off the occupant's itinerary when no task timer is running", () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: makeItinerary() });

    expect(computeVehicleStatus(v, vs, occupant).kind).toBe('moving');
  });

  it('reports idle for an occupant doing nothing (no task timer, no itinerary)', () => {
    const vs = createVehicleState();
    const v = makeVehicle();
    const occupant = makeOccupant({ taskTicksRemaining: null, itinerary: null });

    expect(computeVehicleStatus(v, vs, occupant)).toEqual({ kind: 'idle', ticks: null, haulingPhase: null, task: null });
  });

  it('prefers a running task timer over an itinerary when the occupant carries both', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    const occupant = makeOccupant({ taskTicksRemaining: 2, itinerary: makeItinerary() });

    const status = computeVehicleStatus(vehicle, vs, occupant);

    expect(status.kind).toBe('working');
    expect(status.task).toBe(VEHICLE_ROLE_ARRIVAL_TASK['debris_hauler']);
  });
});
