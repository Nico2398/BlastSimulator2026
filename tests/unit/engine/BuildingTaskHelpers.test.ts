// BlastSimulator2026 — Unit tests: BuildingTaskHelpers (#1086)
//
// Core-owned relocation of src/console/commands/buildingHelpers.ts's pure
// building/footprint/nav-patch helpers. TaskCompletionEffects.ts's own tests
// already exercise these indirectly through applyTaskCompletion's
// place_building branch; these tests call each function directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect } from 'vitest';
import {
  makeFootprintRegion, siteBoundsForGrid, refreshLogisticsCapacity,
  levelBuildingFootprint, toFullHeightRegion,
} from '../../../src/core/engine/BuildingTaskHelpers.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid, setVoxelColumnSurfaceHeight, computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { placeBuilding, getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';
import { DEFAULT_GRID_SIZE } from '../../../src/core/config/balance.js';

const SEED = 42;

describe('makeFootprintRegion', () => {
  it('returns the rectangular region a sizeX x sizeZ footprint occupies, anchored at (x, z)', () => {
    expect(makeFootprintRegion(5, 10, 3, 2)).toEqual({ minX: 5, maxX: 7, minZ: 10, maxZ: 11 });
  });

  it('a 1x1 footprint is a single-cell region', () => {
    expect(makeFootprintRegion(0, 0, 1, 1)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  });
});

describe('siteBoundsForGrid', () => {
  it('returns the grid own bounding box when a grid exists', () => {
    const grid = new VoxelGrid(12, 8, 20);
    expect(siteBoundsForGrid(grid)).toEqual({ width: 12, depth: 20, originX: 0, originZ: 0 });
  });

  it('falls back to a DEFAULT_GRID_SIZE square at the origin when grid is null', () => {
    expect(siteBoundsForGrid(null)).toEqual({
      width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0,
    });
  });
});

describe('toFullHeightRegion (#1146)', () => {
  it('widens a 4-field footprint region to the full column height, preserving X/Z bounds', () => {
    const grid = new VoxelGrid(10, 20, 10);
    const region = { minX: 2, maxX: 5, minZ: 3, maxZ: 6 };

    const result = toFullHeightRegion(region, grid);

    expect(result).toEqual({ minX: 2, maxX: 5, minY: 0, maxY: grid.sizeY - 1, minZ: 3, maxZ: 6 });
  });

  it('a single-cell footprint region widens the same way', () => {
    const grid = new VoxelGrid(4, 8, 4);
    const region = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

    const result = toFullHeightRegion(region, grid);

    expect(result).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 7, minZ: 0, maxZ: 0 });
  });

  it('uses the given grid own sizeY, not a hardcoded height', () => {
    const shortGrid = new VoxelGrid(5, 3, 5);
    const tallGrid = new VoxelGrid(5, 50, 5);
    const region = { minX: 1, maxX: 1, minZ: 1, maxZ: 1 };

    expect(toFullHeightRegion(region, shortGrid).maxY).toBe(2);
    expect(toFullHeightRegion(region, tallGrid).maxY).toBe(49);
  });
});

describe('refreshLogisticsCapacity', () => {
  it('re-derives logistics storage capacity from the current warehouse total', () => {
    const state = createGame({ seed: SEED });

    const result = placeBuilding(state.buildings, 'freight_warehouse', 0, 0, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, 1, 0, 0);
    expect(result.success).toBe(true);

    refreshLogisticsCapacity(state);

    const expectedCapacity = getBuildingDef('freight_warehouse', 1).capacity;
    expect(state.logistics.storageCapacityKg).toBe(expectedCapacity);
  });
});

// `levelBuildingFootprint`'s occupancy guard and self-exclusion (#1144
// review findings 1/2) are only exercised indirectly today, through
// TaskCompletionEffects.test.ts's place_building branch. Direct coverage
// here per core-purity.md's "every exported function gets a unit test in
// the mirrored tests/unit/ path" and dev-testing-strategy's cheaper-in-
// isolation preference over the full integration path.
describe('levelBuildingFootprint (#1144)', () => {
  const ROCK_COMPOSITION = { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] };
  const { sizeX: OWN_SIZE_X, sizeZ: OWN_SIZE_Z } = getDefSize(getBuildingDef('driving_center', 1));

  /** A 10x10 (30-tall) grid, every column flat at `height`. */
  function flatGrid(height: number): VoxelGrid {
    const grid = new VoxelGrid(10, 30, 10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) setVoxelColumnSurfaceHeight(grid, x, z, height, compId);
    }
    return grid;
  }

  it('carves the widened skirt column (one past the true footprint) when nothing else occupies it', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // (OWN_SIZE_X, 0) is outside the true footprint (x: 0..OWN_SIZE_X-1) but
    // inside the widened carve region (makeLevelFootprintRegion) — needs carving.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);

    const buildings = [{ type: 'driving_center' as const, tier: 1 as const, x: 0, z: 0 }];
    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z, buildings);

    expect(result.targetY).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(10, 6);
    expect(result.region).not.toBeNull();
    expect(result.region!.maxX).toBeGreaterThanOrEqual(OWN_SIZE_X);
  });

  it("skips carving a widened skirt column that falls inside another building's true footprint", () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // (OWN_SIZE_X, 0) is both this building's widened skirt column AND the
    // origin of a second building placed touching it with zero gap.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);
    // An unguarded skirt column on the other side — proves the skip is
    // column-selective, not a blanket skip of the whole widened carve.
    setVoxelColumnSurfaceHeight(grid, 0, OWN_SIZE_Z, 15, compId);

    const buildings = [
      { type: 'driving_center' as const, tier: 1 as const, x: 0, z: 0 },
      { type: 'driving_center' as const, tier: 1 as const, x: OWN_SIZE_X, z: 0 },
    ];
    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z, buildings);

    // Guarded: the neighbour's own true footprint is left untouched.
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(15, 6);
    // Unguarded skirt column still carves down to targetY.
    expect(computeVoxelColumnSurfaceHeight(grid, 0, OWN_SIZE_Z)).toBeCloseTo(10, 6);
    expect(result.voxelsCleared).toBeGreaterThan(0);
  });

  it("self-exclusion: the building's own entry in `buildings` (matching x/z) does not block carving its own footprint", () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // A column INSIDE the true footprint sits proud — must still carve
    // despite `buildings` carrying this same building's own entry. Without
    // the self-exclusion filter, `others` would include this building and
    // isInsideAnyFootprint would report every one of its own columns as
    // "occupied", skipping the whole footprint from carving.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1, 15, compId);

    const buildings = [{ type: 'driving_center' as const, tier: 1 as const, x: 0, z: 0 }];
    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z, buildings);

    expect(result.voxelsCleared).toBeGreaterThan(0);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1)).toBeCloseTo(10, 6);
  });
});
