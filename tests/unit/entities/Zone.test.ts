import { describe, it, expect } from 'vitest';
import {
  clearZone,
  isZoneClear,
  isInZone,
  computeDangerZone,
  type ZoneBounds,
  type SafeDestinationFinder,
} from '../../../src/core/entities/Zone.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { createDamageState, processProjections } from '../../../src/core/entities/Damage.js';
import { createBuildingState } from '../../../src/core/entities/Building.js';
import { Random } from '../../../src/core/math/Random.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

const zone: ZoneBounds = { x1: 10, z1: 10, x2: 30, z2: 30 };

/**
 * Always finds a safe cell 5m past the zone's max-x edge — a stand-in for
 * findSafeEvacuationCell (Evacuation.ts), which clearZone takes injected so
 * this file can drive the low-level move in isolation from real pathfinding.
 */
const findSafeDestination: SafeDestinationFinder = (_fromX, fromZ, z) => ({ x: z.x2 + 5, z: fromZ });

/** Never finds anywhere safe — every entity in the zone is stranded. */
const noSafeDestination: SafeDestinationFinder = () => null;

function makeProjection(overrides: Partial<FragmentData> = {}): FragmentData {
  return {
    id: 1, position: { x: 15, y: 0, z: 15 }, volume: 4, mass: 10,
    rockId: 'sandite', oreDensities: {},
    initialVelocity: { x: 30, y: 0, z: 0 }, // KE = 0.5*10*900 = 4500J → death
    isProjection: true,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    ...overrides,
  };
}

describe('Zone clearing and evacuation', () => {
  it('clearZone routes entities inside the zone to a destination instead of teleporting them', () => {
    const vehicles = createVehicleState();
    const { vehicle } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const employees = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);
    hireEmployee(employees, 'driller', rng, 5, 5); // outside the zone — untouched

    const beforeVehicleX = vehicle.x;
    const beforeVehicleZ = vehicle.z;
    const beforeEmployeeX = employee.x;
    const beforeEmployeeZ = employee.z;

    const result = clearZone(zone, vehicles, employees, findSafeDestination);

    // Not teleported: current position is unchanged by this same call.
    expect(vehicle.x).toBe(beforeVehicleX);
    expect(vehicle.z).toBe(beforeVehicleZ);
    expect(employee.x).toBe(beforeEmployeeX);
    expect(employee.z).toBe(beforeEmployeeZ);

    // Ordered to walk out instead — a destination was set.
    expect(vehicle.task).toBe('moving');
    expect(vehicle.targetX).toBeGreaterThan(zone.x2);
    expect(employee.destinationX).not.toBeNull();
    expect(employee.destinationX).toBeGreaterThan(zone.x2);
    expect(employee.destinationZ).not.toBeNull();

    expect(result.orderedVehicleIds).toContain(vehicle.id);
    expect(result.orderedEmployeeIds).toContain(employee.id);
    expect(result.strandedVehicleIds).toEqual([]);
    expect(result.strandedEmployeeIds).toEqual([]);
  });

  it('does not order an entity that is already outside the zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(2);
    const { employee } = hireEmployee(employees, 'driller', rng, 5, 5);

    const result = clearZone(zone, vehicles, employees, findSafeDestination);

    expect(result.orderedEmployeeIds).not.toContain(employee.id);
    expect(employee.destinationX).toBeNull();
  });

  it('isZoneClear stays false immediately after clearZone — the walk has not happened yet', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(3);
    hireEmployee(employees, 'driller', rng, 20, 20);

    expect(isZoneClear(zone, vehicles, employees)).toBe(false);
    clearZone(zone, vehicles, employees, findSafeDestination);
    // A destination was set, but the entity's actual position has not moved.
    expect(isZoneClear(zone, vehicles, employees)).toBe(false);
  });

  it('isZoneClear becomes true only once an ordered entity has actually arrived outside the zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(4);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);

    clearZone(zone, vehicles, employees, findSafeDestination);
    expect(isZoneClear(zone, vehicles, employees)).toBe(false);

    // Simulate movement resolving the walk: position catches up to destination.
    employee.x = employee.destinationX!;
    employee.z = employee.destinationZ!;
    expect(isZoneClear(zone, vehicles, employees)).toBe(true);
  });

  it('an entity for which no safe destination can be found is stranded, not teleported', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(5);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);
    const beforeX = employee.x;
    const beforeZ = employee.z;

    const result = clearZone(zone, vehicles, employees, noSafeDestination);

    expect(employee.x).toBe(beforeX);
    expect(employee.z).toBe(beforeZ);
    expect(employee.destinationX).toBeNull();
    expect(result.strandedEmployeeIds).toContain(employee.id);
    expect(result.orderedEmployeeIds).not.toContain(employee.id);
  });

  it('a stranded vehicle is reported and left exactly where it stands', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const { vehicle } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const beforeX = vehicle.x;
    const beforeZ = vehicle.z;

    const result = clearZone(zone, vehicles, employees, noSafeDestination);

    expect(vehicle.x).toBe(beforeX);
    expect(vehicle.z).toBe(beforeZ);
    expect(vehicle.task).not.toBe('moving');
    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(result.orderedVehicleIds).not.toContain(vehicle.id);
  });

  it('the zone is still reported occupied while a stranded entity remains inside it', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(6);
    hireEmployee(employees, 'driller', rng, 20, 20);

    clearZone(zone, vehicles, employees, noSafeDestination);
    expect(isZoneClear(zone, vehicles, employees)).toBe(false);
  });

  it('blasting without clearing zone + projections → casualties', () => {
    const employees = createEmployeeState();
    const rng = new Random(8);
    hireEmployee(employees, 'driller', rng, 15, 15); // in blast zone, never evacuated

    const damage = createDamageState();
    const accidents = processProjections(
      [makeProjection()], createBuildingState(), createVehicleState(), employees, damage, 1,
    );

    expect(accidents.length).toBeGreaterThan(0);
    expect(employees.employees[0]!.alive).toBe(false);
  });

  it('blasting after the zone genuinely clears (walk completed) → no casualties despite projections landing there', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(9);
    const { employee } = hireEmployee(employees, 'driller', rng, 15, 15);

    clearZone(zone, vehicles, employees, findSafeDestination);
    // Resolve the walk before the blast fires — this is what the tutorial's
    // evacuate-zone step and blastCommand's refusal are meant to enforce.
    employee.x = employee.destinationX!;
    employee.z = employee.destinationZ!;
    expect(isZoneClear(zone, vehicles, employees)).toBe(true);

    const projection = makeProjection({ position: { x: 20, y: 0, z: 20 } });

    const damage = createDamageState();
    const accidents = processProjections(
      [projection], createBuildingState(), vehicles, employees, damage, 1,
    );

    const casualties = accidents.filter(a => a.type === 'death' || a.type === 'injury');
    expect(casualties.length).toBe(0);
  });
});

describe('computeDangerZone', () => {
  it('returns null for an empty hole list — nothing to bound', () => {
    expect(computeDangerZone([], 15)).toBeNull();
  });

  it('pads a single hole\'s position by the margin on every side', () => {
    expect(computeDangerZone([{ x: 20, z: 20 }], 15)).toEqual({ x1: 5, z1: 5, x2: 35, z2: 35 });
  });

  it('bounds multiple holes by their min/max, then pads', () => {
    const holes = [{ x: 10, z: 10 }, { x: 25, z: 12 }, { x: 15, z: 30 }];
    expect(computeDangerZone(holes, 5)).toEqual({ x1: 5, z1: 5, x2: 30, z2: 35 });
  });

  it('the result is usable directly with isInZone', () => {
    const zone = computeDangerZone([{ x: 20, z: 20 }], 15)!;
    expect(isInZone(20, 20, zone)).toBe(true);
    expect(isInZone(4, 20, zone)).toBe(false); // just outside the padded box
  });
});
