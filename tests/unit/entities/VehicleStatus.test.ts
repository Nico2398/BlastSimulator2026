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
    cargo: [],
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
    vehicle.cargo = [{ fragmentId: 1, massKg: 100 }];
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

// ── #1761: computeVehicleJob / vehicleEtaTicks ──

import { computeVehicleJob, vehicleEtaTicks } from '../../../src/core/entities/VehicleStatus.js';
import type { PendingAction, ActionType } from '../../../src/core/state/GameState.js';
import { getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';

function makeAction(id: number, type: ActionType, payload: Record<string, unknown>, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0, payload, targetEmployeeId: null,
    status: 'assigned', holderId: null, queuedAtTick: 0,
    ...overrides,
  };
}

function driveItinerary(destX: number, destZ: number, extra: Partial<Itinerary> = {}): Itinerary {
  return {
    legs: [{ mode: 'drive', vehicleId: 1, destX, destZ, arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 100 }],
    goal: { kind: 'work', actionId: 10 },
    workTicks: 0,
    estTotalTicks: 100,
    ...extra,
  };
}

describe('vehicleEtaTicks', () => {
  const speed = getVehicleDefByTier('debris_hauler', 1).speed;

  it('is the remaining distance over the tier speed for a single drive leg', () => {
    const v = makeVehicle({ x: 0, z: 0 });
    const eta = vehicleEtaTicks(v, driveItinerary(300, 0));
    expect(eta).toBeGreaterThanOrEqual(Math.floor(300 / speed));
    expect(eta).toBeLessThanOrEqual(Math.ceil(300 / speed) + 1);
  });

  it('strictly decreases as the vehicle nears the leg destination', () => {
    const it = driveItinerary(300, 0);
    const far = vehicleEtaTicks(makeVehicle({ x: 0, z: 0 }), it);
    const mid = vehicleEtaTicks(makeVehicle({ x: 90, z: 0 }), it);
    const near = vehicleEtaTicks(makeVehicle({ x: 210, z: 0 }), it);
    expect(far).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(near);
  });

  it('is at most the work ticks once the vehicle sits on the destination', () => {
    const it = driveItinerary(40, 40, { workTicks: 5 });
    const arrived = vehicleEtaTicks(makeVehicle({ x: 40, z: 40 }), it);
    expect(arrived).toBeLessThanOrEqual(5);
    expect(arrived).toBeGreaterThanOrEqual(0);
  });

  it('adds the ticks of the legs that follow the current one', () => {
    const single = driveItinerary(300, 0);
    const twoLegs: Itinerary = {
      ...single,
      legs: [...single.legs, { mode: 'drive', vehicleId: 1, destX: 300, destZ: 60, arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 20 }],
    };
    const v = makeVehicle({ x: 0, z: 0 });
    expect(vehicleEtaTicks(v, twoLegs)).toBeGreaterThan(vehicleEtaTicks(v, single));
  });

  it('is never negative', () => {
    const v = makeVehicle({ x: 500, z: 500 });
    expect(vehicleEtaTicks(v, driveItinerary(500, 500))).toBeGreaterThanOrEqual(0);
  });
});

describe('computeVehicleJob', () => {
  function haulState(vehicle: Vehicle, action: PendingAction) {
    const vs = createVehicleState();
    vs.vehicles.push(vehicle);
    reserveVehicle(vs, vehicle.id, action.id);
    return vs;
  }

  it('is empty for an idle vehicle with no occupant and nothing pending', () => {
    const vs = createVehicleState();
    const job = computeVehicleJob(makeVehicle(), vs, []);
    expect(job).toEqual({ actionType: null, target: null, destination: null, etaTicks: null, blockedReason: null });
  });

  it('is empty for a broken vehicle', () => {
    const v = makeVehicle({ hp: 0 });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const vs = haulState(v, action);
    const job = computeVehicleJob(v, vs, [action], makeOccupant({ itinerary: driveItinerary(30, 0) }));
    expect(job.actionType).toBeNull();
    expect(job.target).toBeNull();
    expect(job.destination).toBeNull();
    expect(job.etaTicks).toBeNull();
  });

  it('an empty hauler heads for its fragment: fragment target, no building at the destination', () => {
    const v = makeVehicle({ x: 0, z: 0, cargo: [] });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const vs = haulState(v, action);
    const occupant = makeOccupant({ itinerary: driveItinerary(30, 12) });
    const job = computeVehicleJob(v, vs, [action], occupant);
    expect(job.actionType).toBe('haul_debris');
    expect(job.target).toEqual({ kind: 'fragment', id: 5 });
    expect(job.destination).toEqual({ x: 30, z: 12, buildingId: null });
    expect(job.etaTicks).toBeGreaterThan(0);
    expect(job.blockedReason).toBeNull();
  });

  it('a loaded hauler heads for the reserved warehouse, named by buildingId', () => {
    const v = makeVehicle({ x: 0, z: 0, cargo: [{ fragmentId: 5, massKg: 800 }] });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const vs = haulState(v, action);
    const occupant = makeOccupant({ itinerary: driveItinerary(60, 4) });
    const job = computeVehicleJob(v, vs, [action], occupant, 7);
    expect(job.destination).toEqual({ x: 60, z: 4, buildingId: 7 });
    expect(job.etaTicks).toBeGreaterThan(0);
  });

  it('hauler ETA counts down as the vehicle drives toward the destination', () => {
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const itinerary = driveItinerary(300, 0);
    const etaAt = (x: number) => {
      const v = makeVehicle({ x, cargo: [{ fragmentId: 5, massKg: 800 }] });
      return computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ itinerary }), 7).etaTicks!;
    };
    expect(etaAt(0)).toBeGreaterThan(etaAt(90));
    expect(etaAt(90)).toBeGreaterThan(etaAt(210));
  });

  it('has no destination and no ETA without an itinerary', () => {
    const v = makeVehicle({ cargo: [{ fragmentId: 5, massKg: 800 }] });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const job = computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ itinerary: null }), 7);
    expect(job.destination).toBeNull();
    expect(job.etaTicks).toBeNull();
  });

  it('a fragmenter on a fragment_debris order targets that fragment', () => {
    const v = makeVehicle({ id: 2, type: 'rock_fragmenter' });
    const action = makeAction(11, 'fragment_debris', { fragmentId: 9 });
    const job = computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ taskTicksRemaining: 4 }));
    expect(job.actionType).toBe('fragment_debris');
    expect(job.target).toEqual({ kind: 'fragment', id: 9 });
  });

  it('a working drill rig targets its hole and reports the task ticks left as ETA', () => {
    const v = makeVehicle({ id: 3, type: 'drill_rig' });
    const action = makeAction(12, 'drill_hole', { holeId: 'h-3' });
    const job = computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ taskTicksRemaining: 14, itinerary: null }));
    expect(job.actionType).toBe('drill_hole');
    expect(job.target).toEqual({ kind: 'hole', id: 'h-3' });
    expect(job.etaTicks).toBe(14);
  });

  it('a charging truck targets the hole of its charge order', () => {
    const v = makeVehicle({ id: 4, type: 'charging_truck' });
    const action = makeAction(13, 'charge_hole', { holeId: 'h-8' });
    const job = computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ taskTicksRemaining: 3 }));
    expect(job.target).toEqual({ kind: 'hole', id: 'h-8' });
  });

  it('a building destroyer targets the building it demolishes', () => {
    const v = makeVehicle({ id: 5, type: 'building_destroyer' });
    const action = makeAction(14, 'demolish_building', { buildingId: 21 });
    const job = computeVehicleJob(v, haulState(v, action), [action], makeOccupant({ taskTicksRemaining: 3 }));
    expect(job.actionType).toBe('demolish_building');
    expect(job.target).toEqual({ kind: 'building', id: 21 });
  });

  it('a stuck vehicle keeps its job target', () => {
    const v = makeVehicle({ cargo: [] });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const occupant = makeOccupant({ isMoveStuck: true, moveConsecutiveFailures: 6, itinerary: driveItinerary(30, 0) });
    const job = computeVehicleJob(v, haulState(v, action), [action], occupant);
    expect(job.target).toEqual({ kind: 'fragment', id: 5 });
  });

  it('a waiting vehicle keeps its job target and carries no blocked reason', () => {
    const v = makeVehicle({ cargo: [] });
    const action = makeAction(10, 'haul_debris', { fragmentId: 5 });
    const occupant = makeOccupant({ vehicleWaitingTicks: 3, itinerary: driveItinerary(30, 0) });
    const job = computeVehicleJob(v, haulState(v, action), [action], occupant);
    expect(job.target).toEqual({ kind: 'fragment', id: 5 });
    expect(job.blockedReason).toBeNull();
  });

  it('a moving vehicle with a reposition goal has a destination and ETA but no action or target', () => {
    const v = makeVehicle({ x: 0, z: 0 });
    const vs = createVehicleState();
    const occupant = makeOccupant({ itinerary: makeItinerary() });
    const job = computeVehicleJob(v, vs, [], occupant);
    expect(job.actionType).toBeNull();
    expect(job.target).toBeNull();
    expect(job.destination).toEqual({ x: 9, z: 9, buildingId: null });
    expect(job.etaTicks).toBeGreaterThan(0);
  });

  it('an idle hauler reports the reason when a queued haul order for its role is blocked', () => {
    const v = makeVehicle();
    const blocked = makeAction(15, 'haul_debris', { fragmentId: 5 }, {
      status: 'queued', requiredVehicleRole: 'debris_hauler', blockedReason: 'no_licensed_driver',
    });
    const job = computeVehicleJob(v, createVehicleState(), [blocked]);
    expect(job.blockedReason).toBe('no_licensed_driver');
  });

  it('ignores a blocked order that needs a different vehicle role', () => {
    const v = makeVehicle();
    const blocked = makeAction(15, 'drill_hole', { holeId: 'h' }, {
      status: 'queued', requiredVehicleRole: 'drill_rig', blockedReason: 'no_vehicle_in_fleet',
    });
    expect(computeVehicleJob(v, createVehicleState(), [blocked]).blockedReason).toBeNull();
  });

  it('reports no blocked reason when no pending order is blocked', () => {
    const queued = makeAction(15, 'haul_debris', { fragmentId: 5 }, { status: 'queued', requiredVehicleRole: 'debris_hauler' });
    expect(computeVehicleJob(makeVehicle(), createVehicleState(), [queued]).blockedReason).toBeNull();
  });
});
