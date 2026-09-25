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
  levelBuildingFootprint,
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

// `levelBuildingFootprint`'s contract is simplified (#1198): the widened-
// skirt carve region, the occupancy guard and the self-exclusion filter
// (#1144 review findings 1/2) are all removed — the function now levels
// EXACTLY the true footprint (x..x+sizeX-1, z..z+sizeZ-1) and nothing else,
// so the `buildings` list it used to need for the guard is gone from its
// signature. Direct coverage here per core-purity.md's "every exported
// function gets a unit test in the mirrored tests/unit/ path" convention.
describe('levelBuildingFootprint (#1198)', () => {
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

  it('happy path: carves exactly the true footprint (x..x+sizeX-1, z..z+sizeZ-1) — nothing beyond it', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // A column INSIDE the true footprint sits proud — must be carved.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1, 15, compId);
    // A column just OUTSIDE the true footprint (x = OWN_SIZE_X, the old
    // widened-skirt column) also sits proud — must be left entirely
    // untouched now that no widened region exists.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.targetY).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1)).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(15, 6);
    expect(result.region).not.toBeNull();
    expect(result.region!.maxX).toBeLessThan(OWN_SIZE_X);
    expect(result.region!.maxZ).toBeLessThan(OWN_SIZE_Z);
  });

  it('boundary: a 1x1 footprint carves only its own single column', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 15, compId);
    setVoxelColumnSurfaceHeight(grid, 1, 0, 15, compId); // just outside — must stay untouched

    const result = levelBuildingFootprint(grid, 0, 0, 1, 1);

    expect(result.targetY).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, 0, 0)).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, 1, 0)).toBeCloseTo(15, 6);
  });

  it('no-op: an already-level footprint clears 0 voxels', () => {
    const grid = flatGrid(10);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.voxelsCleared).toBe(0);
    expect(result.region).toBeNull();
  });

  it('two adjacent buildings, touching with zero gap: levelling one never carves into the true footprint of the other', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // Second building's true footprint starts exactly where the first one's
    // ends (touching, zero gap) — its origin column sits proud so a carve
    // that spilled over would be observable. No guard mechanism is needed
    // for this to hold — the carve simply never reaches past its own footprint.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.voxelsCleared).toBe(0);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(15, 6);
  });
});
