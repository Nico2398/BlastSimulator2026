// BlastSimulator2026 — Tests for EntitySync.syncEntitySets's driver-mesh
// suppression (issue #922)
//
// While `vehicle.driverId === employee.id`, the employee is logically inside
// the vehicle (EntityMovementTick.syncDriverPosition keeps their x/z glued
// to it every tick) — no character mesh should be created or kept for them.
// Before this fix, syncEntitySets added/kept a mesh for every employee in
// state.employees.employees unconditionally, so a driven employee's mesh sat
// visibly parked wherever they boarded while the vehicle drove off without
// them, and never disappeared once boarded.
//
// Uses real THREE.Scene + CharacterMesh instances rather than mocks — the
// same pattern VehicleMesh.test.ts uses (three.js runs fine headless, no
// WebGL context needed for scene graph construction).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { syncEntitySets, buildingFootprintSurfaceY } from '../../../src/renderer/EntitySync.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import type { Building } from '../../../src/core/entities/Building.js';
import { VoxelGrid, getSmoothTerrainSurfaceY } from '../../../src/core/world/VoxelGrid.js';

const SEED = 42;

// driving_center tier 1 has a 2x2 footprint (BuildingDefs.ts) — big enough
// for its 4 corners to land on different voxel columns.
function makeBuilding(x: number, z: number): Building {
  return { id: 1, type: 'driving_center', tier: 1, x, z, hp: 100, active: true };
}

describe('syncEntitySets — suppresses the character mesh for a seated driver (#922)', () => {
  it('creates no character mesh for an employee whose id is already a vehicle driverId on first sync', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = employee.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it('keeps a normal mesh for an employee walking toward a vehicle they have not boarded yet (driverId still null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.destinationX = 5;
    employee.destinationZ = 5;
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = null;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });

  it('a vehicle with no driver never suppresses anyone, even with several employees and vehicles present (boundary)', () => {
    const state = createGame({ seed: SEED });
    const { employee: a } = hireEmployee(state.employees, 'driller', new Random(SEED), 1, 1);
    const { employee: b } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1), 2, 2);
    purchaseVehicle(state.vehicles, 'drill_rig', 9, 9);
    purchaseVehicle(state.vehicles, 'debris_hauler', 11, 11);

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(2);
    expect(renderedEmployeeIds.has(a.id)).toBe(true);
    expect(renderedEmployeeIds.has(b.id)).toBe(true);
  });

  it('removes an existing mesh the instant the employee becomes a seated driver on a later sync', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = null;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(1);

    vehicle.driverId = employee.id;
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it("re-adds the character mesh at the vehicle's dismount position once driverId clears again", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(0);

    // Dismount: the vehicle drove to (12, 4), the driver's logical position
    // snapped to the vehicle's current cell (VehicleReservation.ts's own
    // dismount invariant, #593/#922), driverId cleared.
    vehicle.x = 12;
    vehicle.z = 4;
    employee.x = 12;
    employee.z = 4;
    vehicle.driverId = null;

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });

  it('suppresses only the driving employee when a second, non-driving employee is also present (boundary: mixed roster)', () => {
    const state = createGame({ seed: SEED });
    const { employee: driver } = hireEmployee(state.employees, 'driller', new Random(SEED), 5, 5);
    const { employee: onFoot } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1), 8, 8);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = driver.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(driver.id)).toBe(false);
    expect(renderedEmployeeIds.has(onFoot.id)).toBe(true);
  });
});

describe('buildingFootprintSurfaceY (#1007)', () => {
  it('samples the 4 footprint corners and returns their minimum', () => {
    const b = makeBuilding(10, 10); // 2x2 footprint -> corners (10,10) (12,10) (10,12) (12,12)
    const heights = new Map<string, number>([
      ['10,10', 3],
      ['12,10', 5],
      ['10,12', 7],
      ['12,12', 2],
    ]);
    const getSurfaceY = (x: number, z: number): number => {
      const h = heights.get(`${x},${z}`);
      if (h === undefined) throw new Error(`unexpected sample (${x},${z})`);
      return h;
    };

    expect(buildingFootprintSurfaceY(b, getSurfaceY)).toBe(2);
  });

  it('returns the single shared height on a flat pad, matching the old center-sample behavior (regression guard)', () => {
    const b = makeBuilding(10, 10);
    const getSurfaceY = (): number => 6;

    expect(buildingFootprintSurfaceY(b, getSurfaceY)).toBe(6);
  });

  it('never floats above any individual corner\'s sampled height, for an arbitrary multi-level footprint', () => {
    const b = makeBuilding(0, 0);
    const cornerHeights = { '0,0': 8, '2,0': 1, '0,2': 4, '2,2': 9 };
    const getSurfaceY = (x: number, z: number): number => cornerHeights[`${x},${z}` as keyof typeof cornerHeights];

    const result = buildingFootprintSurfaceY(b, getSurfaceY);

    // The property under test (never floats above any corner) plus an exact
    // check against the min — the property alone is satisfied trivially by
    // a stub that always returns 0, since 0 sits below every positive corner
    // here.
    expect(result).toBe(Math.min(...Object.values(cornerHeights)));
    for (const h of Object.values(cornerHeights)) {
      expect(result).toBeLessThanOrEqual(h);
    }
  });

  it('still returns a sane finite value for a footprint flush against the grid boundary, sampled through the real clamping surface sampler', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(15, 4, 15, 0, undefined, 1);
    // Placed so 2 of its 4 corners (17,*) fall outside the 16-wide grid —
    // getSmoothTerrainSurfaceY clamps those to the nearest edge column
    // rather than throwing or returning NaN.
    const b = makeBuilding(15, 15);
    const getSurfaceY = (x: number, z: number): number => getSmoothTerrainSurfaceY(grid, x, z);

    const result = buildingFootprintSurfaceY(b, getSurfaceY);

    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isNaN(result)).toBe(false);
    // The min of the 4 corner samples (2 of them clamped to the x=15 edge
    // column, same as the 2 in-bounds ones) — not the stub's placeholder 0,
    // which happens to also be "finite" and would pass the two checks above
    // even though it isn't derived from any real sample.
    const expected = Math.min(
      getSurfaceY(15, 15), getSurfaceY(17, 15),
      getSurfaceY(15, 17), getSurfaceY(17, 17),
    );
    expect(result).toBe(expected);
  });
});
