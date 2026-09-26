// BlastSimulator2026 — Building occupancy end to end (#1202)
//
// The issue's own verification: an employee sent to a school walks to its
// ring, goes inside, disappears from the scene, and reappears on a ring cell
// on leaving; a full school refuses the next one; the world invariants hold
// throughout. Driven through the real movement path — moveTo installs the
// itinerary, tickLocomotion walks it and applies its `enter_building` step —
// on a hand-built flat NavGrid so the walk is deterministic.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { hireEmployee } from '../../src/core/entities/Employee.js';
import { placeBuilding, getBuildingPeopleCapacity } from '../../src/core/entities/Building.js';
import type { Building } from '../../src/core/entities/Building.js';
import { Random } from '../../src/core/math/Random.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import type { NavCell } from '../../src/core/nav/NavGrid.js';
import { moveTo } from '../../src/core/engine/MoveTo.js';
import { tickLocomotion } from '../../src/core/engine/Locomotion.js';
import { leaveBuilding } from '../../src/core/engine/Mount.js';
import { syncEntitySets } from '../../src/renderer/EntitySync.js';
import { CharacterMesh } from '../../src/renderer/CharacterMesh.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';

const SEED = 1202;
const SCHOOL_X = 10;
const SCHOOL_Z = 10;
const MAX_TICKS = 200;

/** A 24x24 flat walkable NavGrid with `building`'s footprint blocked, as buildNavGrid would classify it. */
function flatGridAround(building: Building): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < 24; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 24; x++) {
      const inFootprint = x >= building.x && x <= building.x + 1 && z >= building.z && z <= building.z + 1;
      row.push(inFootprint
        ? { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false }
        : { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(24, 24, cells, 0, 0, 0);
}

function isOnRing(building: Building, x: number, z: number): boolean {
  const inBox = x >= building.x - 1 && x <= building.x + 2 && z >= building.z - 1 && z <= building.z + 2;
  const inFootprint = x >= building.x && x <= building.x + 1 && z >= building.z && z <= building.z + 1;
  return inBox && !inFootprint;
}

/** Tick locomotion until `done` or MAX_TICKS, checking the world invariants after every tick. */
function tickUntil(state: GameState, done: () => boolean): number {
  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    tickLocomotion(state);
    expectNoWorldInvariantViolations(state);
    if (done()) return tick;
  }
  throw new Error(`condition not reached within ${MAX_TICKS} ticks`);
}

function setup() {
  const state = createGame({ seed: SEED });
  const school = placeBuilding(state.buildings, 'driving_center', SCHOOL_X, SCHOOL_Z, 64, 64).building!;
  state.navGrid = flatGridAround(school);
  return { state, school };
}

describe('building occupancy — walk, enter, vanish, leave (#1202)', () => {
  it('an employee sent to a school walks to its ring, goes inside, has no mesh, and reappears on a ring cell on leaving', () => {
    const { state, school } = setup();
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 3);
    const characters = new CharacterMesh(new THREE.Scene());
    const renderedEmployeeIds = new Set<number>();
    const sync = () => syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    sync();
    expect(characters.count).toBe(1);

    expect(moveTo(state, employee.id, { buildingId: school.id }).success).toBe(true);
    const ticks = tickUntil(state, () => employee.locomotion.kind === 'inside');

    expect(ticks).toBeGreaterThan(1); // actually walked there, not teleported
    expect(employee.locomotion).toEqual({ kind: 'inside', buildingId: school.id });
    expect(school.occupantIds).toEqual([employee.id]);
    expect(employee.itinerary).toBeNull();
    expect(isOnRing(school, employee.x, employee.z)).toBe(true);
    sync();
    expect(characters.count).toBe(0);

    expect(leaveBuilding(state, employee.id).success).toBe(true);
    expectNoWorldInvariantViolations(state);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toEqual([]);
    expect(isOnRing(school, employee.x, employee.z)).toBe(true);
    sync();
    expect(characters.count).toBe(1);
  });

  it('a full school refuses the next arrival, who stays on foot on its ring', () => {
    const { state, school } = setup();
    const capacity = getBuildingPeopleCapacity(school.type, school.tier);
    const rng = new Random(SEED);
    const crowd = Array.from({ length: capacity + 1 }, (_, i) => hireEmployee(state.employees, 'driver', rng, 2 + i, 2).employee);
    for (const e of crowd) expect(moveTo(state, e.id, { buildingId: school.id }).success).toBe(true);

    tickUntil(state, () => crowd.every(e => e.itinerary === null));

    const inside = crowd.filter(e => e.locomotion.kind === 'inside');
    const outside = crowd.filter(e => e.locomotion.kind === 'on_foot');
    expect(inside).toHaveLength(capacity);
    expect(outside).toHaveLength(1);
    expect(school.occupantIds).toHaveLength(capacity);
    expect(isOnRing(school, outside[0]!.x, outside[0]!.z)).toBe(true);
  });

  it('a fresh order to someone inside takes them out first, then walks them away', () => {
    const { state, school } = setup();
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), SCHOOL_X - 1, SCHOOL_Z);
    expect(moveTo(state, employee.id, { buildingId: school.id }).success).toBe(true);
    tickUntil(state, () => employee.locomotion.kind === 'inside');

    expect(moveTo(state, employee.id, { x: 2, z: 2 }).success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(school.occupantIds).toEqual([]);
    tickUntil(state, () => employee.x === 2 && employee.z === 2);
  });
});
