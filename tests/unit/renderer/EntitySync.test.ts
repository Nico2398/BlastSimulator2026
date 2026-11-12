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
import { VehicleMesh } from '../../../src/renderer/VehicleMesh.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';
import { BuildingMesh } from '../../../src/renderer/BuildingMesh.js';
import type { Building } from '../../../src/core/entities/Building.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { enterBuilding, leaveBuilding } from '../../../src/core/engine/Mount.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { MovementTrail } from '../../../src/core/entities/MovementTrail.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
import { VoxelGrid, getSmoothTerrainSurfaceY } from '../../../src/core/world/VoxelGrid.js';

const SEED = 42;

// driving_center tier 1 has a 2x2 footprint (BuildingDefs.ts) — big enough
// for its 4 corners to land on different voxel columns.
function makeBuilding(x: number, z: number): Building {
  return { id: 1, type: 'driving_center', tier: 1, x, z, hp: 100, active: true, occupantIds: [] };
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

describe('syncEntitySets — no character mesh for an employee inside a building (#1202)', () => {
  it('drops the mesh when the employee enters and gives it back on the ring cell when they leave', () => {
    const state = createGame({ seed: SEED });
    const { building } = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 9, 10);

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(1);

    expect(enterBuilding(state, building!.id, employee.id).success).toBe(true);
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);

    expect(leaveBuilding(state, employee.id).success).toBe(true);
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
    expect({ x: employee.x, z: employee.z }).toEqual({ x: 9, z: 10 });
  });

  it('creates no mesh on first sync for an employee already inside (a loaded save)', () => {
    const state = createGame({ seed: SEED });
    const { building } = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 9, 10);
    enterBuilding(state, building!.id, employee.id);

    const characters = new CharacterMesh(new THREE.Scene());
    const renderedEmployeeIds = new Set<number>();
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
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
    const grid = new VoxelGrid(16, 16);
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

// ── Walk all the way to the host before vanishing / emerge at it (#1589) ────
// Mounted or inside employees WITH a walkTrail keep their mesh until playback
// reaches the board/enter marker; without a trail (a loaded save) the removals
// above stay immediate. Distances are in cells; a vehicle counts from its
// centre, a building from the footprint edge (unit squares per footprint cell).

const VEHICLE_RADIUS = 1.5;
const BATCH_SIZES = [1, 2, 4] as const;
const FRAME_DT = 0.05;

function distToVehicle(p: { x: number; z: number }, vx: number, vz: number): number {
  return Math.hypot(p.x - vx, p.z - vz);
}

function distToFootprint(p: { x: number; z: number }, b: Building): number {
  let best = Infinity;
  for (const [dx, dz] of getBuildingDef(b.type, b.tier).footprint) {
    const minX = b.x + dx;
    const minZ = b.z + dz;
    const cx = Math.min(Math.max(p.x, minX), minX + 1);
    const cz = Math.min(Math.max(p.z, minZ), minZ + 1);
    best = Math.min(best, Math.hypot(p.x - cx, p.z - cz));
  }
  return best;
}

type Pt = { x: number; z: number };

/** Unit-cell hops from `from` towards `to`, ending exactly on `to`. */
function hopsTo(from: Pt, to: Pt): Pt[] {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(1, Math.ceil(len - 1e-9));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
  }
  return out;
}

function trailOf(points: Pt[], event: 'board' | 'enter' | 'alight' | 'leave', index: number, host: Pt): MovementTrail {
  return {
    points,
    relocated: false,
    hostMarkers: [{
      pointIndex: index, event,
      hostKind: event === 'board' || event === 'alight' ? 'vehicle' : 'building',
      hostX: host.x, hostZ: host.z,
    }],
  };
}

function sync(state: ReturnType<typeof createGame>, characters: CharacterMesh, rendered: Set<number>): void {
  syncEntitySets(state, null, new Set(), null, new Set(), characters, rendered);
}

function frameUpdate(state: ReturnType<typeof createGame>, characters: CharacterMesh): void {
  characters.update(state.employees.employees, FRAME_DT);
}

/** Plays frames until the mesh is gone; returns the last position it had and whether it ever got removed. */
function playUntilRemoved(
  state: ReturnType<typeof createGame>, characters: CharacterMesh, id: number, startedAt: Pt,
): { last: Pt; removed: boolean; positions: Pt[] } {
  let last = startedAt;
  const positions: Pt[] = [];
  for (let i = 0; i < 80; i++) {
    frameUpdate(state, characters);
    const p = characters.getPosition(id);
    if (!p) return { last, removed: true, positions };
    last = { x: p.x, z: p.z };
    positions.push(last);
  }
  return { last, removed: false, positions };
}

describe('syncEntitySets — boards a vehicle only after walking up to it (#1589)', () => {
  const V: Pt = { x: 20, z: 10 };
  for (const [i, batch] of BATCH_SIZES.entries()) {
    const away = [2.5, 4.5, 8.5][i]!;
    it(`batch of ${batch} ticks (${away} cells away): mesh survives the sync, walks the trail, vanishes within ${VEHICLE_RADIUS} cells`, () => {
      const state = createGame({ seed: SEED });
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), V.x - away, V.z);
      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', V.x, V.z);
      const characters = new CharacterMesh(new THREE.Scene());
      const rendered = new Set<number>();
      sync(state, characters, rendered);
      expect(characters.count).toBe(1);

      const start = { x: V.x - away, z: V.z };
      const points = [start, ...hopsTo(start, V)];
      vehicle.occupantIds = [employee.id];
      employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      employee.x = V.x;
      employee.z = V.z;
      employee.walkTrail = trailOf(points, 'board', points.length - 1, V);
      sync(state, characters, rendered);

      // Still on screen, still where it stood, and flagged as on its way out.
      expect(characters.count).toBe(1);
      expect(characters.isRetiring(employee.id)).toBe(true);
      expect(distToVehicle(characters.getPosition(employee.id)!, V.x, V.z)).toBeGreaterThan(VEHICLE_RADIUS);

      frameUpdate(state, characters);
      const afterOne = characters.getPosition(employee.id);
      expect(afterOne).not.toBeNull();
      expect(afterOne!.x).toBeGreaterThan(start.x);

      const { last, removed, positions } = playUntilRemoved(state, characters, employee.id, { x: afterOne!.x, z: afterOne!.z });
      expect(removed).toBe(true);
      expect(distToVehicle(last, V.x, V.z)).toBeLessThanOrEqual(VEHICLE_RADIUS);
      // Walks monotonically along the trail, never past the vehicle.
      for (const p of positions) expect(p.x).toBeLessThanOrEqual(V.x + 1e-9);
      for (let k = 1; k < positions.length; k++) expect(positions[k]!.x).toBeGreaterThanOrEqual(positions[k - 1]!.x - 1e-9);
      expect(characters.isRetiring(employee.id)).toBe(false);
    });
  }
});

describe('syncEntitySets — enters a building only after reaching its door (#1589)', () => {
  const ring: Pt = { x: 9, z: 10 };
  for (const [i, batch] of BATCH_SIZES.entries()) {
    const edgeDistance = [3, 5, 9][i]!;
    it(`batch of ${batch} ticks (${edgeDistance} cells from the footprint): mesh vanishes only within ${VEHICLE_RADIUS} cells of the edge`, () => {
      const state = createGame({ seed: SEED });
      const { building } = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64);
      const start = { x: 10 - edgeDistance, z: 10 };
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), start.x, start.z);
      const characters = new CharacterMesh(new THREE.Scene());
      const rendered = new Set<number>();
      sync(state, characters, rendered);
      expect(characters.count).toBe(1);
      expect(distToFootprint(start, building!)).toBeGreaterThan(VEHICLE_RADIUS);

      employee.x = ring.x;
      employee.z = ring.z;
      expect(enterBuilding(state, building!.id, employee.id).success).toBe(true);
      const points = [start, ...hopsTo(start, ring)];
      employee.walkTrail = trailOf(points, 'enter', points.length - 1, { x: building!.x, z: building!.z });
      sync(state, characters, rendered);

      expect(characters.count).toBe(1);
      expect(characters.isRetiring(employee.id)).toBe(true);

      frameUpdate(state, characters);
      const afterOne = characters.getPosition(employee.id);
      expect(afterOne).not.toBeNull();
      expect(afterOne!.x).toBeGreaterThan(start.x);

      const { last, removed } = playUntilRemoved(state, characters, employee.id, { x: afterOne!.x, z: afterOne!.z });
      expect(removed).toBe(true);
      expect(distToFootprint(last, building!)).toBeLessThanOrEqual(VEHICLE_RADIUS);
    });
  }
});

describe('syncEntitySets — appears at the vehicle / door and walks away (#1589)', () => {
  const V: Pt = { x: 20, z: 10 };
  for (const [i, batch] of BATCH_SIZES.entries()) {
    const away = [2.5, 4.5, 8.5][i]!;
    it(`alight, batch of ${batch}: first rendered position is at the vehicle, then follows the trail to the employee`, () => {
      const state = createGame({ seed: SEED });
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), V.x, V.z);
      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', V.x, V.z);
      vehicle.occupantIds = [employee.id];
      employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      const characters = new CharacterMesh(new THREE.Scene());
      const rendered = new Set<number>();
      sync(state, characters, rendered);
      expect(characters.count).toBe(0);

      // East along z=10, then one cell south: ends `away` cells from the vehicle.
      const corner = { x: V.x + away - 1, z: V.z };
      const end = { x: corner.x, z: V.z + 1 };
      const points = [V, ...hopsTo(V, corner), end];
      vehicle.occupantIds = [];
      employee.locomotion = { kind: 'on_foot' };
      employee.x = end.x;
      employee.z = end.z;
      employee.walkTrail = trailOf(points, 'alight', 0, V);
      sync(state, characters, rendered);

      expect(characters.count).toBe(1);
      const first = characters.getPosition(employee.id)!;
      expect(distToVehicle(first, V.x, V.z)).toBeLessThanOrEqual(VEHICLE_RADIUS);

      let prevX = first.x;
      for (let f = 0; f < 80; f++) {
        frameUpdate(state, characters);
        const p = characters.getPosition(employee.id)!;
        const onLeg1 = Math.abs(p.z - V.z) < 1e-6 && p.x >= V.x - 1e-6 && p.x <= corner.x + 1e-6;
        const onLeg2 = Math.abs(p.x - end.x) < 1e-6 && p.z >= V.z - 1e-6 && p.z <= end.z + 1e-6;
        expect(onLeg1 || onLeg2).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(prevX - 1e-9);
        prevX = p.x;
      }
      const final = characters.getPosition(employee.id)!;
      expect(final.x).toBeCloseTo(end.x, 6);
      expect(final.z).toBeCloseTo(end.z, 6);
    });
  }

  for (const [i, batch] of BATCH_SIZES.entries()) {
    const edgeDistance = [3, 5, 9][i]!;
    it(`leave, batch of ${batch}: first rendered position is within ${VEHICLE_RADIUS} cells of the footprint edge`, () => {
      const state = createGame({ seed: SEED });
      const { building } = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64);
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 9, 10);
      expect(enterBuilding(state, building!.id, employee.id).success).toBe(true);
      const characters = new CharacterMesh(new THREE.Scene());
      const rendered = new Set<number>();
      sync(state, characters, rendered);
      expect(characters.count).toBe(0);

      expect(leaveBuilding(state, employee.id).success).toBe(true);
      const ring = { x: employee.x, z: employee.z };
      const end = { x: 10 - edgeDistance, z: 10 };
      employee.x = end.x;
      employee.z = end.z;
      employee.walkTrail = trailOf([ring, ...hopsTo(ring, end)], 'leave', 0, { x: building!.x, z: building!.z });
      sync(state, characters, rendered);

      expect(characters.count).toBe(1);
      const first = characters.getPosition(employee.id)!;
      expect(distToFootprint(first, building!)).toBeLessThanOrEqual(VEHICLE_RADIUS);

      for (let f = 0; f < 80; f++) frameUpdate(state, characters);
      const final = characters.getPosition(employee.id)!;
      expect(final.x).toBeCloseTo(end.x, 6);
      expect(final.z).toBeCloseTo(end.z, 6);
    });
  }
});

describe('syncEntitySets — edge cases of delayed removal (#1589)', () => {
  function boardingSetup(withTrail: boolean) {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 14, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 10);
    const characters = new CharacterMesh(new THREE.Scene());
    const rendered = new Set<number>();
    sync(state, characters, rendered);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.x = 20;
    employee.z = 10;
    if (withTrail) {
      const pts = [{ x: 14, z: 10 }, ...hopsTo({ x: 14, z: 10 }, { x: 20, z: 10 })];
      employee.walkTrail = trailOf(pts, 'board', pts.length - 1, { x: 20, z: 10 });
    }
    return { state, employee, characters, rendered };
  }

  it('a mounted employee without a walkTrail (loaded save) loses the mesh immediately', () => {
    const { state, employee, characters, rendered } = boardingSetup(false);
    sync(state, characters, rendered);
    expect(characters.count).toBe(0);
    expect(rendered.has(employee.id)).toBe(false);
    expect(characters.isRetiring(employee.id)).toBe(false);
  });

  it('no mesh is created for an already-hosted employee even when a walkTrail is present', () => {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 20, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 20, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.walkTrail = trailOf([{ x: 18, z: 10 }, { x: 19, z: 10 }, { x: 20, z: 10 }], 'board', 2, { x: 20, z: 10 });
    const characters = new CharacterMesh(new THREE.Scene());
    sync(state, characters, new Set());
    expect(characters.count).toBe(0);
  });

  it('an employee deleted while retiring is removed on the next sync', () => {
    const { state, employee, characters, rendered } = boardingSetup(true);
    sync(state, characters, rendered);
    expect(characters.isRetiring(employee.id)).toBe(true);

    state.employees.employees = state.employees.employees.filter((e: Employee) => e.id !== employee.id);
    sync(state, characters, rendered);

    expect(characters.count).toBe(0);
    expect(rendered.has(employee.id)).toBe(false);
    expect(characters.isRetiring(employee.id)).toBe(false);
  });

  it('a repeated sync while retiring neither duplicates nor restarts the walk', () => {
    const { state, employee, characters, rendered } = boardingSetup(true);
    sync(state, characters, rendered);
    frameUpdate(state, characters);
    const before = characters.getPosition(employee.id)!.x;
    sync(state, characters, rendered);
    expect(characters.count).toBe(1);
    expect(characters.getPosition(employee.id)!.x).toBe(before);
  });

  it('clearAll clears the retiring entry', () => {
    const { state, employee, characters, rendered } = boardingSetup(true);
    sync(state, characters, rendered);
    expect(characters.isRetiring(employee.id)).toBe(true);
    characters.clearAll();
    expect(characters.count).toBe(0);
    expect(characters.isRetiring(employee.id)).toBe(false);
  });

  it('board then alight in one batch: the mesh is hidden between the spans, never deleted', () => {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 10, 10);
    purchaseVehicle(state.vehicles, 'drill_rig', 12, 10);
    const characters = new CharacterMesh(new THREE.Scene());
    const rendered = new Set<number>();
    sync(state, characters, rendered);

    employee.x = 15;
    employee.z = 10;
    const pts = [10, 11, 12, 13, 14, 15].map(x => ({ x, z: 10 }));
    employee.walkTrail = {
      points: pts,
      relocated: false,
      hostMarkers: [
        { pointIndex: 2, event: 'board', hostKind: 'vehicle', hostX: 12, hostZ: 10 },
        { pointIndex: 4, event: 'alight', hostKind: 'vehicle', hostX: 12, hostZ: 10 },
      ],
    };
    sync(state, characters, rendered);

    let sawHidden = false;
    for (let f = 0; f < 80; f++) {
      frameUpdate(state, characters);
      expect(characters.count).toBe(1);
      if (!characters.getGroup(employee.id)!.visible) sawHidden = true;
    }
    expect(sawHidden).toBe(true);
    expect(characters.getGroup(employee.id)!.visible).toBe(true);
    expect(characters.getPosition(employee.id)!.x).toBeCloseTo(15, 6);
  });
});


// ── Mounted at batch start, hosted again or inside at batch end (#2224) ─────
// The mesh of an employee who steps out of a vehicle and into a building (or back onto a vehicle) inside one
// batch used to be skipped: syncEntitySets only drew people on foot at the end of the batch.

const DT = 1 / 64; // exact in binary
const SIZES = [1, 2, 4, 8] as const;

type HostEvent = 'board' | 'enter' | 'alight' | 'leave';

function multiTrail(points: Pt[], markers: Array<[number, HostEvent]>, host: Pt): MovementTrail {
  return {
    points,
    relocated: false,
    hostMarkers: markers.map(([pointIndex, event]) => ({
      pointIndex, event,
      hostKind: event === 'board' || event === 'alight' ? 'vehicle' : 'building',
      hostX: host.x, hostZ: host.z,
    })),
  };
}

const row = (from: number, to: number, z = 10): Pt[] => {
  const out: Pt[] = [];
  for (let x = from; x <= to; x++) out.push({ x, z });
  return out;
};

interface Seen { exists: boolean; visible: boolean; x: number; z: number }

function watch(state: ReturnType<typeof createGame>, characters: CharacterMesh, id: number, seconds: number): Seen[] {
  const out: Seen[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    characters.update(state.employees.employees, DT);
    const g = characters.getGroup(id);
    out.push({ exists: g !== null, visible: g?.visible === true, x: g?.position.x ?? NaN, z: g?.position.z ?? NaN });
  }
  return out;
}

describe('syncEntitySets — an employee mounted at batch start and inside a building at batch end is drawn (#2224)', () => {
  // driving_center at (10,10): its west ring cell is (9,10).
  function setup(rideCells: number, walkCells: number) {
    const state = createGame({ seed: SEED });
    const { building } = placeBuilding(state.buildings, 'driving_center', 10, 10, 64, 64);
    const alightX = 9 - walkCells;
    const rideStart = alightX - 1 - rideCells;
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), rideStart, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', rideStart, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const characters = new CharacterMesh(new THREE.Scene());
    const rendered = new Set<number>();
    sync(state, characters, rendered);
    expect(characters.count).toBe(0); // mounted at batch start: nothing drawn yet

    // The batch: the vehicle carries the employee to alightX - 1, they step out onto alightX and walk to the door.
    vehicle.x = alightX - 1;
    vehicle.occupantIds = [];
    employee.locomotion = { kind: 'on_foot' };
    employee.x = 9;
    employee.z = 10;
    expect(enterBuilding(state, building!.id, employee.id).success).toBe(true);
    const points = row(rideStart, 9);
    employee.walkTrail = multiTrail(points, [[rideCells + 1, 'alight'], [points.length - 1, 'enter']], { x: building!.x, z: building!.z });
    return { state, employee, vehicle, building: building!, characters, rendered, alightX, total: points.length - 1, rideCells };
  }

  for (const batch of SIZES) {
    it(`batch of ${batch}: the employee is drawn, hidden for the ride, then walks from the alight cell to the door and goes`, () => {
      const { state, employee, characters, rendered, alightX, total } = setup(batch, batch);
      sync(state, characters, rendered);

      expect(characters.count).toBe(1);
      expect(characters.isRetiring(employee.id)).toBe(true);
      expect(characters.getPosition(employee.id)!.x).toBeCloseTo(alightX, 6);

      const frames = watch(state, characters, employee.id, 3);
      const shown = frames.filter(f => f.visible);
      expect(shown.length).toBeGreaterThan(0);
      // Never drawn on the ride, never past the door, always on the row between the alight cell and the door.
      for (const f of shown) {
        expect(f.x).toBeGreaterThanOrEqual(alightX - 1e-6);
        expect(f.x).toBeLessThanOrEqual(9 + 1e-6);
        expect(f.z).toBeCloseTo(10, 6);
      }
      for (let i = 1; i < shown.length; i++) expect(shown[i]!.x).toBeGreaterThanOrEqual(shown[i - 1]!.x - 1e-9);
      expect(shown[shown.length - 1]!.x).toBeGreaterThanOrEqual(9 - (total / MOVE_TWEEN_DURATION_S) * DT * 2 - 1e-6);
      // Then the mesh is retired: nothing is left on screen.
      expect(frames[frames.length - 1]!.exists).toBe(false);
      expect(characters.count).toBe(0);
      expect(characters.isRetiring(employee.id)).toBe(false);
    });

    it(`batch of ${batch}: the ride is hidden for D * ride length / trail length`, () => {
      const { state, employee, characters, rendered, total, rideCells } = setup(batch, batch);
      sync(state, characters, rendered);
      const frames = watch(state, characters, employee.id, 3);
      const firstShown = frames.findIndex(f => f.visible);
      const expectedS = MOVE_TWEEN_DURATION_S * (rideCells + 1) / total;
      expect(firstShown).toBeGreaterThan(0);
      expect(Math.abs(firstShown * DT - expectedS)).toBeLessThanOrEqual(3 * DT);
    });
  }

  it('a repeated sync while the walk to the door plays neither adds a second mesh nor restarts it', () => {
    const { state, employee, characters, rendered } = setup(4, 4);
    sync(state, characters, rendered);
    watch(state, characters, employee.id, 1.0);
    const before = characters.getPosition(employee.id)!;
    sync(state, characters, rendered);
    sync(state, characters, rendered);
    expect(characters.count).toBe(1);
    const after = characters.getPosition(employee.id)!;
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it('the alight cell on the door ring (nothing to walk): the employee is still drawn, then goes', () => {
    const { state, employee, characters, rendered } = setup(4, 0);
    sync(state, characters, rendered);
    expect(characters.count).toBe(1);
    expect(characters.isRetiring(employee.id)).toBe(true);
    watch(state, characters, employee.id, 3);
    expect(characters.count).toBe(0);
  });

  it('is removed with the employee when they are deleted while the mesh is still hidden on the ride', () => {
    const { state, employee, characters, rendered } = setup(4, 4);
    sync(state, characters, rendered);
    state.employees.employees = state.employees.employees.filter((e: Employee) => e.id !== employee.id);
    sync(state, characters, rendered);
    expect(characters.count).toBe(0);
    expect(characters.isRetiring(employee.id)).toBe(false);
  });

  it('mounted at start and mounted again at the end (alight .. board): drawn walking to the vehicle, then retired', () => {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 6, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 6, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const characters = new CharacterMesh(new THREE.Scene());
    const rendered = new Set<number>();
    sync(state, characters, rendered);
    expect(characters.count).toBe(0);

    // Out at (8,10) after a 2-cell ride, a 4-cell walk to a second vehicle at (12,10), boarded.
    const second = purchaseVehicle(state.vehicles, 'drill_rig', 12, 10).vehicle;
    second.occupantIds = [employee.id];
    vehicle.occupantIds = [];
    employee.locomotion = { kind: 'mounted', vehicleId: second.id };
    employee.x = 12;
    employee.z = 10;
    employee.walkTrail = multiTrail(row(6, 12), [[3, 'alight'], [6, 'board']], { x: 8, z: 10 });
    sync(state, characters, rendered);

    expect(characters.count).toBe(1);
    expect(characters.isRetiring(employee.id)).toBe(true);
    const frames = watch(state, characters, employee.id, 3);
    const shown = frames.filter(f => f.visible);
    expect(shown.length).toBeGreaterThan(0);
    for (const f of shown) {
      expect(f.x).toBeGreaterThanOrEqual(9 - 1e-6); // the alight cell is (9,10), after the 3-cell ride
      expect(f.x).toBeLessThanOrEqual(12 + 1e-6);
    }
    expect(characters.count).toBe(0);
  });

  it('mounted at start with only a board marker (never left the vehicle): still nothing drawn', () => {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 6, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 6, 10);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.walkTrail = multiTrail(row(6, 9), [[0, 'board']], { x: 6, z: 10 });
    const characters = new CharacterMesh(new THREE.Scene());
    sync(state, characters, new Set());
    expect(characters.count).toBe(0);
  });

  it('a relocated trail with an alight marker draws nothing for a hosted employee', () => {
    const { state, employee, characters, rendered } = setup(2, 2);
    employee.walkTrail = { ...employee.walkTrail!, relocated: true };
    sync(state, characters, rendered);
    expect(characters.count).toBe(0);
  });
});

describe('syncEntitySets — vehicle and driver meshes follow one timeline (#2224)', () => {
  const START = 20;

  for (const batch of SIZES) {
    it(`boarding, batch of ${batch}: the vehicle mesh does not move in any frame the walking driver is visible`, () => {
      const state = createGame({ seed: SEED });
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), START - batch, 10);
      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', START, 10);
      const vehicles = new VehicleMesh(new THREE.Scene());
      const characters = new CharacterMesh(new THREE.Scene());
      const renderedV = new Set<number>();
      const renderedE = new Set<number>();
      const both = () => syncEntitySets(state, null, new Set(), vehicles, renderedV, characters, renderedE);
      both();
      expect(characters.count).toBe(1);

      const ride = 2 * batch;
      vehicle.x = START + ride;
      vehicle.walkTrail = {
        points: row(START, START + ride), relocated: false,
        hostMarkers: [{ pointIndex: 0, event: 'board', hostKind: 'vehicle', hostX: START, hostZ: 10, riderId: employee.id, riderArc: batch }],
      };
      vehicle.occupantIds = [employee.id];
      employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      employee.x = vehicle.x;
      employee.z = vehicle.z;
      employee.walkTrail = multiTrail(row(START - batch, START + ride), [[batch, 'board']], { x: START, z: 10 });
      both();

      let shown = 0;
      for (let i = 0; i < 96; i++) {
        characters.update(state.employees.employees, DT);
        vehicles.update(state.vehicles.vehicles, state.vehicles, state.employees.employees, DT);
        if (characters.getGroup(employee.id)?.visible) {
          shown++;
          expect(vehicles.getPosition(vehicle.id)!.x).toBeCloseTo(START, 2);
        }
      }
      expect(shown).toBeGreaterThan(0);
      expect(characters.count).toBe(0);
      expect(vehicles.getPosition(vehicle.id)!.x).toBeCloseTo(START + ride, 6);
    });

    it(`alighting, batch of ${batch}: the driver stays hidden until the vehicle mesh has stopped`, () => {
      const state = createGame({ seed: SEED });
      const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), START, 10);
      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', START, 10);
      vehicle.occupantIds = [employee.id];
      employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      const vehicles = new VehicleMesh(new THREE.Scene());
      const characters = new CharacterMesh(new THREE.Scene());
      const renderedV = new Set<number>();
      const renderedE = new Set<number>();
      const both = () => syncEntitySets(state, null, new Set(), vehicles, renderedV, characters, renderedE);
      both();
      expect(characters.count).toBe(0);

      const ride = 2 * batch;
      vehicle.x = START + ride;
      vehicle.occupantIds = [];
      vehicle.walkTrail = {
        points: row(START, START + ride), relocated: false,
        hostMarkers: [{ pointIndex: ride, event: 'alight', hostKind: 'vehicle', hostX: START + ride, hostZ: 10, riderId: employee.id, riderArc: ride }],
      };
      employee.locomotion = { kind: 'on_foot' };
      employee.x = START + ride + 1 + batch;
      employee.z = 10;
      employee.walkTrail = multiTrail(row(START, employee.x), [[ride + 1, 'alight']], { x: START + ride, z: 10 });
      both();
      expect(characters.count).toBe(1);

      let prevX = vehicles.getPosition(vehicle.id)!.x;
      let shown = 0;
      for (let i = 0; i < 96; i++) {
        characters.update(state.employees.employees, DT);
        vehicles.update(state.vehicles.vehicles, state.vehicles, state.employees.employees, DT);
        const vx = vehicles.getPosition(vehicle.id)!.x;
        if (characters.getGroup(employee.id)?.visible) {
          shown++;
          expect(Math.abs(vx - (START + ride))).toBeLessThanOrEqual(1);
          expect(Math.abs(vx - prevX)).toBeLessThan(1e-6);
        }
        prevX = vx;
      }
      expect(shown).toBeGreaterThan(0);
      expect(vehicles.getPosition(vehicle.id)!.x).toBeCloseTo(START + ride, 6);
    });
  }
});
