import { describe, it, expect } from 'vitest';
import { placeStartingBuildings, startingBuildingAnchor, resolveStartingSite, isStaffedComposition } from '../../../src/core/state/StartingBuildings.js';
import { createBuildingState, getDefSize, getBuildingDef, getStorageCapacity } from '../../../src/core/entities/Building.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import type { StartingBuildingSlot } from '../../../src/core/config/balance.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG, STARTING_BUILDING_STANDOFF_M, STARTING_SITE_STAFFED_COMPOSITION } from '../../../src/core/config/balance.js';

function solidVoxel(): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

function makeFlatGrid(size: number, topY = 1): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= topY; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

const WAREHOUSE: StartingBuildingSlot = { type: 'freight_warehouse', tier: 1 };

describe('placeStartingBuildings (#1363)', () => {
  it('places a tier-1 freight warehouse on flat ground and reports one placed', () => {
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 10, z: 10 });
    expect(placed).toBe(1);
    expect(buildings.buildings).toHaveLength(1);
    const b = buildings.buildings[0]!;
    expect(b.type).toBe('freight_warehouse');
    expect(b.tier).toBe(1);
    expect(b.active).toBe(true);
    expect(b.hp).toBe(getBuildingDef('freight_warehouse', 1).maxHp);
  });

  it('places the building close to the requested point', () => {
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 20, z: 20 });
    const b = buildings.buildings[0]!;
    expect(Math.hypot(b.x - 20, b.z - 20)).toBeLessThanOrEqual(8);
  });

  it('keeps the whole footprint inside the grid', () => {
    const buildings = createBuildingState();
    const grid = makeFlatGrid(40);
    placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 0, z: 0 });
    const b = buildings.buildings[0]!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.z).toBeGreaterThanOrEqual(0);
    expect(b.x + sizeX).toBeLessThanOrEqual(40);
    expect(b.z + sizeZ).toBeLessThanOrEqual(40);
  });

  it('provides the warehouse storage capacity', () => {
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 10, z: 10 });
    expect(getStorageCapacity(buildings)).toBeGreaterThanOrEqual(FREIGHT_WAREHOUSE_CAPACITY_KG[1]);
  });

  it('skips steep ground and settles on the flat part of the site', () => {
    // Left half is a cliff-like staircase (height varies each column), right half is flat.
    const size = 48;
    const grid = new VoxelGrid(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const top = x < 24 ? 1 + (x % 2) * 6 : 1;
        for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 6, z: 20 });
    expect(placed).toBe(1);
    expect(buildings.buildings[0]!.x).toBeGreaterThanOrEqual(24);
  });

  it('places several slots without overlap', () => {
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE, WAREHOUSE], { x: 10, z: 10 });
    expect(placed).toBe(2);
    const [a, b] = buildings.buildings as [typeof buildings.buildings[number], typeof buildings.buildings[number]];
    const overlapX = a.x < b.x + 4 && b.x < a.x + 4;
    const overlapZ = a.z < b.z + 4 && b.z < a.z + 4;
    expect(overlapX && overlapZ).toBe(false);
  });

  it('returns 0 for an empty slot list', () => {
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, makeFlatGrid(40), [], { x: 10, z: 10 })).toBe(0);
    expect(buildings.buildings).toHaveLength(0);
  });

  it('returns 0 and places nothing when no site fits (grid smaller than the footprint)', () => {
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, makeFlatGrid(3), [WAREHOUSE], { x: 1, z: 1 })).toBe(0);
    expect(buildings.buildings).toHaveLength(0);
  });

  it('returns 0 when the only ground is unbuildable (every column differs in height)', () => {
    const size = 24;
    const grid = new VoxelGrid(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const top = 1 + ((x + z) % 2) * 8;
        for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 12, z: 12 })).toBe(0);
  });
});

describe('startingBuildingAnchor (#1363)', () => {
  const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

  it('stands off from the crew centroid toward the site centre by the standoff distance', () => {
    const anchor = startingBuildingAnchor([{ x: 10, z: 50 }, { x: 20, z: 50 }], bounds);
    expect(anchor.x).toBeCloseTo(15 + STARTING_BUILDING_STANDOFF_M);
    expect(anchor.z).toBeCloseTo(50);
  });

  it('stands off east of the site centre for an empty crew (#1574)', () => {
    const anchor = startingBuildingAnchor([], bounds);
    expect(anchor.x).toBeCloseTo(50 + STARTING_BUILDING_STANDOFF_M);
    expect(anchor.z).toBeCloseTo(50);
  });

  it('does not move a crew already at the centre', () => {
    expect(startingBuildingAnchor([{ x: 50, z: 50 }], bounds)).toEqual({ x: 50, z: 50 });
  });
});

describe('resolveStartingSite (#1363)', () => {
  const levelSite = { employees: [], vehicles: [], buildings: [] };

  it('keeps the level site when staffed is absent', () => {
    expect(resolveStartingSite(levelSite, undefined)).toBe(levelSite);
  });

  it('uses the global staffed composition when staffed is true', () => {
    expect(resolveStartingSite(levelSite, true)).toBe(STARTING_SITE_STAFFED_COMPOSITION);
  });

  it('yields a bare site when staffed is false', () => {
    expect(resolveStartingSite(levelSite, false)).toBeUndefined();
  });
});

describe('isStaffedComposition (#1574)', () => {
  it('is false for an absent site and a heap-only site', () => {
    expect(isStaffedComposition(undefined)).toBe(false);
    expect(isStaffedComposition({ employees: [], vehicles: [], buildings: [] })).toBe(false);
  });

  it('is true for the global staffed composition', () => {
    expect(isStaffedComposition(STARTING_SITE_STAFFED_COMPOSITION)).toBe(true);
  });
});
