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
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { board, enterBuilding } from '../../../src/core/engine/Mount.js';
import { moveTo, alightOnArrival } from '../../../src/core/engine/MoveTo.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';

const SEED = 42;

/** A directly-editable flat, fully-walkable NavGrid (mirrors the identical helper used throughout the engine test suites). */
function makeFlatNavGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Impassable vertical wall spanning every row at world x. */
function blockColumn(grid: NavGrid, x: number): void {
  for (let z = 0; z < grid.height; z++) {
    grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
}

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

// #1178 (single-mover unification): opt-in `allowUnreachable` — when the
// target is unreachable RIGHT NOW (exact reachability check fails), moveTo
// installs a retrying itinerary anyway instead of refusing, using the
// octile-heuristic distance for the leg's estTicks since an exact path can't
// be computed yet. That itinerary retries every tick through Locomotion.ts's
// ordinary stuck/abandon machinery (Locomotion.test.ts covers the retry
// itself in depth) — this file only asserts the SHAPE moveTo installs.
describe('moveTo — allowUnreachable (#1178)', () => {
  it('to a genuinely unreachable target (walled off on a built NavGrid), allowUnreachable:true still returns success:true and installs an itinerary whose final leg targets it', () => {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(20, 5);
    blockColumn(grid, 10);
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);

    const result = moveTo(state, employee.id, { x: 15, z: 2 }, { allowUnreachable: true });

    expect(result.success).toBe(true);
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.destX).toBe(15);
    expect(lastLeg.destZ).toBe(2);
    // destinationX/Z mirror the installed itinerary's current leg.
    expect(employee.destinationX).toBe(legs[0]!.destX);
    expect(employee.destinationZ).toBe(legs[0]!.destZ);
  });

  it('the SAME call WITHOUT allowUnreachable (default false) still returns success:false for the identical unreachable target — the flag is genuinely opt-in', () => {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(20, 5);
    blockColumn(grid, 10);
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);

    const result = moveTo(state, employee.id, { x: 15, z: 2 });

    expect(result.success).toBe(false);
    expect(employee.itinerary).toBeNull();
  });

  it('a mounted employee calling moveTo(allowUnreachable) to an unreachable target installs a retrying DRIVE leg (continuity), not a foot leg', () => {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(20, 5);
    blockColumn(grid, 10);
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const result = moveTo(state, employee.id, { x: 15, z: 2 }, { allowUnreachable: true });

    expect(result.success).toBe(true);
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    // Mount continuity: already mounted in `vehicle` -> straight to a drive
    // leg, no board/foot leg prefix at all (mirrors moveTo's own already-
    // mounted continuity for a reachable target).
    expect(legs.every(l => l.mode === 'drive')).toBe(true);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.vehicleId).toBe(vehicle.id);
    expect(lastLeg.destX).toBe(15);
    expect(lastLeg.destZ).toBe(2);
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

// ── alightOnArrival (#1092) ──────────────────────────────────────────────────
// Turns an itinerary already installed on an employee into one that ends with
// them stepping off the vehicle. It is what makes an evacuation drive
// (Zone.ts's clearZone) put its driver back on foot the moment the vehicle is
// clear, replacing the `pendingEvacuationDestination` marker and the separate
// arrived-driver sweep that used to dismount off it.

describe('alightOnArrival', () => {
  it('turns the final leg\'s no-op arrival step into an alight', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);

    expect(moveTo(state, employee.id, { x: 6, z: 6 }, { via: vehicle.id }).success).toBe(true);
    const legs = employee.itinerary!.legs;
    expect(legs[legs.length - 1]!.onArrive).toEqual({ kind: 'none' });

    alightOnArrival(employee);

    expect(legs[legs.length - 1]!.onArrive).toEqual({ kind: 'alight' });
  });

  it('leaves every earlier leg untouched — only the last one gains the alight', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);

    expect(moveTo(state, employee.id, { x: 9, z: 9 }, { via: vehicle.id }).success).toBe(true);
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(1);
    // The walk-to-vehicle leg's own board step is what the journey exists for.
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });

    alightOnArrival(employee);

    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    expect(legs[legs.length - 1]!.onArrive).toEqual({ kind: 'alight' });
  });

  it('never overwrites an arrival step the journey already exists for (boundary)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);

    // A board-only itinerary: its single leg's arrival step IS the board.
    expect(moveTo(state, employee.id, { vehicleId: vehicle.id }).success).toBe(true);
    const legs = employee.itinerary!.legs;
    const last = legs[legs.length - 1]!;
    expect(last.onArrive.kind).toBe('board');

    alightOnArrival(employee);

    expect(last.onArrive.kind).toBe('board');
  });

  it('is a no-op for an employee with no itinerary at all, and for undefined (rejection)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    expect(employee.itinerary).toBeNull();

    expect(() => alightOnArrival(employee)).not.toThrow();
    expect(() => alightOnArrival(undefined)).not.toThrow();
    expect(employee.itinerary).toBeNull();
  });
});

describe('moveTo — into a building (#1202)', () => {
  /** A tier-1 driving_center at (10, 10) — 2x2 footprint, blocked on the NavGrid like buildNavGrid would. */
  function setupSchool() {
    const state = createGame({ seed: SEED });
    const school = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64).building!;
    const grid = makeFlatNavGrid(24, 24);
    for (const [x, z] of [[10, 10], [11, 10], [10, 11], [11, 11]] as const) {
      grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
    }
    state.navGrid = grid;
    return { state, school };
  }

  it('walks to a ring cell and ends with an enter_building step', () => {
    const { state, school } = setupSchool();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    expect(moveTo(state, employee.id, { buildingId: school.id }).success).toBe(true);

    const last = employee.itinerary!.legs[employee.itinerary!.legs.length - 1]!;
    expect(last.mode).toBe('foot');
    expect(last.onArrive).toEqual({ kind: 'enter_building', buildingId: school.id });
    expect({ x: last.destX, z: last.destZ }).toEqual({ x: 9, z: 9 });
  });

  it('an employee already on the ring gets a zero-length enter leg on their own cell', () => {
    const { state, school } = setupSchool();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 9, 10);

    expect(moveTo(state, employee.id, { buildingId: school.id }).success).toBe(true);

    expect(employee.itinerary!.legs).toEqual([expect.objectContaining({
      destX: 9, destZ: 10, estTicks: 0, onArrive: { kind: 'enter_building', buildingId: school.id },
    })]);
  });

  it('refuses a building that takes no people, a missing building, and a mounted employee', () => {
    const { state, school } = setupSchool();
    const warehouse = placeBuilding(state.buildings, 'freight_warehouse', 16, 16, 64, 64).building!;
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);

    expect(moveTo(state, employee.id, { buildingId: warehouse.id }).success).toBe(false);
    expect(moveTo(state, employee.id, { buildingId: 999 }).success).toBe(false);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    expect(board(state, vehicle.id, employee.id).success).toBe(true);
    expect(moveTo(state, employee.id, { buildingId: school.id }).success).toBe(false);
    expect(employee.itinerary).toBeNull();
  });

  it('any move ordered for an employee inside a building takes them out onto its ring first', () => {
    const { state, school } = setupSchool();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 9, 10);
    expect(enterBuilding(state, school.id, employee.id).success).toBe(true);

    expect(moveTo(state, employee.id, { x: 2, z: 2 }).success).toBe(true);

    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toEqual([]);
    expect({ x: employee.x, z: employee.z }).toEqual({ x: 9, z: 10 });
    expect(employee.itinerary).not.toBeNull();
  });
});
