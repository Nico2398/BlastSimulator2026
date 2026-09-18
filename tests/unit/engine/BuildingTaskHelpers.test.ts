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
  makeFootprintRegion, siteBoundsForGrid, patchNavGrid, refreshLogisticsCapacity,
  levelBuildingFootprint,
} from '../../../src/core/engine/BuildingTaskHelpers.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid, setVoxelColumnSurfaceHeight, computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
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

describe('patchNavGrid', () => {
  function makeNavGrid(width: number, height: number, initialType: NavCell['type']): NavGrid {
    const cells: NavCell[][] = [];
    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        row.push({ type: initialType, moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
      }
      cells.push(row);
    }
    return new NavGrid(width, height, cells);
  }

  it('re-derives cell type/surface from the voxel grid for the given region', () => {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(5, 5, 5); // all-air: every column has no solid voxel
    state.navGrid = makeNavGrid(5, 5, 'walkable'); // stale — pre-patch, wrongly walkable

    patchNavGrid(state, grid, { minX: 2, maxX: 2, minZ: 2, maxZ: 2 });

    // computeSurfaceY(2,2) === -1 (no solid voxel in the column) classifies
    // as 'void' — proves the call actually delegated to NavGrid.patchNavGrid
    // with this state's own buildings/drillHoles rather than no-op'ing.
    expect(state.navGrid.cellAt(2, 2)!.type).toBe('void');
  });

  it('is a no-op when state has no navGrid', () => {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(5, 5, 5);
    expect(state.navGrid).toBeNull();
    expect(() => patchNavGrid(state, grid, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 })).not.toThrow();
    expect(state.navGrid).toBeNull();
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
