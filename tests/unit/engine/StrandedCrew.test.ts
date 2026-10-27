// BlastSimulator2026 — Unit tests: crew cut off from the site (#2095)
//
// findStrandedCrew only reads: a driverless vehicle no licensed employee can walk to, and an
// on-foot employee outside the largest group of mutually reachable employees, are named. Nothing moves.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { findStrandedCrew } from '../../../src/core/engine/StrandedCrew.js';

const WIDTH = 24;
const HEIGHT = 12;
const WALL_X = 10;
const WEST = { x: 3, z: 5 };
const EAST = { x: 16, z: 5 };

/** Two halves split by a blocked wall at x = WALL_X, or one open floor. */
function makeState(wall = true): GameState {
  const cells: NavCell[][] = [];
  for (let z = 0; z < HEIGHT; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < WIDTH; x++) {
      const blocked = wall && x === WALL_X;
      row.push({ type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  const state = createGame({ seed: 42 });
  state.navGrid = new NavGrid(WIDTH, HEIGHT, cells);
  return state;
}

function hire(state: GameState, at: { x: number; z: number }, skill?: string, role: 'driver' | 'surveyor' = 'driver') {
  const { employee } = hireEmployee(state.employees, role, new Random(42 + state.employees.nextId), at.x, at.z);
  if (skill) assignSkill(state.employees, employee.id, skill as never, 1);
  return employee;
}

describe('findStrandedCrew (#2095)', () => {
  it('names nothing without a nav grid', () => {
    const state = createGame({ seed: 42 });
    expect(findStrandedCrew(state)).toEqual({ vehicleIds: [], employeeIds: [] });
  });

  it('names nothing when the whole crew reaches one another and every vehicle', () => {
    const state = makeState(false);
    hire(state, WEST, 'driving.truck');
    hire(state, EAST);
    purchaseVehicle(state.vehicles, 'debris_hauler', EAST.x, EAST.z);
    expect(findStrandedCrew(state)).toEqual({ vehicleIds: [], employeeIds: [] });
  });

  it('names the employee walled off from the larger group', () => {
    const state = makeState();
    hire(state, WEST);
    hire(state, { x: WEST.x + 1, z: WEST.z });
    const alone = hire(state, EAST);
    expect(findStrandedCrew(state).employeeIds).toEqual([alone.id]);
  });

  it('names a driverless vehicle no licensed employee can walk to', () => {
    const state = makeState();
    hire(state, WEST, 'driving.truck');
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', EAST.x, EAST.z);
    expect(findStrandedCrew(state).vehicleIds).toEqual([vehicle.id]);
  });

  it('skips a vehicle nobody on the roster may drive: that is a hiring problem, not a way-in problem', () => {
    const state = makeState();
    hire(state, WEST, undefined, 'surveyor');
    purchaseVehicle(state.vehicles, 'debris_hauler', EAST.x, EAST.z);
    expect(findStrandedCrew(state).vehicleIds).toEqual([]);
  });

  it('skips a vehicle with someone aboard', () => {
    const state = makeState();
    hire(state, WEST, 'driving.truck');
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', EAST.x, EAST.z);
    vehicle.occupantIds = [999];
    expect(findStrandedCrew(state).vehicleIds).toEqual([]);
  });

  it('moves nobody and nothing', () => {
    const state = makeState();
    hire(state, WEST, 'driving.truck');
    const alone = hire(state, EAST);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', EAST.x + 2, EAST.z);
    findStrandedCrew(state);
    expect([alone.x, alone.z]).toEqual([EAST.x, EAST.z]);
    expect([vehicle.x, vehicle.z]).toEqual([EAST.x + 2, EAST.z]);
  });
});
