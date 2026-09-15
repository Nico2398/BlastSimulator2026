// BlastSimulator2026 — Tests for board/alight (issue #1087, Mount/itinerary
// rebuild phase 2). Mount.ts is the sole writer of an employee's `locomotion`
// and a vehicle's `occupantIds`, together — see the `vehicles` rule's
// invariant list and the `gameplay-vehicle-fleet` skill's State Model.
//
// Red phase: board/alight are stubs that `throw new Error('not implemented')`
// (src/core/engine/Mount.ts). Every test below is expected to fail against
// that stub — a thrown "not implemented" is the correct failure here, not a
// compile/type error.

import { describe, it, expect } from 'vitest';
import { board, alight } from '../../../src/core/engine/Mount.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { VEHICLE_SEAT_COUNT } from '../../../src/core/config/balance.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { NavCell } from '../../../src/core/nav/NavGrid.js';

const SEED = 42;

/** A `driver` employee already holds the truck licence — boards a hauler/destroyer directly. */
function hireTruckDriver(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return hireEmployee(state.employees, 'driver', new Random(SEED), x, z).employee;
}

/** Grants the excavator licence a rock_digger/rock_fragmenter role requires. */
function hireExcavatorDriver(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), x, z);
  assignSkill(state.employees, employee.id, 'driving.excavator', 1);
  return employee;
}

/** A minimal hand-built cell — walkable and unoccupied unless overridden. */
function cell(type: NavCell['type'] = 'walkable', occupied = false): NavCell {
  return { type, moveCost: type === 'walkable' ? 1 : Infinity, benchLevel: 0, vehicleOccupied: occupied };
}

/**
 * A small NavGrid covering (originX..originX+width-1, originZ..originZ+height-1),
 * classifying every cell via `classify(x, z)`. Hand-built rather than routed
 * through VoxelGrid/buildNavGrid so each of a vehicle's 8 neighbours can be
 * pinned independently.
 */
function makeNavGrid(
  originX: number,
  originZ: number,
  width: number,
  height: number,
  classify: (x: number, z: number) => NavCell,
): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = originZ; z < originZ + height; z++) {
    const row: NavCell[] = [];
    for (let x = originX; x < originX + width; x++) {
      row.push(classify(x, z));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, 0, originX, originZ);
}

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

describe('board', () => {
  it('succeeds when the employee stands exactly on the vehicle\'s cell (Chebyshev distance 0)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);

    const result = board(state, vehicle.id, employee.id);

    expect(result.success).toBe(true);
  });

  it('succeeds when the employee stands one tile away (Chebyshev distance 1) and snaps them onto the vehicle\'s cell', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 6, 6); // diagonal, Chebyshev distance 1

    const result = board(state, vehicle.id, employee.id);

    expect(result.success).toBe(true);
    expect(employee.x).toBe(vehicle.x);
    expect(employee.z).toBe(vehicle.z);
  });

  it('fails when the employee is two tiles away (Chebyshev distance 2), naming the distance in the error', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 7, 5);

    const result = board(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.toLowerCase()).toMatch(/distance|too far|far/);
    }
    // No partial mutation on a refused board.
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).toEqual([]);
  });

  it('sets employee.locomotion, vehicle.occupantIds, and vehicle.driverId, and emits employee:mounted on success', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    const emitter = new EventEmitter();
    const mounted: Array<{ employeeId: number; vehicleId: number }> = [];
    emitter.on('employee:mounted', data => mounted.push(data));

    const result = board(state, vehicle.id, employee.id, emitter);

    expect(result.success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(vehicle.occupantIds).toContain(employee.id);
    expect(vehicle.driverId).toBe(vehicle.occupantIds[0]);
    expect(mounted).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  it('fails when the vehicle is already at its seat cap (VEHICLE_SEAT_COUNT), refusing a second employee', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const first = hireTruckDriver(state, 5, 5);
    const second = hireTruckDriver(state, 5, 5);
    // Simulate `first` already having boarded, without calling board() itself.
    vehicle.occupantIds = [first.id];
    vehicle.driverId = first.id;
    first.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    expect(vehicle.occupantIds.length).toBe(VEHICLE_SEAT_COUNT[vehicle.type]);

    const result = board(state, vehicle.id, second.id);

    expect(result.success).toBe(false);
    expect(vehicle.occupantIds).toEqual([first.id]);
    expect(second.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('a second employee cannot board a full vehicle — explicit case per the issue\'s own Test section', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 3, 3);
    const first = hireExcavatorDriver(state, 3, 3);
    assignSkill(state.employees, first.id, 'driving.drill_rig', 1);
    const second = hireExcavatorDriver(state, 3, 3);
    assignSkill(state.employees, second.id, 'driving.drill_rig', 1);
    vehicle.occupantIds = [first.id];
    vehicle.driverId = first.id;
    first.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const result = board(state, vehicle.id, second.id);

    expect(result.success).toBe(false);
    expect(vehicle.occupantIds).toHaveLength(1);
  });

  it('fails when the employee lacks the licence the vehicle role requires', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 5, 5);
    const employee = hireTruckDriver(state, 5, 5); // holds driving.truck, not driving.excavator

    const result = board(state, vehicle.id, employee.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.toLowerCase()).toMatch(/licence|license/);
    }
    expect(vehicle.occupantIds).toEqual([]);
  });

  it('fails when the employee is already mounted on a different vehicle', () => {
    const state = createGame({ seed: SEED });
    const { vehicle: current } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    const { vehicle: target } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    // Simulate already-mounted-elsewhere without calling board() itself.
    current.occupantIds = [employee.id];
    current.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: current.id };

    const result = board(state, target.id, employee.id);

    expect(result.success).toBe(false);
    expect(target.occupantIds).toEqual([]);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: current.id });
  });
});

describe('alight', () => {
  it('fails with an error when the vehicle has no occupants', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it('fails, with no state change, when the vehicle is mid-haul (haulingPhase set)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.haulingPhase = 'to_depot';

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(false);
    expect(vehicle.occupantIds).toEqual([employee.id]);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('sets locomotion to on_foot, clears occupantIds/driverId, and emits employee:alighted on success', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const emitter = new EventEmitter();
    const alighted: Array<{ employeeId: number; vehicleId: number }> = [];
    emitter.on('employee:alighted', data => alighted.push(data));

    const result = alight(state, vehicle.id, emitter);

    expect(result.success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).not.toContain(employee.id);
    expect(vehicle.driverId).toBeNull();
    expect(alighted).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  it('places the employee on the sole free walkable neighbour cell when exactly one of the 8 is free', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // Every neighbour blocked except (6, 6).
    const freeX = 6, freeZ = 6;
    state.navGrid = makeNavGrid(4, 4, 3, 3, (x, z) => {
      if (x === freeX && z === freeZ) return cell('walkable', false);
      if (x === vehicle.x && z === vehicle.z) return cell('walkable', true); // vehicle's own cell, occupied by itself
      return cell('blocked');
    });

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    expect(employee.x).toBe(freeX);
    expect(employee.z).toBe(freeZ);
  });

  it('falls back to the vehicle\'s own cell when navGrid is null', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    state.navGrid = null;

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    expect(employee.x).toBe(vehicle.x);
    expect(employee.z).toBe(vehicle.z);
  });

  it('falls back to the vehicle\'s own cell when none of the 8 neighbours are free', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // Every one of the 8 neighbours blocked; only the vehicle's own cell is walkable.
    state.navGrid = makeNavGrid(4, 4, 3, 3, (x, z) => {
      if (x === vehicle.x && z === vehicle.z) return cell('walkable', true);
      return cell('blocked');
    });

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    expect(employee.x).toBe(vehicle.x);
    expect(employee.z).toBe(vehicle.z);
  });

  it('when several neighbours are free, lands on one of the 8 neighbour offsets (not an arbitrary far cell)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    vehicle.driverId = employee.id;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    state.navGrid = makeNavGrid(3, 3, 5, 5, () => cell('walkable', false));

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    const isNeighbourOrOwnCell =
      (employee.x === vehicle.x && employee.z === vehicle.z) ||
      NEIGHBOR_OFFSETS.some(([dx, dz]) => employee.x === vehicle.x + dx && employee.z === vehicle.z + dz);
    expect(isNeighbourOrOwnCell).toBe(true);
  });
});
