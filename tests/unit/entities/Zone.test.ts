import { describe, it, expect } from 'vitest';
import {
  clearZone,
  isZoneClear,
  isInZone,
  computeDangerZone,
  countZoneOccupants,
  isDangerZoneClear,
  type ZoneBounds,
  type SafeDestinationFinder,
} from '../../../src/core/entities/Zone.js';
import { createVehicleState, purchaseVehicle, resolveVehicleDriver } from '../../../src/core/entities/Vehicle.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee, killEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { createDamageState, processProjections } from '../../../src/core/entities/Damage.js';
import { createBuildingState } from '../../../src/core/entities/Building.js';
import { Random } from '../../../src/core/math/Random.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';

/**
 * #1089: clearZone now takes the owning GameState too (moveTo needs it to
 * plan an itinerary) — a real, empty game rather than the bare
 * createVehicleState()/createEmployeeState() pair this file used pre-#1089,
 * whose .vehicles/.employees are handed straight through unchanged.
 */
function makeState(seed: number): GameState {
  return createGame({ seed });
}

/**
 * Mounts `driver` in `vehicle` directly (occupantIds + locomotion), the
 * shape moveTo's own "already mounted" continuity check
 * (isMounted(employee.locomotion)) requires to plan straight to a drive leg
 * — mirrors what a real board() call leaves behind, without walking there
 * first. `occupantIds[0]` is the driver seat clearZone reads through
 * `vehicleDriverId` (#1092), so filling it is what makes this a driven
 * vehicle as far as the evacuation is concerned.
 */
function mountDriver(vehicle: Vehicle, driver: Employee): void {
  vehicle.occupantIds = [driver.id];
  driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
}

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
    const state = makeState(1);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const rng = new Random(1);
    // A real, mounted driver — this test proves the "ordered" path, not the
    // #947 driver gate (a dangling driverId, the old model's moveVehicle
    // didn't care who held it, no longer works: moveTo needs a real
    // employee to attach an itinerary to, #1089).
    const { employee: driver } = hireEmployee(employees, 'driller', rng, vehicle.x, vehicle.z);
    mountDriver(vehicle, driver);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);
    hireEmployee(employees, 'driller', rng, 5, 5); // outside the zone — untouched

    const beforeVehicleX = vehicle.x;
    const beforeVehicleZ = vehicle.z;
    const beforeEmployeeX = employee.x;
    const beforeEmployeeZ = employee.z;

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    // Not teleported: current position is unchanged by this same call.
    expect(vehicle.x).toBe(beforeVehicleX);
    expect(vehicle.z).toBe(beforeVehicleZ);
    expect(employee.x).toBe(beforeEmployeeX);
    expect(employee.z).toBe(beforeEmployeeZ);

    // Ordered to walk out instead — a destination was set.
    expect(employee.destinationX).not.toBeNull();
    expect(employee.destinationX).toBeGreaterThan(zone.x2);
    expect(employee.destinationZ).not.toBeNull();

    // #1089/#1138: the drive leg (and the vehicle's derived "moving" status)
    // are written by tickLocomotion's own drive-leg advance, not
    // synchronously at plan time — one real tick is what actually starts the
    // drive. Vehicle itself carries no task/targetX any more (#1138) — both
    // are read off the driving employee's own itinerary.
    tickLocomotion(state);
    const drivingEmployee = resolveVehicleDriver(vehicle, employees.employees);
    expect(drivingEmployee?.itinerary).not.toBeNull();
    expect(drivingEmployee?.itinerary?.legs[0]?.destX).toBeGreaterThan(zone.x2);

    expect(result.orderedVehicleIds).toContain(vehicle.id);
    expect(result.orderedEmployeeIds).toContain(employee.id);
    expect(result.strandedVehicleIds).toEqual([]);
    expect(result.strandedEmployeeIds).toEqual([]);
  });

  it('does not order an entity that is already outside the zone', () => {
    const state = makeState(2);
    const { vehicles, employees } = state;
    const rng = new Random(2);
    const { employee } = hireEmployee(employees, 'driller', rng, 5, 5);

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    expect(result.orderedEmployeeIds).not.toContain(employee.id);
    expect(employee.destinationX).toBeNull();
  });

  it('isZoneClear stays false immediately after clearZone — the walk has not happened yet', () => {
    const state = makeState(3);
    const { vehicles, employees } = state;
    const rng = new Random(3);
    hireEmployee(employees, 'driller', rng, 20, 20);

    expect(isZoneClear(zone, vehicles, employees)).toBe(false);
    clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);
    // A destination was set, but the entity's actual position has not moved.
    expect(isZoneClear(zone, vehicles, employees)).toBe(false);
  });

  it('isZoneClear becomes true only once an ordered entity has actually arrived outside the zone', () => {
    const state = makeState(4);
    const { vehicles, employees } = state;
    const rng = new Random(4);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);

    clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);
    expect(isZoneClear(zone, vehicles, employees)).toBe(false);

    // Simulate movement resolving the walk: position catches up to destination.
    employee.x = employee.destinationX!;
    employee.z = employee.destinationZ!;
    expect(isZoneClear(zone, vehicles, employees)).toBe(true);
  });

  it('an entity for which no safe destination can be found is stranded, not teleported', () => {
    const state = makeState(5);
    const { vehicles, employees } = state;
    const rng = new Random(5);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);
    const beforeX = employee.x;
    const beforeZ = employee.z;

    const result = clearZone(zone, state, vehicles, employees, noSafeDestination, () => true);

    expect(employee.x).toBe(beforeX);
    expect(employee.z).toBe(beforeZ);
    expect(employee.destinationX).toBeNull();
    expect(result.strandedEmployeeIds).toContain(employee.id);
    expect(result.orderedEmployeeIds).not.toContain(employee.id);
  });

  it('a stranded vehicle is reported and left exactly where it stands', () => {
    const state = makeState(10);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const beforeX = vehicle.x;
    const beforeZ = vehicle.z;

    const result = clearZone(zone, state, vehicles, employees, noSafeDestination, () => true);

    expect(vehicle.x).toBe(beforeX);
    expect(vehicle.z).toBe(beforeZ);
    expect(resolveVehicleDriver(vehicle, employees.employees)).toBeUndefined();
    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(result.orderedVehicleIds).not.toContain(vehicle.id);
  });

  it('a driverless vehicle in the zone is stranded, not ordered, even when a safe destination is available (#947)', () => {
    const state = makeState(11);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    // no driver aboard (occupantIds defaults to []) — must strand even though findSafeDestination succeeds
    const beforeX = vehicle.x;
    const beforeZ = vehicle.z;

    // findSafeDestination here (unlike noSafeDestination) DOES find somewhere
    // safe — the driverless check must short-circuit before the destination
    // lookup ever runs, not merely happen to agree with a "no destination"
    // outcome.
    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(result.orderedVehicleIds).not.toContain(vehicle.id);
    // moveVehicle never effectively applied — position genuinely unchanged.
    expect(vehicle.x).toBe(beforeX);
    expect(vehicle.z).toBe(beforeZ);
    expect(resolveVehicleDriver(vehicle, employees.employees)).toBeUndefined();
  });

  it('a mixed zone orders the driver-equipped vehicle out while stranding the driverless one, in the same clearZone call (#947)', () => {
    const state = makeState(12);
    const { vehicles, employees } = state;
    const rng = new Random(12);
    const { vehicle: driven } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const { employee: driver } = hireEmployee(employees, 'driller', rng, driven.x, driven.z);
    mountDriver(driven, driver); // driver aboard
    const { vehicle: driverless } = purchaseVehicle(vehicles, 'rock_digger', 20, 20);
    // driverless — occupantIds defaults to [] on purchase

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);
    tickLocomotion(state);

    expect(result.orderedVehicleIds).toContain(driven.id);
    expect(result.orderedVehicleIds).not.toContain(driverless.id);
    const drivenDriver = resolveVehicleDriver(driven, employees.employees);
    expect(drivenDriver?.itinerary).not.toBeNull();
    expect(drivenDriver?.itinerary?.legs[0]?.destX).toBeGreaterThan(zone.x2);

    expect(result.strandedVehicleIds).toContain(driverless.id);
    expect(result.strandedVehicleIds).not.toContain(driven.id);
    expect(resolveVehicleDriver(driverless, employees.employees)).toBeUndefined();
  });

  // ── #1042: a driverless vehicle with a qualified, reachable employee is
  // boarded and driven clear instead of being stranded outright.

  it('a qualified, reachable in-zone employee is assigned to board a driverless vehicle instead of the vehicle being stranded (#1042)', () => {
    const state = makeState(30);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    const rng = new Random(30);
    const { employee } = hireEmployee(employees, 'driller', rng, 16, 16);
    assignSkill(employees, employee.id, 'driving.excavator', 1);

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    expect(result.strandedVehicleIds).not.toContain(vehicle.id);
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    // #1089: moveTo({vehicleId}) walks the employee via a real itinerary leg
    // (destX/destZ), not the legacy destinationX/Z fields — those stay null
    // for a board-only itinerary.
    expect(employee.itinerary?.legs[0]?.destX).toBe(vehicle.x);
    expect(employee.itinerary?.legs[0]?.destZ).toBe(vehicle.z);
    expect(result.strandedEmployeeIds).not.toContain(employee.id);
  });

  it('strands a driverless vehicle when no qualified employee is available at all (#1042)', () => {
    const state = makeState(31);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    // No employees in the game at all — nobody to even consider boarding.

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
  });

  it('strands a driverless vehicle when every in-zone employee lacks the required licence (#1042)', () => {
    const state = makeState(32);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    const rng = new Random(31);
    // driller's starting qualification is 'blasting', not driving.excavator.
    hireEmployee(employees, 'driller', rng, 16, 16);

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
  });

  it('strands a driverless vehicle when canEmployeeReachVehicle rejects every candidate, even with a qualified employee present (#1042)', () => {
    const state = makeState(33);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    const rng = new Random(32);
    const { employee } = hireEmployee(employees, 'driller', rng, 16, 16);
    assignSkill(employees, employee.id, 'driving.excavator', 1);

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => false);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('strands a driverless vehicle when no safe destination exists, even with a qualified reachable employee — driver assignment must not happen without one (#1042)', () => {
    const state = makeState(34);
    const { vehicles, employees } = state;
    const { vehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    const rng = new Random(33);
    const { employee } = hireEmployee(employees, 'driller', rng, 16, 16);
    assignSkill(employees, employee.id, 'driving.excavator', 1);

    const result = clearZone(zone, state, vehicles, employees, noSafeDestination, () => true);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(employee.pendingDriverVehicleId).toBeNull();
  });

  it('never assigns a foot destination to an employee just assigned to board a vehicle, nor to an employee already driving another in-zone vehicle (#1042)', () => {
    const state = makeState(35);
    const { vehicles, employees } = state;
    const rng = new Random(34);

    // Vehicle A already has a driver aboard, driving itself out normally.
    const { vehicle: vehicleA } = purchaseVehicle(vehicles, 'debris_hauler', 15, 15);
    const { employee: driverA } = hireEmployee(employees, 'driver', rng, 15, 15);
    mountDriver(vehicleA, driverA);

    // Vehicle B is driverless, boardable only by a second, qualified employee.
    const { vehicle: vehicleB } = purchaseVehicle(vehicles, 'rock_digger', 16, 16);
    // driverless — occupantIds defaults to [] on purchase
    const { employee: boarder } = hireEmployee(employees, 'driller', rng, 17, 17);
    assignSkill(employees, boarder.id, 'driving.excavator', 1);

    const result = clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);

    // driverA keeps driving vehicleA out — never redirected to an on-foot walk.
    expect(driverA.destinationX).toBeNull();
    expect(driverA.destinationZ).toBeNull();
    expect(result.orderedEmployeeIds).not.toContain(driverA.id);

    // boarder is assigned to walk to and board vehicleB — never ALSO given a
    // foot-evacuation destination (findSafeDestination's own far-outside-zone
    // output, distinct from vehicleB's own in-zone position). #1089: the walk
    // itself is a real itinerary leg (destX/destZ), not the legacy
    // destinationX/Z fields — those stay null for a board-only itinerary.
    expect(boarder.pendingDriverVehicleId).toBe(vehicleB.id);
    expect(boarder.itinerary?.legs[0]?.destX).toBe(vehicleB.x);
    expect(boarder.itinerary?.legs[0]?.destZ).toBe(vehicleB.z);
    expect(result.orderedEmployeeIds).not.toContain(boarder.id);
    expect(result.strandedEmployeeIds).not.toContain(boarder.id);
  });

  it('does not reassign an employee already mid-walk to board a DIFFERENT vehicle, even when otherwise the only qualified candidate (#1042)', () => {
    const state = makeState(36);
    const { vehicles, employees } = state;
    const { vehicle: otherVehicle } = purchaseVehicle(vehicles, 'debris_hauler', 40, 40); // outside this zone
    const { vehicle: newVehicle } = purchaseVehicle(vehicles, 'rock_digger', 15, 15);
    // driverless — occupantIds defaults to [] on purchase
    const rng = new Random(35);
    const { employee } = hireEmployee(employees, 'driller', rng, 16, 16);
    assignSkill(employees, employee.id, 'driving.excavator', 1);

    // Already mid-walk, from an evacuation started before this one, to board
    // a different vehicle — this must survive this clearZone call untouched.
    employee.pendingDriverVehicleId = otherVehicle.id;
    employee.destinationX = otherVehicle.x;
    employee.destinationZ = otherVehicle.z;

    // Finds a destination only for newVehicle's own position (so the
    // driverless-vehicle branch reaches candidate search instead of
    // stranding immediately for lack of anywhere to send it), and null for
    // the employee's position (so the foot-evacuation loop below — which has
    // no reason to know about a pending board elsewhere — reports the
    // employee stranded rather than issuing a foot destination that would
    // overwrite the busy employee's in-flight walk).
    const findDestinationOnlyForVehicle: SafeDestinationFinder = (fromX, fromZ, z) =>
      fromX === newVehicle.x && fromZ === newVehicle.z ? { x: z.x2 + 5, z: fromZ } : null;

    const result = clearZone(zone, state, vehicles, employees, findDestinationOnlyForVehicle, () => true);

    // Still pointed at the original vehicle — never overwritten by either
    // the driver-candidate search or the foot-evacuation loop.
    expect(employee.pendingDriverVehicleId).toBe(otherVehicle.id);
    expect(employee.destinationX).toBe(otherVehicle.x);
    expect(employee.destinationZ).toBe(otherVehicle.z);

    // No other candidate exists (the only qualified employee is excluded by
    // the pendingDriverVehicleId guard), so the new vehicle is stranded
    // rather than silently reassigning the busy employee.
    expect(result.strandedVehicleIds).toContain(newVehicle.id);
    expect(result.orderedVehicleIds).not.toContain(newVehicle.id);
  });

  it('the zone is still reported occupied while a stranded entity remains inside it', () => {
    const state = makeState(37);
    const { vehicles, employees } = state;
    const rng = new Random(6);
    hireEmployee(employees, 'driller', rng, 20, 20);

    clearZone(zone, state, vehicles, employees, noSafeDestination, () => true);
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
    const state = makeState(38);
    const { vehicles, employees } = state;
    const rng = new Random(9);
    const { employee } = hireEmployee(employees, 'driller', rng, 15, 15);

    clearZone(zone, state, vehicles, employees, findSafeDestination, () => true);
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

describe('countZoneOccupants', () => {
  it('sums alive employees and vehicles standing inside the zone, ignoring anything outside it', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(20);
    purchaseVehicle(vehicles, 'debris_hauler', 15, 15); // inside
    purchaseVehicle(vehicles, 'debris_hauler', 5, 5);   // outside
    hireEmployee(employees, 'driller', rng, 20, 20);    // inside
    hireEmployee(employees, 'driller', rng, 40, 40);    // outside

    expect(countZoneOccupants(zone, vehicles, employees)).toBe(2);
  });

  it('returns 0 for a zone nobody is standing in (boundary)', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();

    expect(countZoneOccupants(zone, vehicles, employees)).toBe(0);
  });

  it('excludes a dead employee positioned inside the zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(21);
    const { employee } = hireEmployee(employees, 'driller', rng, 20, 20);
    killEmployee(employees, employee.id);

    expect(countZoneOccupants(zone, vehicles, employees)).toBe(0);
  });
});

describe('isDangerZoneClear', () => {
  // BLAST_DANGER_MARGIN_M = 15 -> danger zone for a hole at (20,20) is {x1:5,z1:5,x2:35,z2:35}.
  const holes = [{ x: 20, z: 20 }];

  it('is true when no drill holes exist yet, regardless of entity positions (boundary — nothing to be clear of)', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(22);
    hireEmployee(employees, 'driller', rng, 20, 20); // would be well inside a real danger zone

    expect(isDangerZoneClear([], vehicles, employees)).toBe(true);
  });

  it('is false while a living employee stands inside the drill plan\'s padded danger zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(23);
    hireEmployee(employees, 'driller', rng, 20, 20); // inside the padded [5,35] box

    expect(isDangerZoneClear(holes, vehicles, employees)).toBe(false);
  });

  it('is false while a vehicle (not just an employee) stands inside the padded danger zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    purchaseVehicle(vehicles, 'debris_hauler', 20, 20);

    expect(isDangerZoneClear(holes, vehicles, employees)).toBe(false);
  });

  it('is true once every vehicle and employee is outside the padded danger zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const rng = new Random(24);
    hireEmployee(employees, 'driller', rng, 100, 100);
    purchaseVehicle(vehicles, 'debris_hauler', 100, 100);

    expect(isDangerZoneClear(holes, vehicles, employees)).toBe(true);
  });
});
