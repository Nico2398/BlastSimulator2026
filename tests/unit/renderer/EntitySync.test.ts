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
import { BuildingMesh } from '../../../src/renderer/BuildingMesh.js';
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
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

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
    vehicle.occupantIds = [];

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
    vehicle.occupantIds = [];

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(1);

    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it("re-adds the character mesh at the vehicle's dismount position once driverId clears again", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

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
    vehicle.occupantIds = [];
    employee.locomotion = { kind: 'on_foot' };

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });

  it('suppresses only the driving employee when a second, non-driving employee is also present (boundary: mixed roster)', () => {
    const state = createGame({ seed: SEED });
    const { employee: driver } = hireEmployee(state.employees, 'driller', new Random(SEED), 5, 5);
    const { employee: onFoot } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1), 8, 8);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(driver.id)).toBe(false);
    expect(renderedEmployeeIds.has(onFoot.id)).toBe(true);
  });
});

// ── locomotion-based suppression (#1087) ────────────────────────────────────
// Mount/itinerary phase 2 makes `employee.locomotion` the read source for
// which employees get no character mesh — `driverId` is a mirror, not the
// truth. These two cases set locomotion without ever touching driverId, so
// they fail against today's syncEntitySets (still driverId-only) and pass
// once it reads locomotion instead/in addition.
describe('syncEntitySets — reads employee.locomotion, not just the driver seat (#1087)', () => {
  it('creates no character mesh for an employee whose locomotion is mounted, even when the vehicle lists no driver', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    // Deliberately not mirrored onto driverId — locomotion alone must suppress.
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it('regains a character mesh once locomotion flips back to on_foot, mirroring the dismount position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(0);

    // Alight: dismount position snapped, occupantIds/locomotion cleared.
    vehicle.x = 12;
    vehicle.z = 4;
    employee.x = 12;
    employee.z = 4;
    vehicle.occupantIds = [];
    employee.locomotion = { kind: 'on_foot' };

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });
});

describe('buildingFootprintSurfaceY (#1007, corrected columns #1145)', () => {
  // driving_center tier 1's footprint is rect(2,2): dx/dz offsets
  // (0,0),(1,0),(0,1),(1,1) — the footprint's OWN 4 cells for a building at
  // (10,10) are (10,10),(11,10),(10,11),(11,11). Before #1145, the sampled
  // columns were one past the footprint's own edge — (10,10),(12,10),
  // (10,12),(12,12) — three of which lie OUTSIDE the footprint entirely.
  it('samples the footprint\'s own 4 cells (never a column one past the edge) and returns their minimum', () => {
    const b = makeBuilding(10, 10);
    const heights = new Map<string, number>([
      ['10,10', 3],
      ['11,10', 5],
      ['10,11', 7],
      ['11,11', 2],
    ]);
    const getSurfaceY = (x: number, z: number): number => {
      const h = heights.get(`${x},${z}`);
      if (h === undefined) throw new Error(`unexpected sample (${x},${z}) — must be one of the footprint's own cells`);
      return h;
    };

    expect(buildingFootprintSurfaceY(b, getSurfaceY)).toBe(2);
  });

  it('rests at the pad height on a levelled pad, regardless of what the neighbouring OUTSIDE-footprint columns read', () => {
    const b = makeBuilding(10, 10);
    const insideFootprint = new Set(['10,10', '11,10', '10,11', '11,11']);
    const getSurfaceY = (x: number, z: number): number => {
      const key = `${x},${z}`;
      // Every column the footprint actually occupies reads the same,
      // levelled 24.5 — every neighbouring column one past the edge (what
      // the pre-#1145 code sampled instead) reads wildly different values.
      // A correct implementation never calls getSurfaceY on any of these.
      if (insideFootprint.has(key)) return 24.5;
      if (key === '12,10' || key === '10,12' || key === '12,12') return 10.0;
      throw new Error(`unexpected sample (${x},${z})`);
    };

    expect(buildingFootprintSurfaceY(b, getSurfaceY)).toBe(24.5);
  });

  it('still returns the min of only the footprint\'s own columns on an uneven pad', () => {
    const b = makeBuilding(0, 0);
    const cornerHeights = { '0,0': 8, '1,0': 1, '0,1': 4, '1,1': 9 };
    const getSurfaceY = (x: number, z: number): number => {
      const h = cornerHeights[`${x},${z}` as keyof typeof cornerHeights];
      if (h === undefined) throw new Error(`unexpected sample (${x},${z})`);
      return h;
    };

    const result = buildingFootprintSurfaceY(b, getSurfaceY);

    expect(result).toBe(Math.min(...Object.values(cornerHeights)));
    for (const h of Object.values(cornerHeights)) {
      expect(result).toBeLessThanOrEqual(h);
    }
  });

  it('still returns a sane finite value for a footprint flush against the grid boundary, sampled through the real clamping surface sampler', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(15, 4, 15, 0, undefined, 1);
    // Placed so 2 of its 4 own footprint cells (x=16) fall outside the
    // 16-wide grid (valid columns 0..15) — getSmoothTerrainSurfaceY clamps
    // those to the nearest edge column rather than throwing or returning NaN.
    const b = makeBuilding(15, 15);
    const getSurfaceY = (x: number, z: number): number => getSmoothTerrainSurfaceY(grid, x, z);

    const result = buildingFootprintSurfaceY(b, getSurfaceY);

    expect(Number.isFinite(result)).toBe(true);
    expect(Number.isNaN(result)).toBe(false);
    // The min of the footprint's own 4 cells (15,15),(16,15),(15,16),(16,16)
    // — 2 of them clamped to the x=15/z=15 edge columns — not the stub's
    // placeholder 0, which happens to also be "finite" and would pass the
    // two checks above even though it isn't derived from any real sample.
    const expected = Math.min(
      getSurfaceY(15, 15), getSurfaceY(16, 15),
      getSurfaceY(15, 16), getSurfaceY(16, 16),
    );
    expect(result).toBe(expected);
  });

  // An empty footprint cannot be constructed from the real BUILDING_DEFS
  // catalog today — every entry uses rect(sizeX, sizeZ) with sizeX/sizeZ >=
  // 2 (BuildingDefs.ts) — so the "empty footprint falls back to
  // getSurfaceY(b.x, b.z)" case is skipped rather than inventing a fixture
  // outside this issue's scope.
});

describe('BuildingMesh.setSurfaceY (#1145) — mirrors VehicleMesh/CharacterMesh setSurfaceY', () => {
  it('updates only the y component, leaving x/z and the drawn model/tint untouched', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    const b = makeBuilding(4, 9);
    bm.addBuilding(b, 3);
    const posBefore = bm.getPosition(b.id)!;
    const instanceBefore = bm.getInstance(b.id);
    const xBefore = posBefore.x;
    const zBefore = posBefore.z;

    bm.setSurfaceY(b.id, 7);

    const posAfter = bm.getPosition(b.id)!;
    expect(posAfter.y).toBe(7);
    expect(posAfter.x).toBe(xBefore);
    expect(posAfter.z).toBe(zBefore);
    // Same model instance — a Y-only mutation, never a mesh rebuild
    // (updateBuilding()'s remove+re-add would swap this reference).
    expect(bm.getInstance(b.id)).toBe(instanceBefore);
    bm.dispose();
  });

  it('is a no-op for a building id that is not currently rendered', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    const b = makeBuilding(4, 9);
    bm.addBuilding(b, 3);

    expect(() => bm.setSurfaceY(999, 42)).not.toThrow();

    // The one actually-rendered building is unaffected.
    expect(bm.getPosition(b.id)!.y).toBe(3);
    expect(bm.count).toBe(1);
    bm.dispose();
  });
});
