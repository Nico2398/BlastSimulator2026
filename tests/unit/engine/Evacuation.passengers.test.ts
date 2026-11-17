// BlastSimulator2026 — evacuating a shuttle's passengers (#2290 C7)
//
// A passenger has no ground cell, no itinerary of its own that leaves the vehicle, and no way to step off: when a zone
// is cleared, every passenger standing in it is unloaded on foot and walked out like any on-foot employee.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { evacuateZone } from '../../../src/core/engine/Evacuation.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { board } from '../../../src/core/engine/Mount.js';
import { isInZone, type ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { expectNoWorldInvariantViolations } from '../../helpers/worldInvariants.js';

const SEED = 42;
const ZONE: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

function flatWalkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

function hireWalker(state: ReturnType<typeof createGame>, x: number, z: number) {
  const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), x, z);
  employee.qualifications = [];
  return employee;
}

/** A shuttle at (vx, vz) with a driver and `passengers` passengers aboard. */
function loadedShuttle(state: ReturnType<typeof createGame>, vx: number, vz: number, passengers: number) {
  const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', vx, vz);
  const driver = hireWalker(state, vx, vz);
  expect(board(state, vehicle.id, driver.id).success).toBe(true);
  const riders = [];
  for (let i = 0; i < passengers; i++) {
    const p = hireWalker(state, vx, vz);
    expect(board(state, vehicle.id, p.id, undefined, 'passenger').success).toBe(true);
    riders.push(p);
  }
  return { vehicle, driver, riders };
}

describe('evacuateZone with passengers aboard (#2290 C7)', () => {
  it('unloads every passenger standing in the zone, on foot, and walks them out', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = flatWalkableGrid(40);
    const { vehicle, riders } = loadedShuttle(state, 15, 15, 3);

    evacuateZone(state, ZONE);

    for (const p of riders) {
      expect(p.locomotion, `passenger ${p.id}`).toEqual({ kind: 'on_foot' });
      expect(vehicle.occupantIds).not.toContain(p.id);
      expect(p.itinerary, `passenger ${p.id} has somewhere to go`).not.toBeNull();
    }
    expectNoWorldInvariantViolations(state);
  });

  it('leaves no mounted passenger in the cleared zone and every rider clear of it once the walk is done', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = flatWalkableGrid(40);
    const { vehicle, driver, riders } = loadedShuttle(state, 15, 15, 5);

    evacuateZone(state, ZONE);
    for (let n = 0; n < 300 && [driver, ...riders].some(e => e.itinerary !== null); n++) {
      tickLocomotion(state);
      for (const p of riders) {
        if (p.locomotion.kind === 'mounted') expect(isInZone(p.x, p.z, ZONE), `passenger ${p.id} mounted in the zone`).toBe(false);
      }
    }

    for (const p of riders) {
      expect(p.locomotion.kind).not.toBe('mounted');
      expect(isInZone(p.x, p.z, ZONE), `passenger ${p.id} still in the zone`).toBe(false);
    }
    expect(isInZone(driver.x, driver.z, ZONE)).toBe(false);
    expect(vehicle.occupantIds.every(id => id === driver.id)).toBe(true);
  });

  it('puts the passengers out on distinct cells', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = flatWalkableGrid(40);
    const { riders } = loadedShuttle(state, 15, 15, 4);

    evacuateZone(state, ZONE);

    const cells = new Set(riders.map(p => `${Math.round(p.x)},${Math.round(p.z)}`));
    expect(cells.size).toBe(riders.length);
  });

  it('leaves a shuttle outside the zone, with its passengers, alone', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = flatWalkableGrid(40);
    const { vehicle, driver, riders } = loadedShuttle(state, 30, 30, 2);

    evacuateZone(state, ZONE);

    expect(vehicle.occupantIds).toEqual([driver.id, ...riders.map(p => p.id)]);
    for (const p of riders) expect(p.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expectNoWorldInvariantViolations(state);
  });

  it('a shuttle with only its driver evacuates as before', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = flatWalkableGrid(40);
    const { driver } = loadedShuttle(state, 15, 15, 0);

    evacuateZone(state, ZONE);
    for (let n = 0; n < 300 && driver.itinerary !== null; n++) tickLocomotion(state);

    expect(isInZone(driver.x, driver.z, ZONE)).toBe(false);
  });
});
