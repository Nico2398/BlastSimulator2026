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
import { subscribeNavGridToUpdates, regionForColumns } from '../../../src/core/nav/NavGridSync.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid, computeColumnRangeY, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';

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

/**
 * Write column (x, z) solid across `[topY - depth + 1, topY]` — the fixture
 * #1185's tests need to prove a column whose ground sits entirely below
 * y = 0 is reported with a genuinely negative surface, not clamped to 0. A
 * grid with no attached generator (every fixture below) has no natural fill,
 * so the column is otherwise pure air — `topY` alone decides where the
 * solid-to-air crossing sits.
 */
function writeSolidColumn(grid: VoxelGrid, x: number, z: number, topY: number, depth = 5): void {
  for (let y = topY - depth + 1; y <= topY; y++) grid.setVoxel(x, y, z, solidVoxel());
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

  it('patches correctly from a region carrying negative/unusual minY-maxY — patchNavGrid only reads X/Z (#1185)', () => {
    const grid = makeSolidGrid(10, 10, 10, 4);
    const nav = NavGrid.buildNavGrid(grid, NO_BUILDINGS, NO_HOLES);
    expect(nav.cells[3]![3]!.type).toBe('walkable');

    for (let y = 0; y <= 4; y++) grid.clearVoxel(3, y, 3);

    const emitter = new EventEmitter();
    subscribeNavGridToUpdates(emitter, () => ({
      navGrid: nav, grid, buildings: NO_BUILDINGS, drillHoles: NO_HOLES,
    }));

    // minY/maxY are nonsense on purpose (negative, and maxY < minY) — the
    // grid has no vertical cap any more (#1185), so a real producer can emit
    // values like these, and patchNavGrid must still recompute the column
    // correctly from X/Z alone.
    emitter.emit('terrain:updated', { region: { minX: 3, maxX: 3, minY: -400, maxY: -350, minZ: 3, maxZ: 3 } });

    expect(nav.cells[3]![3]!.type).toBe('void');
    expect(nav.cells[3]![3]!.moveCost).toBe(Infinity);
  });
});

describe('computeColumnRangeY (#1185)', () => {
  it('returns the floor/ceil span of ground across a rect with mixed column heights, skipping no-ground columns', () => {
    const grid = new VoxelGrid(10, 30, 10);
    writeSolidColumn(grid, 2, 2, 3); // surface height 3.5 -> floor 3, ceil 4
    writeSolidColumn(grid, 7, 7, 8); // surface height 8.5 -> floor 8, ceil 9
    // Every other column in [0,9]x[0,9] is left untouched (no ground at all).

    const result = computeColumnRangeY(grid, 0, 9, 0, 9);

    expect(result).toEqual({ minY: 3, maxY: 9 });
  });

  it('reports a negative minY/maxY for a rect whose ground sits entirely below y = 0, unclamped', () => {
    const grid = new VoxelGrid(10, 30, 10);
    writeSolidColumn(grid, 1, 1, -6); // surface height -5.5 -> floor -6, ceil -5
    writeSolidColumn(grid, 4, 4, -3); // surface height -2.5 -> floor -3, ceil -2

    const result = computeColumnRangeY(grid, 0, 9, 0, 9);

    expect(result).toEqual({ minY: -6, maxY: -2 });
    expect(result!.minY).toBeLessThan(0);
    expect(result!.maxY).toBeLessThan(0);
  });

  it('returns null when no column in the rect has any ground', () => {
    const grid = new VoxelGrid(10, 30, 10);
    // Ground exists elsewhere in the grid, but not inside this rect.
    writeSolidColumn(grid, 8, 8, 4);

    const result = computeColumnRangeY(grid, 0, 2, 0, 2);

    expect(result).toBeNull();
  });

  it('returns null for a rect entirely off-site (unowned columns)', () => {
    const grid = new VoxelGrid(10, 30, 10);
    writeSolidColumn(grid, 5, 5, 4);

    const result = computeColumnRangeY(grid, 100, 105, 100, 105);

    expect(result).toBeNull();
  });
});

describe('regionForColumns (#1185)', () => {
  it('derives minY/maxY from the real ground under the footprint, preserving the footprint X/Z bounds', () => {
    const grid = new VoxelGrid(10, 30, 10);
    writeSolidColumn(grid, 2, 2, 3); // surface height 3.5 -> floor 3, ceil 4
    writeSolidColumn(grid, 7, 7, 8); // surface height 8.5 -> floor 8, ceil 9

    const footprint: BlastRegion = { minX: 0, maxX: 9, minZ: 0, maxZ: 9 };
    const result = regionForColumns(footprint, grid);

    expect(result).toEqual({ minX: 0, maxX: 9, minY: 3, maxY: 9, minZ: 0, maxZ: 9 });
  });

  it('reports a negative minY/maxY when the footprint sits entirely below y = 0 (the case #1184 exists to enable)', () => {
    const grid = new VoxelGrid(10, 30, 10);
    writeSolidColumn(grid, 3, 3, -8); // surface height -7.5 -> floor -8, ceil -7

    const footprint: BlastRegion = { minX: 3, maxX: 3, minZ: 3, maxZ: 3 };
    const result = regionForColumns(footprint, grid);

    expect(result).toEqual({ minX: 3, maxX: 3, minY: -8, maxY: -7, minZ: 3, maxZ: 3 });
  });

  it('falls back to {minY:0, maxY:0} when the footprint rect has no ground anywhere', () => {
    const grid = new VoxelGrid(10, 30, 10);
    // No voxel ever written anywhere in the grid.

    const footprint: BlastRegion = { minX: 4, maxX: 5, minZ: 4, maxZ: 5 };
    const result = regionForColumns(footprint, grid);

    expect(result).toEqual({ minX: 4, maxX: 5, minY: 0, maxY: 0, minZ: 4, maxZ: 5 });
  });
});
