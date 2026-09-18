// BlastSimulator2026 — Unit tests: NavGridSync (#1146)
//
// `subscribeNavGridToUpdates` replaces the scattered manual
// `NavGrid.patchNavGrid` call sites with a single subscription to the
// `terrain:updated` event. These tests prove the subscription itself: that
// emitting the event patches whatever `getTarget()` currently returns, that
// `getTarget()` is re-read on every emit rather than cached, that a null
// target (pre-game) no-ops instead of throwing, and that two regions emitted
// in sequence each patch only their own area.

import { describe, it, expect } from 'vitest';
import { subscribeNavGridToUpdates, toFullHeightRegion } from '../../../src/core/nav/NavGridSync.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';

/** Create a solid voxel with optional overrides. */
function solidVoxel(overrides?: Partial<VoxelData>): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
    ...overrides,
  };
}

/** Build a VoxelGrid where every column has solid rock from y=0 to solidTopY (inclusive). */
function makeSolidGrid(sizeX: number, sizeY: number, sizeZ: number, solidTopY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= solidTopY; y++) {
        grid.setVoxel(x, y, z, solidVoxel());
      }
    }
  }
  return grid;
}

/** Full-height `terrain:updated` region covering the given X/Z bounds. */
function fullHeightRegion(minX: number, maxX: number, minZ: number, maxZ: number, grid: VoxelGrid) {
  return { minX, maxX, minY: 0, maxY: grid.sizeY - 1, minZ, maxZ };
}

const NO_BUILDINGS: Building[] = [];
const NO_HOLES: DrillHole[] = [];

describe('subscribeNavGridToUpdates', () => {
  it('patches the NavGrid for the emitted region, reflecting the current VoxelGrid state', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, NO_BUILDINGS, NO_HOLES);
    expect(nav.cells[3]![3]!.type).toBe('walkable');

    // Carve a hole in the VoxelGrid, out from under the already-built NavGrid.
    for (let y = 0; y <= 4; y++) grid.clearVoxel(3, y, 3);

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => ({
      navGrid: nav, grid, buildings: NO_BUILDINGS, drillHoles: NO_HOLES,
    }));

    emitter.emit('terrain:updated', { region: fullHeightRegion(3, 3, 3, 3, grid) });

    // Same outcome NavGrid.patchNavGrid produces directly: the carved column
    // is now void, and its move cost reflects that.
    expect(nav.cells[3]![3]!.type).toBe('void');
    expect(nav.cells[3]![3]!.moveCost).toBe(Infinity);
  });

  it('does not throw when getTarget() returns null (no live game state, e.g. pre-game)', () => {
    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => null);

    expect(() => {
      emitter.emit('terrain:updated', { region: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 } });
    }).not.toThrow();
  });

  it('calls getTarget() fresh on every emit rather than caching the first result', () => {
    const gridA = makeSolidGrid(6, 6, 6, 3);
    const navA = NavGrid.buildNavGrid(gridA, NO_BUILDINGS, NO_HOLES);
    const gridB = makeSolidGrid(6, 6, 6, 3);
    const navB = NavGrid.buildNavGrid(gridB, NO_BUILDINGS, NO_HOLES);

    // Simulate a `new_game` reset: getTarget starts by returning A's pair,
    // then is swapped to return B's pair between the two emits.
    let current: { navGrid: NavGrid; grid: VoxelGrid; buildings: Building[]; drillHoles: DrillHole[] } = {
      navGrid: navA, grid: gridA, buildings: NO_BUILDINGS, drillHoles: NO_HOLES,
    };

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => current);

    for (let y = 0; y <= 3; y++) gridA.clearVoxel(2, y, 2);
    emitter.emit('terrain:updated', { region: fullHeightRegion(2, 2, 2, 2, gridA) });
    expect(navA.cells[2]![2]!.type).toBe('void');
    // B is untouched by the first emit.
    expect(navB.cells[2]![2]!.type).toBe('walkable');

    // Swap the target — a fresh grid/navGrid pair, as `new_game` would produce.
    current = { navGrid: navB, grid: gridB, buildings: NO_BUILDINGS, drillHoles: NO_HOLES };

    for (let y = 0; y <= 3; y++) gridB.clearVoxel(4, y, 4);
    emitter.emit('terrain:updated', { region: fullHeightRegion(4, 4, 4, 4, gridB) });

    // Second emit patched B — proves getTarget() was re-read, not cached
    // from the first call.
    expect(navB.cells[4]![4]!.type).toBe('void');
  });

  it('patches the NavGrid identically when driven by nav:occupancy_changed instead of terrain:updated (#1161)', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, NO_BUILDINGS, NO_HOLES);
    expect(nav.cells[3]![3]!.type).toBe('walkable');

    // Carve a hole in the VoxelGrid, out from under the already-built NavGrid.
    for (let y = 0; y <= 4; y++) grid.clearVoxel(3, y, 3);

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => ({
      navGrid: nav, grid, buildings: NO_BUILDINGS, drillHoles: NO_HOLES,
    }));

    // nav:occupancy_changed carries the same region shape as terrain:updated
    // and must patch the NavGrid the same way — it exists to reach NavGrid
    // resync from an occupancy-only change that carved zero voxels, not to
    // skip the patch.
    emitter.emit('nav:occupancy_changed', { region: fullHeightRegion(3, 3, 3, 3, grid) });

    expect(nav.cells[3]![3]!.type).toBe('void');
    expect(nav.cells[3]![3]!.moveCost).toBe(Infinity);
  });

  it('calls getTarget() for nav:occupancy_changed too, and does not throw when it returns null (#1161)', () => {
    const emitter = new EventEmitter();
    let getTargetCalls = 0;
    const getTarget = (): null => {
      getTargetCalls++;
      return null;
    };
    subscribeNavGridToUpdates(emitter, getTarget);

    expect(() => {
      emitter.emit('nav:occupancy_changed', { region: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 } });
    }).not.toThrow();

    // getTarget must actually be reached from the nav:occupancy_changed
    // subscription (proving it is wired, not merely that nothing threw when
    // nothing was wired at all).
    expect(getTargetCalls).toBe(1);
  });

  it('two independent regions emitted in sequence each patch only their own area', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, NO_BUILDINGS, NO_HOLES);
    expect(nav.cells[1]![1]!.type).toBe('walkable');
    expect(nav.cells[8]![8]!.type).toBe('walkable');

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => ({
      navGrid: nav, grid, buildings: NO_BUILDINGS, drillHoles: NO_HOLES,
    }));

    for (let y = 0; y <= 4; y++) grid.clearVoxel(1, y, 1);
    emitter.emit('terrain:updated', { region: fullHeightRegion(1, 1, 1, 1, grid) });

    expect(nav.cells[1]![1]!.type).toBe('void');
    // The second region's column is still solid in the VoxelGrid, so it must
    // remain walkable — the first patch did not touch it.
    expect(nav.cells[8]![8]!.type).toBe('walkable');

    for (let y = 0; y <= 4; y++) grid.clearVoxel(8, y, 8);
    emitter.emit('terrain:updated', { region: fullHeightRegion(8, 8, 8, 8, grid) });

    // Both regions are now correctly patched, and the first region's result
    // was not disturbed by the second, region-scoped emit.
    expect(nav.cells[1]![1]!.type).toBe('void');
    expect(nav.cells[8]![8]!.type).toBe('void');
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
