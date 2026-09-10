// BlastSimulator2026 — Unit tests: ground-levelling voxel operations (#1009)
//
// Mirrors tests/unit/mining/Ramp.test.ts's own conventions (grid setup
// helpers, seeded-nothing pure functions, one positive/boundary/rejection
// case per exported function).

import { describe, it, expect, vi } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  computeLevelTargetY, computeLevelCells, computeLevelRegion,
  validateLevelOrder, carveLevelCells, computeLevelGroundDurationTicks,
  type LevelOrderDef,
} from '../../../src/core/mining/LevelGround.js';
import {
  LEVEL_GROUND_COST_PER_VOXEL,
  RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS, NAV_BENCH_HEIGHT,
} from '../../../src/core/config/balance.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

const ROCK = { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };

/**
 * Realistic (non-flat-from-0) terrain: solid rock from y=0 up to `surfaceY`
 * for every column — mirrors Ramp.test.ts's own makeElevatedGrid helper, so
 * `computeVoxelColumnSurfaceY`-style scans see a real surface rather than the
 * grid's own y=0 origin.
 */
function makeElevatedGrid(sizeX: number, sizeY: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= surfaceY; y++) grid.setVoxel(x, y, z, ROCK);
    }
  }
  return grid;
}

/**
 * A grid where every column in `[0, sizeX) x [0, sizeZ)` sits at `highY`,
 * except columns with `x < splitX`, which sit at `lowY` — a single
 * NAV_BENCH_HEIGHT-scale step running through the middle of the grid, for
 * "rect spans two benches" tests.
 */
function makeSteppedGrid(sizeX: number, sizeY: number, sizeZ: number, splitX: number, lowY: number, highY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const surface = x < splitX ? lowY : highY;
      for (let y = 0; y <= surface; y++) grid.setVoxel(x, y, z, ROCK);
    }
  }
  return grid;
}

describe('computeLevelTargetY', () => {
  it('returns the minimum surface height across a rect with mixed column heights', () => {
    const grid = makeSteppedGrid(20, 30, 20, 10, 8, 18);
    const rect: LevelOrderDef = { minX: 0, maxX: 19, minZ: 0, maxZ: 5 };

    expect(computeLevelTargetY(grid, rect)).toBe(8);
  });

  it('returns the shared height on a perfectly flat rect', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const rect: LevelOrderDef = { minX: 2, maxX: 10, minZ: 2, maxZ: 10 };

    expect(computeLevelTargetY(grid, rect)).toBe(15);
  });
});

describe('computeLevelCells', () => {
  it('contributes zero cells for a column already at target height', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const rect: LevelOrderDef = { minX: 2, maxX: 6, minZ: 2, maxZ: 6 };
    const targetY = computeLevelTargetY(grid, rect);

    const cells = computeLevelCells(grid, rect, targetY);
    expect(cells).toEqual([]);
  });

  it('clears every column down to the lower bench\'s surface, none below it, on a rect spanning two benches', () => {
    const lowY = 10;
    const highY = lowY + NAV_BENCH_HEIGHT; // one bench-height step
    const splitX = 10;
    const grid = makeSteppedGrid(20, 30, 10, splitX, lowY, highY);
    const rect: LevelOrderDef = { minX: 0, maxX: 19, minZ: 0, maxZ: 9 };

    const targetY = computeLevelTargetY(grid, rect);
    expect(targetY).toBe(lowY);

    const cells = computeLevelCells(grid, rect, targetY);

    // Every carved cell sits strictly above targetY (nothing below it is ever touched).
    for (const cell of cells) {
      expect(cell.y).toBeGreaterThan(targetY);
    }

    // Every column already at lowY (x < splitX) contributes no cells.
    const lowColumnCells = cells.filter(c => c.x < splitX);
    expect(lowColumnCells).toEqual([]);

    // Every column at highY (x >= splitX) contributes exactly the excess
    // above targetY: y in (targetY, highY], i.e. NAV_BENCH_HEIGHT cells.
    for (let x = splitX; x < 20; x++) {
      for (let z = 0; z <= 9; z++) {
        const columnCells = cells.filter(c => c.x === x && c.z === z);
        expect(columnCells.length).toBe(NAV_BENCH_HEIGHT);
        const ys = columnCells.map(c => c.y).sort((a, b) => a - b);
        expect(ys).toEqual(Array.from({ length: NAV_BENCH_HEIGHT }, (_, i) => targetY + 1 + i));
      }
    }
  });
});

describe('computeLevelRegion', () => {
  it('returns the bounding box of a non-empty cell set', () => {
    const cells = [
      { x: 3, y: 5, z: 8 },
      { x: 7, y: 2, z: 4 },
      { x: 1, y: 9, z: 6 },
    ];
    expect(computeLevelRegion(cells)).toEqual({ minX: 1, maxX: 7, minZ: 4, maxZ: 8 });
  });

  it('returns null for an empty cell set', () => {
    expect(computeLevelRegion([])).toBeNull();
  });
});

describe('validateLevelOrder', () => {
  const flatGrid = makeElevatedGrid(30, 30, 30, 15);
  const BASE_RECT: LevelOrderDef = { minX: 0, maxX: 9, minZ: 0, maxZ: 9 };

  it('accepts a valid rect with sufficient cash', () => {
    const result = validateLevelOrder(BASE_RECT, 1_000_000, flatGrid);
    expect(result.success).toBe(true);
  });

  it('rejects non-finite rect coordinates', () => {
    const result = validateLevelOrder({ minX: NaN, maxX: 9, minZ: 0, maxZ: 9 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects inverted rect coordinates (minX > maxX)', () => {
    const result = validateLevelOrder({ minX: 9, maxX: 0, minZ: 0, maxZ: 9 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects inverted rect coordinates (minZ > maxZ)', () => {
    const result = validateLevelOrder({ minX: 0, maxX: 9, minZ: 9, maxZ: 0 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects a rect exceeding MAX_LEVEL_GROUND_AREA', () => {
    // 21x20 = 420 > 400.
    const bigGrid = makeElevatedGrid(40, 30, 40, 15);
    const result = validateLevelOrder({ minX: 0, maxX: 20, minZ: 0, maxZ: 19 }, 100_000_000, bigGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('accepts a rect exactly at MAX_LEVEL_GROUND_AREA (boundary)', () => {
    // 20x20 = 400 exactly.
    const bigGrid = makeElevatedGrid(40, 30, 40, 15);
    const result = validateLevelOrder({ minX: 0, maxX: 19, minZ: 0, maxZ: 19 }, 100_000_000, bigGrid);
    expect(result.success).toBe(true);
  });

  it('rejects insufficient cash', () => {
    // A step ensures nonzero volume to clear, so a real cost is computed.
    const steppedGrid = makeSteppedGrid(20, 30, 20, 10, 10, 20);
    const result = validateLevelOrder({ minX: 0, maxX: 19, minZ: 0, maxZ: 9 }, 0, steppedGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });
});

describe('carveLevelCells', () => {
  it('clears only solid cells, reporting the count actually cleared', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const cells = [
      { x: 5, y: 15, z: 5 },
      { x: 6, y: 15, z: 5 },
      { x: 7, y: 15, z: 5 },
    ];
    grid.clearVoxel(6, 15, 5); // pre-cleared externally — must not be double-counted

    const result = carveLevelCells(grid, cells);
    expect(result.voxelsCleared).toBe(2);
    expect(grid.densityAt(5, 15, 5)).toBe(0);
    expect(grid.densityAt(7, 15, 5)).toBe(0);
  });

  it('is idempotent: calling it again on the same (now-cleared) cells returns 0 additional voxels cleared', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const cells = [
      { x: 5, y: 15, z: 5 },
      { x: 6, y: 15, z: 5 },
    ];

    const first = carveLevelCells(grid, cells);
    expect(first.voxelsCleared).toBe(2);

    const second = carveLevelCells(grid, cells);
    expect(second.voxelsCleared).toBe(0);
  });

  it('emits terrain:updated exactly once when it clears at least one voxel', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const cells = [{ x: 5, y: 15, z: 5 }];
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    carveLevelCells(grid, cells, emitter);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not emit terrain:updated when nothing is cleared (empty cell list)', () => {
    const grid = makeElevatedGrid(20, 30, 20, 15);
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveLevelCells(grid, [], emitter);
    expect(result.voxelsCleared).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Cost/duration scale linearly with volume ────────────────────────────────
//
// A single grid, uniform at height H except column x=0 which sits at height
// L — so a rect [0, n-1] x [row, row] has volume exactly (n-1)*(H-L): one
// zero-excess low corner plus (n-1) full-excess columns. A rect twice the
// width minus one (2*(n-1)+1 cells) therefore clears EXACTLY twice the
// voxels, giving an exact (not merely approximate) 2x cost/duration ratio.

describe('cost and duration scale linearly with volume', () => {
  const H = 20;
  const L = 10; // excess = 10 per full column
  const grid = makeSteppedGrid(30, 30, 3, 1, L, H); // only column x=0 is low (splitX=1)
  const row = 1;

  const rectA: LevelOrderDef = { minX: 0, maxX: 4, minZ: row, maxZ: row }; // 5 cells -> volume 4*10=40
  const rectB: LevelOrderDef = { minX: 0, maxX: 8, minZ: row, maxZ: row }; // 9 cells -> volume 8*10=80

  it('LEVEL_GROUND_COST_PER_VOXEL: cost for a rect moving 2x the voxels of a smaller rect is exactly 2x', () => {
    const targetA = computeLevelTargetY(grid, rectA);
    const targetB = computeLevelTargetY(grid, rectB);
    const volumeA = computeLevelCells(grid, rectA, targetA).length;
    const volumeB = computeLevelCells(grid, rectB, targetB).length;
    expect(volumeB).toBe(2 * volumeA);
    expect(volumeA).toBe(40);

    const resultA = validateLevelOrder(rectA, 1_000_000, grid);
    const resultB = validateLevelOrder(rectB, 1_000_000, grid);
    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(resultA.cost).toBe(volumeA * LEVEL_GROUND_COST_PER_VOXEL);
    expect(resultB.cost).toBe(volumeB * LEVEL_GROUND_COST_PER_VOXEL);
    expect(resultB.cost).toBe(2 * resultA.cost);
  });

  it('computeLevelGroundDurationTicks scales linearly with voxelCount', () => {
    const half = computeLevelGroundDurationTicks(400, 1);
    const full = computeLevelGroundDurationTicks(800, 1);
    // Both divide cleanly by RAMP_DIG_VOXELS_PER_TICK_TIER1 (8) at tier 1, so
    // ceil() rounding cannot mask a non-linear relationship.
    expect(half).toBe(400 / RAMP_DIG_VOXELS_PER_TICK_TIER1);
    expect(full).toBe(800 / RAMP_DIG_VOXELS_PER_TICK_TIER1);
    expect(full).toBe(2 * half);
  });

  it('a higher VehicleTier digs faster (fewer ticks) for the same volume — mirrors computeRampSegmentDurationTicks\'s tier handling', () => {
    const voxelCount = 64;
    const tier1Ticks = computeLevelGroundDurationTicks(voxelCount, 1);
    const tier3Ticks = computeLevelGroundDurationTicks(voxelCount, 3);

    const expectedTier1 = Math.max(1, Math.ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * VEHICLE_TIER_MULTIPLIERS[1].workRate)));
    const expectedTier3 = Math.max(1, Math.ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * VEHICLE_TIER_MULTIPLIERS[3].workRate)));

    expect(tier1Ticks).toBe(expectedTier1);
    expect(tier3Ticks).toBe(expectedTier3);
    expect(tier3Ticks).toBeLessThan(tier1Ticks);
  });

  it('computeLevelGroundDurationTicks returns at least 1 tick even for zero voxels', () => {
    expect(computeLevelGroundDurationTicks(0, 1)).toBeGreaterThanOrEqual(1);
  });
});
