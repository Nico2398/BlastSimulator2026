// Direct coverage for the reposition driver search (#1092). The evacuation
// half of this module (findBestEvacuationDriver) is covered alongside the rest
// of the vehicle catalogue in Vehicle.test.ts; this file pins the stricter
// "genuinely idle" filter a player-ordered reposition uses, one exclusion at a
// time, so dropping any one guard fails here rather than silently pulling an
// employee off work the player never touched.

import { describe, it, expect } from 'vitest';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { findAvailableDriverForReposition } from '../../../src/core/entities/VehicleDriverAssignment.js';
import { createEmployeeState, hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';
import { Random } from '../../../src/core/math/Random.js';

/** A driverless rock_digger at (20, 20) — requires the driving.excavator licence. */
function makeFixture(seed: number) {
  const vs = createVehicleState();
  const es = createEmployeeState();
  const { vehicle } = purchaseVehicle(vs, 'rock_digger', 20, 20);
  return { vs, es, vehicle, rng: new Random(seed) };
}

/** A licensed, idle candidate standing at (x, z). */
function addLicensedDriver(
  es: ReturnType<typeof createEmployeeState>,
  rng: Random,
  x: number,
  z: number,
): Employee {
  const { employee } = hireEmployee(es, 'driller', rng, x, z);
  assignSkill(es, employee.id, 'driving.excavator', 1);
  return employee;
}

function makeRepositionItinerary(x: number, z: number): Itinerary {
  return {
    legs: [{ mode: 'foot', vehicleId: null, destX: x, destZ: z, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4 }],
    goal: { kind: 'reposition', x, z },
    workTicks: 0,
    estTotalTicks: 4,
  };
}

describe('findAvailableDriverForReposition — eligibility', () => {
  it('returns null when the roster is empty (boundary)', () => {
    const { vs, es, vehicle } = makeFixture(200);

    expect(findAvailableDriverForReposition(vehicle, vs, es)).toBeNull();
  });

  it('picks the one licensed, idle candidate', () => {
    const { vs, es, vehicle, rng } = makeFixture(201);
    const driver = addLicensedDriver(es, rng, 21, 21);

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(driver.id);
  });

  it('returns null when the only candidate holds no licence for the role (rejection)', () => {
    const { vs, es, vehicle, rng } = makeFixture(202);
    // driller's starting qualification is 'blasting', not driving.excavator.
    hireEmployee(es, 'driller', rng, 21, 21);

    expect(findAvailableDriverForReposition(vehicle, vs, es)).toBeNull();
  });
});

// Each case puts the INELIGIBLE employee closer to the vehicle than the
// eligible one, so a dropped guard doesn't merely widen the pool — it changes
// the answer, and the assertion catches it.
describe('findAvailableDriverForReposition — a closer but ineligible candidate never wins', () => {
  function makeNearFarPair(seed: number) {
    const fixture = makeFixture(seed);
    const near = addLicensedDriver(fixture.es, fixture.rng, 21, 21);
    const far = addLicensedDriver(fixture.es, fixture.rng, 0, 0);
    return { ...fixture, near, far };
  }

  it('skips an injured employee', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(210);
    near.injured = true;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips a collapsing employee', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(211);
    near.collapsing = true;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee already working a claimed action', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(212);
    near.activeActionId = 7;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee already travelling an itinerary', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(213);
    near.itinerary = makeRepositionItinerary(5, 5);

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips a resting employee', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(214);
    near.restTicksRemaining = 12;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee whose rest is staged but not yet started', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(215);
    near.pendingRestDuration = 12;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee with a task timer still running', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(216);
    near.taskTicksRemaining = 3;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee walking somewhere on the legacy foot mover', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(217);
    near.destinationX = 40;
    near.destinationZ = 40;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips an employee already walking to a DIFFERENT vehicle', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(218);
    near.pendingDriverVehicleId = vehicle.id + 99;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('keeps an employee already walking to THIS vehicle — that claim is the same journey', () => {
    const { vs, es, vehicle, near } = makeNearFarPair(219);
    near.pendingDriverVehicleId = vehicle.id;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(near.id);
  });

  it('skips an employee already mounted in a vehicle', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(220);
    near.locomotion = { kind: 'mounted', vehicleId: vehicle.id + 99 };

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });

  it('skips a dead employee', () => {
    const { vs, es, vehicle, near, far } = makeNearFarPair(221);
    near.alive = false;

    expect(findAvailableDriverForReposition(vehicle, vs, es)?.id).toBe(far.id);
  });
});

describe('findAvailableDriverForReposition — ranking', () => {
  it('picks the nearest among several idle licensed candidates', () => {
    const { vs, es, vehicle, rng } = makeFixture(230);
    const far = addLicensedDriver(es, rng, 0, 0);
    const near = addLicensedDriver(es, rng, 22, 20);
    const mid = addLicensedDriver(es, rng, 10, 10);

    const picked = findAvailableDriverForReposition(vehicle, vs, es);

    expect(picked?.id).toBe(near.id);
    expect(picked?.id).not.toBe(mid.id);
    expect(picked?.id).not.toBe(far.id);
  });

  it('returns null when every licensed employee is busy (rejection)', () => {
    const { vs, es, vehicle, rng } = makeFixture(231);
    addLicensedDriver(es, rng, 21, 21).activeActionId = 1;
    addLicensedDriver(es, rng, 22, 22).restTicksRemaining = 5;

    expect(findAvailableDriverForReposition(vehicle, vs, es)).toBeNull();
  });
});
