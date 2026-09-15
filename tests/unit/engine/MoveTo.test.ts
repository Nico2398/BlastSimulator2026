// BlastSimulator2026 — Tests for moveTo (src/core/engine/MoveTo.ts, #1089
// mount/itinerary rebuild phase 3b).
//
// moveTo is the only entry point that starts movement (gameplay-vehicle-fleet
// skill, Movement API section): moveTo(state, employeeId, {x,z}, {via?}) to
// walk to a coordinate, optionally via a named vehicle, and
// moveTo(state, employeeId, {vehicleId}) to walk to a vehicle in order to
// board it. Both forms install an Itinerary on the employee for
// tickLocomotion to walk — this file asserts the itinerary SHAPE moveTo
// produces, not the tick-by-tick walk (that's Locomotion.test.ts).
//
// MoveTo.ts is a stub that throws 'not implemented' at this phase — every
// test below is expected to fail for that reason, not from a fixture bug.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';

const SEED = 42;

describe('moveTo — coordinate destination', () => {
  it('moveTo(x, z) produces an itinerary whose last leg ends at (x, z)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    const result = moveTo(state, employee.id, { x: 12, z: 7 });

    expect(result.success).toBe(true);
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.destX).toBe(12);
    expect(lastLeg.destZ).toBe(7);
  });

  it('does not throw when the target equals the employee\'s current position (boundary: zero-distance)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);

    expect(() => moveTo(state, employee.id, { x: 5, z: 5 })).not.toThrow();
  });

  it('returns success:false, not throwing, for a non-existent employee id (rejection/boundary)', () => {
    const state = createGame({ seed: SEED });

    expect(() => moveTo(state, 999999, { x: 1, z: 1 })).not.toThrow();
    const result = moveTo(state, 999999, { x: 1, z: 1 });
    expect(result.success).toBe(false);
  });
});

describe('moveTo — coordinate destination via a named vehicle', () => {
  it('when NOT already mounted in that vehicle, produces a foot leg to the vehicle (arrival boards it) FOLLOWED by a drive leg to (x, z)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 20, 20);

    const result = moveTo(state, employee.id, { x: 30, z: 30 }, { via: vehicle.id });

    expect(result.success).toBe(true);
    const legs = employee.itinerary!.legs;
    expect(legs).toHaveLength(2);
    expect(legs[0]!.mode).toBe('foot');
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    expect(legs[1]!.mode).toBe('drive');
    expect(legs[1]!.destX).toBe(30);
    expect(legs[1]!.destZ).toBe(30);
  });

  it('when ALREADY mounted in that vehicle, drops the foot leg (continuity) — the itinerary starts directly with the drive leg', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 20, 20);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 20, 20);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const result = moveTo(state, employee.id, { x: 30, z: 30 }, { via: vehicle.id });

    expect(result.success).toBe(true);
    const legs = employee.itinerary!.legs;
    expect(legs[0]!.mode).toBe('drive');
    expect(legs.some(l => l.mode === 'foot')).toBe(false);
    expect(legs[legs.length - 1]!.destX).toBe(30);
    expect(legs[legs.length - 1]!.destZ).toBe(30);
  });

  it('returns success:false, not throwing, when the named vehicle is already occupied by another employee (rejection)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: occupant } = hireEmployee(state.employees, 'driller', rng, 8, 8);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 8, 8);
    vehicle.occupantIds = [occupant.id];
    vehicle.driverId = occupant.id;
    occupant.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const rng2 = new Random(SEED + 1);
    const { employee: other } = hireEmployee(state.employees, 'driller', rng2, 0, 0);
    assignSkill(state.employees, other.id, 'driving.excavator', 1);

    expect(() => moveTo(state, other.id, { x: 30, z: 30 }, { via: vehicle.id })).not.toThrow();
    const result = moveTo(state, other.id, { x: 30, z: 30 }, { via: vehicle.id });
    expect(result.success).toBe(false);
  });
});

describe('moveTo — board a vehicle', () => {
  it('moveTo({vehicleId}) produces exactly one foot leg whose arrival step boards the vehicle, no drive leg', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 8, 8);

    const result = moveTo(state, employee.id, { vehicleId: vehicle.id });

    expect(result.success).toBe(true);
    const legs = employee.itinerary!.legs;
    expect(legs).toHaveLength(1);
    expect(legs[0]!.mode).toBe('foot');
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
  });

  it('returns success:false, not throwing, when the named vehicle is already fully occupied (seat capacity exceeded)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: occupant } = hireEmployee(state.employees, 'driller', rng, 8, 8);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 8, 8);
    vehicle.occupantIds = [occupant.id];
    vehicle.driverId = occupant.id;
    occupant.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const rng2 = new Random(SEED + 1);
    const { employee: other } = hireEmployee(state.employees, 'driller', rng2, 0, 0);
    assignSkill(state.employees, other.id, 'driving.drill_rig', 1);

    expect(() => moveTo(state, other.id, { vehicleId: vehicle.id })).not.toThrow();
    const result = moveTo(state, other.id, { vehicleId: vehicle.id });
    expect(result.success).toBe(false);
  });

  it('returns success:false, not throwing, for a non-existent vehicle id (boundary)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    expect(() => moveTo(state, employee.id, { vehicleId: 999999 })).not.toThrow();
    const result = moveTo(state, employee.id, { vehicleId: 999999 });
    expect(result.success).toBe(false);
  });
});
