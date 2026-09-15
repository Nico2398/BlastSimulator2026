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
} from '../../../src/core/engine/BuildingTaskHelpers.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { placeBuilding, getBuildingDef } from '../../../src/core/entities/Building.js';
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
