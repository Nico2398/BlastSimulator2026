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
import {
  board, alight, enterBuilding, leaveBuilding, releaseOccupantsOfRemovedBuildings,
} from '../../../src/core/engine/Mount.js';
import { placeBuilding, destroyBuilding, getBuildingPeopleCapacity } from '../../../src/core/entities/Building.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
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

  it('sets employee.locomotion and vehicle.occupantIds, and emits employee:mounted on success', () => {
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
    expect(vehicleDriverId(vehicle)).toBe(vehicle.occupantIds[0]);
    expect(mounted).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  it('fails when the vehicle is already at its seat cap (VEHICLE_SEAT_COUNT), refusing a second employee', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const first = hireTruckDriver(state, 5, 5);
    const second = hireTruckDriver(state, 5, 5);
    // Simulate `first` already having boarded, without calling board() itself.
    vehicle.occupantIds = [first.id];
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

  it('fails, with no state change, when the vehicle is mid-haul (payload set)', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    // #1091: payload replaces haulingPhase as the mid-haul guard canReleaseDriver checks.
    vehicle.payload = { fragmentId: 1, massKg: 500 };

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
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const emitter = new EventEmitter();
    const alighted: Array<{ employeeId: number; vehicleId: number }> = [];
    emitter.on('employee:alighted', data => alighted.push(data));

    const result = alight(state, vehicle.id, emitter);

    expect(result.success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).not.toContain(employee.id);
    expect(vehicleDriverId(vehicle)).toBeNull();
    expect(alighted).toEqual([{ employeeId: employee.id, vehicleId: vehicle.id }]);
  });

  // #1178 (single-mover unification): destinationX/destinationZ are now a
  // READ-ONLY MIRROR of employee.itinerary's current leg. alight() already
  // nulls `itinerary` as its own side effect (the stale-itinerary #1089
  // regression fix above) — it must additionally null destinationX/
  // destinationZ alongside it, or a dismounted employee's stale mirror would
  // be misread as "still walking" by isMidEvacuationWalk (Evacuation.ts) and
  // isIdleForReposition (VehicleDriverAssignment.ts).
  it('#1178: nulls destinationX/destinationZ alongside itinerary on a successful alight', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    // A stale itinerary/mirror from before the alight — must be cleared, not
    // merely left for the next tick to catch up to.
    employee.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 20, destZ: 20,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      }],
      goal: { kind: 'reposition', x: 20, z: 20 },
      workTicks: 0,
      estTotalTicks: 5,
    };
    employee.destinationX = 20;
    employee.destinationZ = 20;

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    expect(employee.itinerary).toBeNull();
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
  });

  it('places the employee on the sole free walkable neighbour cell when exactly one of the 8 is free', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
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

  // #1151: a driver who steps down onto a cell they could not have walked to
  // is stranded there for good — nothing ever relocates an on-foot employee.
  it('skips a free neighbour the driver could not legally step onto, taking a climbable one instead', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // (4,4) comes first in NEIGHBOUR_OFFSETS_8 order and is walkable and
    // free, but sits a full 3m above the vehicle over a diagonal run — far
    // past NAV_MAX_SLOPE_RATIO. (6,6) is level with the vehicle.
    state.navGrid = makeNavGrid(4, 4, 3, 3, (x, z) => {
      const c = cell('walkable', x === vehicle.x && z === vehicle.z);
      c.surfaceY = x === 4 && z === 4 ? 3 : 0;
      c.climbY = c.surfaceY;
      return c;
    });

    const result = alight(state, vehicle.id);

    expect(result.success).toBe(true);
    expect({ x: employee.x, z: employee.z }).not.toEqual({ x: 4, z: 4 });
    expect(state.navGrid!.cellAt(employee.x, employee.z)!.surfaceY).toBe(0);
  });

  it('falls back to the vehicle\'s own cell when every free neighbour is too steep to step onto', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    const employee = hireTruckDriver(state, 5, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // The vehicle's own cell is the only one at its level — it drove up here,
    // so standing on it is always legal, unlike stepping off a cliff edge.
    state.navGrid = makeNavGrid(4, 4, 3, 3, (x, z) => {
      const own = x === vehicle.x && z === vehicle.z;
      const c = cell('walkable', own);
      c.surfaceY = own ? 0 : 5;
      c.climbY = c.surfaceY;
      return c;
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

// ── Building case of the occupancy model (#1202) ──
//
// A tier-1 driving_center is a 2x2 footprint; placed at (10, 10) it covers
// (10..11, 10..11) and its ring is every cell of (9..12, 9..12) outside that.

const SCHOOL_X = 10;
const SCHOOL_Z = 10;

function placeSchool(state: ReturnType<typeof createGame>) {
  const result = placeBuilding(state.buildings, 'driving_center', SCHOOL_X, SCHOOL_Z, 64, 64);
  if (!result.success || !result.building) throw new Error(`test setup: ${result.error}`);
  return result.building;
}

/** A 16x16 walkable grid whose school footprint cells are blocked, with `occupied` cells vehicle-occupied. */
function schoolNavGrid(occupied: ReadonlyArray<readonly [number, number]> = []): NavGrid {
  const taken = new Set(occupied.map(([x, z]) => `${x},${z}`));
  return makeNavGrid(0, 0, 16, 16, (x, z) => {
    const inFootprint = x >= SCHOOL_X && x <= SCHOOL_X + 1 && z >= SCHOOL_Z && z <= SCHOOL_Z + 1;
    if (inFootprint) return cell('blocked');
    return cell('walkable', taken.has(`${x},${z}`));
  });
}

describe('enterBuilding', () => {
  it('takes an on-foot employee standing on the ring inside, both sides together', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    const emitter = new EventEmitter();
    const events: unknown[] = [];
    emitter.on('employee:entered_building', (e) => events.push(e));

    const result = enterBuilding(state, school.id, employee.id, emitter);

    expect(result.success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'inside', buildingId: school.id });
    expect(school.occupantIds).toEqual([employee.id]);
    expect(events).toEqual([{ employeeId: employee.id, buildingId: school.id }]);
  });

  it('refuses an employee who is not on the ring', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const employee = hireTruckDriver(state, SCHOOL_X - 3, SCHOOL_Z);

    const result = enterBuilding(state, school.id, employee.id);

    expect(result.success).toBe(false);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toEqual([]);
  });

  it('refuses the next employee once the building is at its people capacity', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const capacity = getBuildingPeopleCapacity(school.type, school.tier);
    expect(capacity).toBeGreaterThan(0);
    for (let i = 0; i < capacity; i++) {
      const inside = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
      expect(enterBuilding(state, school.id, inside.id).success).toBe(true);
    }
    const late = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);

    const result = enterBuilding(state, school.id, late.id);

    expect(result.success).toBe(false);
    expect(late.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toHaveLength(capacity);
  });

  it('refuses a building type that takes no people', () => {
    const state = createGame({ seed: SEED });
    const placed = placeBuilding(state.buildings, 'freight_warehouse', SCHOOL_X, SCHOOL_Z, 64, 64);
    const warehouse = placed.building!;
    expect(getBuildingPeopleCapacity(warehouse.type, warehouse.tier)).toBe(0);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);

    expect(enterBuilding(state, warehouse.id, employee.id).success).toBe(false);
    expect(warehouse.occupantIds).toEqual([]);
  });

  it('refuses a mounted employee — entering is done on foot', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', SCHOOL_X - 1, SCHOOL_Z);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    expect(board(state, vehicle.id, employee.id).success).toBe(true);

    expect(enterBuilding(state, school.id, employee.id).success).toBe(false);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(school.occupantIds).toEqual([]);
  });
});

describe('leaveBuilding', () => {
  it('puts the employee back on foot on the ring cell they entered from when it is free', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = schoolNavGrid();
    const school = placeSchool(state);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    enterBuilding(state, school.id, employee.id);

    const result = leaveBuilding(state, employee.id);

    expect(result.success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toEqual([]);
    expect({ x: employee.x, z: employee.z }).toEqual({ x: SCHOOL_X - 1, z: SCHOOL_Z });
  });

  it('puts the employee on the nearest free ring cell when their entry cell has since been taken', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    enterBuilding(state, school.id, employee.id);
    state.navGrid = schoolNavGrid([[SCHOOL_X - 1, SCHOOL_Z]]);

    leaveBuilding(state, employee.id);

    const onRing = employee.x >= SCHOOL_X - 1 && employee.x <= SCHOOL_X + 2
      && employee.z >= SCHOOL_Z - 1 && employee.z <= SCHOOL_Z + 2
      && !(employee.x >= SCHOOL_X && employee.x <= SCHOOL_X + 1 && employee.z >= SCHOOL_Z && employee.z <= SCHOOL_Z + 1);
    expect(onRing).toBe(true);
    expect({ x: employee.x, z: employee.z }).not.toEqual({ x: SCHOOL_X - 1, z: SCHOOL_Z });
    expect(Math.max(Math.abs(employee.x - (SCHOOL_X - 1)), Math.abs(employee.z - SCHOOL_Z))).toBe(1);
  });

  it('refuses an employee who is not inside a building', () => {
    const state = createGame({ seed: SEED });
    const employee = hireTruckDriver(state, 3, 3);

    expect(leaveBuilding(state, employee.id).success).toBe(false);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('frees the place so the next employee can enter a full building', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const capacity = getBuildingPeopleCapacity(school.type, school.tier);
    const insiders = Array.from({ length: capacity }, () => hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z));
    for (const e of insiders) enterBuilding(state, school.id, e.id);
    const late = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    expect(enterBuilding(state, school.id, late.id).success).toBe(false);

    leaveBuilding(state, insiders[0]!.id);

    expect(enterBuilding(state, school.id, late.id).success).toBe(true);
  });
});

describe('releaseOccupantsOfRemovedBuildings', () => {
  it('puts everyone inside a removed building back on foot on its ring, and leaves other buildings alone', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const other = placeBuilding(state.buildings, 'geology_lab', 30, 30, 64, 64).building!;
    const trapped = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    const safe = hireTruckDriver(state, 29, 30);
    enterBuilding(state, school.id, trapped.id);
    enterBuilding(state, other.id, safe.id);

    destroyBuilding(state.buildings, school.id);
    const released = releaseOccupantsOfRemovedBuildings(state);

    expect(released).toEqual([trapped.id]);
    expect(trapped.locomotion).toEqual({ kind: 'on_foot' });
    expect({ x: trapped.x, z: trapped.z }).toEqual({ x: SCHOOL_X - 1, z: SCHOOL_Z });
    expect(safe.locomotion).toEqual({ kind: 'inside', buildingId: other.id });
  });
});

describe('board — the vehicle case of the same model', () => {
  it('refuses an employee who is inside a building', () => {
    const state = createGame({ seed: SEED });
    const school = placeSchool(state);
    const employee = hireTruckDriver(state, SCHOOL_X - 1, SCHOOL_Z);
    enterBuilding(state, school.id, employee.id);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', SCHOOL_X - 1, SCHOOL_Z);

    expect(board(state, vehicle.id, employee.id).success).toBe(false);
    expect(vehicle.occupantIds).toEqual([]);
    expect(employee.locomotion).toEqual({ kind: 'inside', buildingId: school.id });
  });
});
