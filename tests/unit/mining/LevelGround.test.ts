// BlastSimulator2026 — Unit tests: ground-levelling voxel operations
// (#1009, continuous-height rewrite #1144)
//
// Mirrors tests/unit/mining/Ramp.test.ts's own conventions (grid setup
// helpers, seeded-nothing pure functions, one positive/boundary/rejection
// case per exported function).
//
// Fixture heights are written via setVoxelColumnSurfaceHeight (#1143) rather
// than a plain solid-block fill: a plain grid.setVoxel loop up to voxel index
// N leaves computeVoxelColumnSurfaceHeight reading back N + 0.5 (the
// solid-to-air crossing sits half a voxel above the topmost filled index),
// which would make every "exact height" assertion below wrong by half a
// voxel. setVoxelColumnSurfaceHeight round-trips exactly for an integer
// target and closely (see toBeCloseTo below) for a fractional one — see its
// own #1143 unit tests in tests/unit/world/VoxelGrid.test.ts.

import { describe, it, expect, vi } from 'vitest';
import {
  VoxelGrid, computeVoxelColumnSurfaceHeight, setVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import {
  computeLevelTargetY, computeLevelColumns, computeLevelVolume, computeLevelRegion,
  validateLevelOrder, carveLevelColumns, levelGroundRect, computeLevelGroundDurationTicks,
  type LevelOrderDef,
} from '../../../src/core/mining/LevelGround.js';
import {
  LEVEL_GROUND_COST_PER_VOXEL,
  RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS, NAV_BENCH_HEIGHT,
} from '../../../src/core/config/balance.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

const ROCK_COMPOSITION = { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] };

/** One shared interned compId per grid, for setVoxelColumnSurfaceHeight calls. */
function internRock(grid: VoxelGrid): number {
  return grid.palette.intern(ROCK_COMPOSITION);
}

/**
 * A grid where every column in `[0, sizeX) x [0, sizeZ)` sits at the exact
 * continuous `height` — built via setVoxelColumnSurfaceHeight so
 * computeVoxelColumnSurfaceHeight reads back `height` exactly (integer) or
 * closely (fractional), unlike a plain solid-block fill.
 */
function makeFlatGrid(sizeX: number, sizeZ: number, height: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  const compId = internRock(grid);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) setVoxelColumnSurfaceHeight(grid, x, z, height, compId);
  }
  return grid;
}

/**
 * A grid where every column in `[0, sizeX) x [0, sizeZ)` sits at `highHeight`,
 * except columns with `x < splitX`, which sit at `lowHeight` — a single step
 * running through the middle of the grid, for "rect spans two benches" tests.
 */
function makeSteppedGrid(
  sizeX: number, sizeZ: number, splitX: number, lowHeight: number, highHeight: number,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  const compId = internRock(grid);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      setVoxelColumnSurfaceHeight(grid, x, z, x < splitX ? lowHeight : highHeight, compId);
    }
  }
  return grid;
}

describe('computeLevelTargetY', () => {
  it('returns the minimum surface height across a rect with mixed column heights', () => {
    const grid = makeSteppedGrid(20, 20, 10, 8, 18);
    const rect: LevelOrderDef = { minX: 0, maxX: 19, minZ: 0, maxZ: 5 };

    expect(computeLevelTargetY(grid, rect)).toBe(8);
  });

  it('returns the shared height on a perfectly flat rect', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const rect: LevelOrderDef = { minX: 2, maxX: 10, minZ: 2, maxZ: 10 };

    expect(computeLevelTargetY(grid, rect)).toBe(15);
  });

  it('is driven by the continuous (fractional) minimum height, not one floored to an integer', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 5, 5, 8.3, compId);
    const rect: LevelOrderDef = { minX: 2, maxX: 10, minZ: 2, maxZ: 10 };

    // An integer-floor comparison would report 8 here; the true continuous
    // minimum is 8.3.
    expect(computeLevelTargetY(grid, rect)).toBeCloseTo(8.3, 6);
  });
});

describe('computeLevelColumns', () => {
  it('contributes zero columns for a rect already at target height', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const rect: LevelOrderDef = { minX: 2, maxX: 6, minZ: 2, maxZ: 6 };
    const targetY = computeLevelTargetY(grid, rect);

    expect(computeLevelColumns(grid, rect, targetY)).toEqual([]);
  });

  it('returns [] for a rect that is already perfectly flat in continuous terms', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const rect: LevelOrderDef = { minX: 3, maxX: 9, minZ: 3, maxZ: 9 };
    const targetY = computeLevelTargetY(grid, rect);

    expect(computeLevelColumns(grid, rect, targetY)).toEqual([]);
  });

  it('includes a column whose continuous height exceeds targetY though its integer floor matches (the literal defect)', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    // Two columns at 24.500, one at 24.622 — every column shares integer
    // floor 24, so the old Math.floor(height) === Math.floor(targetY)
    // comparison would treat all three as "already level" and skip the third.
    setVoxelColumnSurfaceHeight(grid, 0, 0, 24.5, compId);
    setVoxelColumnSurfaceHeight(grid, 1, 0, 24.5, compId);
    setVoxelColumnSurfaceHeight(grid, 2, 0, 24.622, compId);
    const rect: LevelOrderDef = { minX: 0, maxX: 2, minZ: 0, maxZ: 0 };

    const targetY = computeLevelTargetY(grid, rect);
    expect(targetY).toBeCloseTo(24.5, 6);

    const columns = computeLevelColumns(grid, rect, targetY);
    expect(columns).toContainEqual({ x: 2, z: 0 });
    expect(columns.some(c => c.x === 0 && c.z === 0)).toBe(false);
    expect(columns.some(c => c.x === 1 && c.z === 0)).toBe(false);
  });

  it('includes every column above targetY on a rect spanning two benches, one entry per column (not per voxel)', () => {
    const lowHeight = 10;
    const highHeight = lowHeight + NAV_BENCH_HEIGHT;
    const splitX = 10;
    const grid = makeSteppedGrid(20, 10, splitX, lowHeight, highHeight);
    const rect: LevelOrderDef = { minX: 0, maxX: 19, minZ: 0, maxZ: 9 };

    const targetY = computeLevelTargetY(grid, rect);
    expect(targetY).toBe(lowHeight);

    const columns = computeLevelColumns(grid, rect, targetY);

    // Every column already at lowHeight (x < splitX) contributes nothing.
    expect(columns.filter(c => c.x < splitX)).toEqual([]);

    // Every column at highHeight (x >= splitX) contributes exactly one entry.
    for (let x = splitX; x < 20; x++) {
      for (let z = 0; z <= 9; z++) {
        expect(columns.filter(c => c.x === x && c.z === z).length).toBe(1);
      }
    }
    expect(columns.length).toBe((20 - splitX) * 10);
  });
});

describe('computeLevelVolume', () => {
  it('sums continuous (fractional) height deltas across columns, not integer-rounded ones', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 20.5, compId);
    setVoxelColumnSurfaceHeight(grid, 1, 0, 20.25, compId);
    const columns = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    const targetY = 18;

    const volume = computeLevelVolume(grid, columns, targetY);
    expect(volume).toBeCloseTo((20.5 - 18) + (20.25 - 18), 6);
  });

  it('contributes zero for a column at or below targetY', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 10, compId);

    expect(computeLevelVolume(grid, [{ x: 0, z: 0 }], 15)).toBe(0);
  });

  it('returns 0 for an empty column list', () => {
    const grid = makeFlatGrid(10, 10, 12);
    expect(computeLevelVolume(grid, [], 10)).toBe(0);
  });
});

describe('computeLevelRegion', () => {
  it('returns the bounding box of a non-empty column set', () => {
    const columns = [
      { x: 3, z: 8 },
      { x: 7, z: 4 },
      { x: 1, z: 6 },
    ];
    expect(computeLevelRegion(columns)).toEqual({ minX: 1, maxX: 7, minZ: 4, maxZ: 8 });
  });

  it('returns null for an empty column set', () => {
    expect(computeLevelRegion([])).toBeNull();
  });
});

describe('validateLevelOrder', () => {
  const BASE_RECT: LevelOrderDef = { minX: 0, maxX: 9, minZ: 0, maxZ: 9 };

  it('accepts a valid rect with sufficient cash', () => {
    const flatGrid = makeFlatGrid(30, 30, 15);
    const result = validateLevelOrder(BASE_RECT, 1_000_000, flatGrid);
    expect(result.success).toBe(true);
  });

  it('reports zero cost and empty columns for a rect already flat in continuous terms', () => {
    const flatGrid = makeFlatGrid(30, 30, 15);
    const result = validateLevelOrder(BASE_RECT, 1_000_000, flatGrid);
    expect(result.success).toBe(true);
    expect(result.cost).toBe(0);
    expect(result.columns).toEqual([]);
  });

  it('computes a nonzero cost for a rect whose columns share an integer floor but differ fractionally (defect 1 regression)', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) setVoxelColumnSurfaceHeight(grid, x, z, 20.5, compId);
    }
    setVoxelColumnSurfaceHeight(grid, 5, 5, 20.622, compId); // same integer floor (20), fractionally proud

    const result = validateLevelOrder({ minX: 0, maxX: 9, minZ: 0, maxZ: 9 }, 1_000_000, grid);
    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.columns).toContainEqual({ x: 5, z: 5 });
  });

  it('rejects non-finite rect coordinates', () => {
    const flatGrid = makeFlatGrid(30, 30, 15);
    const result = validateLevelOrder({ minX: NaN, maxX: 9, minZ: 0, maxZ: 9 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects inverted rect coordinates (minX > maxX)', () => {
    const flatGrid = makeFlatGrid(30, 30, 15);
    const result = validateLevelOrder({ minX: 9, maxX: 0, minZ: 0, maxZ: 9 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects inverted rect coordinates (minZ > maxZ)', () => {
    const flatGrid = makeFlatGrid(30, 30, 15);
    const result = validateLevelOrder({ minX: 0, maxX: 9, minZ: 9, maxZ: 0 }, 1_000_000, flatGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('rejects a rect exceeding MAX_LEVEL_GROUND_AREA', () => {
    // 21x20 = 420 > 400.
    const bigGrid = makeFlatGrid(40, 40, 15);
    const result = validateLevelOrder({ minX: 0, maxX: 20, minZ: 0, maxZ: 19 }, 100_000_000, bigGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('accepts a rect exactly at MAX_LEVEL_GROUND_AREA (boundary)', () => {
    // 20x20 = 400 exactly.
    const bigGrid = makeFlatGrid(40, 40, 15);
    const result = validateLevelOrder({ minX: 0, maxX: 19, minZ: 0, maxZ: 19 }, 100_000_000, bigGrid);
    expect(result.success).toBe(true);
  });

  it('rejects insufficient cash', () => {
    // A step ensures nonzero volume to clear, so a real cost is computed.
    const steppedGrid = makeSteppedGrid(20, 20, 10, 10, 20);
    const result = validateLevelOrder({ minX: 0, maxX: 19, minZ: 0, maxZ: 9 }, 0, steppedGrid);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });
});

describe('carveLevelColumns', () => {
  it('carves every listed column down to targetY, reporting a nonzero cleared count', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const columns = [{ x: 5, z: 5 }, { x: 6, z: 5 }];

    const result = carveLevelColumns(grid, columns, 10);
    expect(result.voxelsCleared).toBeGreaterThan(0);
    expect(computeVoxelColumnSurfaceHeight(grid, 5, 5)).toBe(10);
    expect(computeVoxelColumnSurfaceHeight(grid, 6, 5)).toBe(10);
  });

  it('never raises a column already at or below targetY — zero contribution, height left untouched', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 8, compId); // already below the target

    const result = carveLevelColumns(grid, [{ x: 0, z: 0 }], 15);
    expect(result.voxelsCleared).toBe(0);
    expect(computeVoxelColumnSurfaceHeight(grid, 0, 0)).toBe(8);
  });

  it('carves a column fractionally proud of targetY down to exactly targetY (the literal bug fix)', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 24.622, compId);

    const result = carveLevelColumns(grid, [{ x: 0, z: 0 }], 24.5);
    expect(result.voxelsCleared).toBeGreaterThan(0);
    expect(computeVoxelColumnSurfaceHeight(grid, 0, 0)).toBeCloseTo(24.5, 6);
  });

  it('re-reads live height at carve time: a column already carved to target by something else contributes nothing (staleness guard)', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 0, 0, 24.622, compId);
    // Something else (e.g. a blast) already lowered it to the target before carveLevelColumns runs.
    setVoxelColumnSurfaceHeight(grid, 0, 0, 24.5, compId);

    const result = carveLevelColumns(grid, [{ x: 0, z: 0 }], 24.5);
    expect(result.voxelsCleared).toBe(0);
    expect(computeVoxelColumnSurfaceHeight(grid, 0, 0)).toBeCloseTo(24.5, 6);
  });

  it('emits terrain:updated exactly once when it clears at least one column', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    carveLevelColumns(grid, [{ x: 5, z: 5 }], 10, emitter);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not emit terrain:updated when nothing is cleared (empty column list)', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveLevelColumns(grid, [], 10, emitter);
    expect(result.voxelsCleared).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is idempotent: calling it again on the same now-levelled columns clears nothing more', () => {
    const grid = makeFlatGrid(20, 20, 15);
    const columns = [{ x: 5, z: 5 }, { x: 6, z: 5 }];

    const first = carveLevelColumns(grid, columns, 10);
    expect(first.voxelsCleared).toBeGreaterThan(0);

    const second = carveLevelColumns(grid, columns, 10);
    expect(second.voxelsCleared).toBe(0);
  });

  // ── #1185: the emitted terrain:updated region must span exactly the rows
  // actually levelled — floor(targetY)..ceil(highest pre-carve column height)
  // — not a full-grid 0..grid.sizeY-1 guess that means nothing now the grid
  // has no vertical cap.

  it('emits a region spanning exactly the levelled rows: minY = floor(targetY), maxY = ceil(highest pre-carve height carved) (#1185)', () => {
    const grid = new VoxelGrid(20, 20);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 5, 5, 18, compId);
    setVoxelColumnSurfaceHeight(grid, 6, 5, 12, compId);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveLevelColumns(grid, [{ x: 5, z: 5 }, { x: 6, z: 5 }], 10, emitter);

    expect(result.voxelsCleared).toBeGreaterThan(0);
    expect(handler).toHaveBeenCalledTimes(1);
    const region = handler.mock.calls[0]![0]!.region;
    expect(region).toEqual({ minX: 5, maxX: 6, minY: 10, maxY: 18, minZ: 5, maxZ: 5 });
  });

  it('rounds a fractional targetY and a fractional pre-carve height outward (floor for minY, ceil for maxY) (#1185)', () => {
    const grid = new VoxelGrid(20, 20);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 3, 3, 18.2, compId);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    carveLevelColumns(grid, [{ x: 3, z: 3 }], 10.5, emitter);

    const region = handler.mock.calls[0]![0]!.region;
    expect(region.minY).toBe(10); // floor(10.5)
    expect(region.maxY).toBe(19); // ceil(18.2)
  });

  it('a column already at target height (skipped by the staleness guard) does not widen the region\'s X/Z or Y bounds (#1185)', () => {
    const grid = new VoxelGrid(20, 20);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 5, 5, 18, compId);
    setVoxelColumnSurfaceHeight(grid, 6, 5, 12, compId);
    // Already at the target height and far outside the other two columns —
    // the staleness guard skips it entirely, so it must not appear in the
    // emitted region at all, on any axis.
    setVoxelColumnSurfaceHeight(grid, 15, 15, 10, compId);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveLevelColumns(grid, [{ x: 5, z: 5 }, { x: 6, z: 5 }, { x: 15, z: 15 }], 10, emitter);

    expect(result.voxelsCleared).toBeGreaterThan(0);
    expect(handler).toHaveBeenCalledTimes(1);
    const region = handler.mock.calls[0]![0]!.region;
    expect(region).toEqual({ minX: 5, maxX: 6, minY: 10, maxY: 18, minZ: 5, maxZ: 5 });
  });

  it('reports a negative minY/maxY when levelling terrain whose ground sits entirely below y = 0 (#1185)', () => {
    const grid = new VoxelGrid(20, 20);
    const compId = internRock(grid);
    setVoxelColumnSurfaceHeight(grid, 2, 2, -5, compId);
    setVoxelColumnSurfaceHeight(grid, 3, 2, -12, compId);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    // Level both columns down to the lower one's height (-12): only (2,2) is
    // actually carved, from -5 down to -12.
    const result = carveLevelColumns(grid, [{ x: 2, z: 2 }, { x: 3, z: 2 }], -12, emitter);

    expect(result.voxelsCleared).toBeGreaterThan(0);
    const region = handler.mock.calls[0]![0]!.region;
    expect(region.minY).toBe(-12);
    expect(region.maxY).toBe(-5);
    expect(region.minY).toBeLessThan(0);
    expect(region.maxY).toBeLessThan(0);
  });
});

describe('levelGroundRect', () => {
  it('cuts every column in the rect down to the same continuous height as the lowest one, in a single call', () => {
    const grid = makeSteppedGrid(20, 20, 2, 10, 13);

    const result = levelGroundRect(grid, { minX: 0, maxX: 3, minZ: 0, maxZ: 1 });

    expect(result.targetY).toBe(10);
    expect(result.voxelsCleared).toBeGreaterThan(0);
    for (let z = 0; z <= 1; z++) {
      for (let x = 0; x <= 3; x++) {
        expect(computeVoxelColumnSurfaceHeight(grid, x, z)).toBe(10);
      }
    }
    expect(result.region).toEqual({ minX: 2, maxX: 3, minZ: 0, maxZ: 1 });
  });

  it('levels a column integer-flush with target but fractionally proud of it (the literal defect 1 bug) — full round trip', () => {
    const grid = new VoxelGrid(10, 10);
    const compId = internRock(grid);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) setVoxelColumnSurfaceHeight(grid, x, z, 24.5, compId);
    }
    // Same integer floor (24) as every other column in the rect, but sits
    // fractionally above them — the old code skipped this column entirely.
    setVoxelColumnSurfaceHeight(grid, 1, 1, 24.622, compId);

    const result = levelGroundRect(grid, { minX: 0, maxX: 1, minZ: 0, maxZ: 1 });

    expect(result.targetY).toBeCloseTo(24.5, 6);
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 2; x++) {
        expect(computeVoxelColumnSurfaceHeight(grid, x, z)).toBeCloseTo(24.5, 6);
      }
    }
  });

  it('leaves already-level (continuous) ground untouched and reports nothing cleared', () => {
    const grid = makeFlatGrid(20, 20, 15);

    const result = levelGroundRect(grid, { minX: 4, maxX: 7, minZ: 4, maxZ: 7 });

    expect(result.targetY).toBe(15);
    expect(result.voxelsCleared).toBe(0);
    expect(result.region).toBeNull();
    expect(grid.densityAt(5, 15, 5)).toBeGreaterThan(0);
  });

  it('emits terrain:updated once when it carves, and not at all when it does not', () => {
    const stepped = makeSteppedGrid(20, 20, 2, 10, 13);
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    levelGroundRect(stepped, { minX: 0, maxX: 3, minZ: 0, maxZ: 1 }, emitter);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second pass over the now-level rect: nothing left to carve, nothing emitted.
    levelGroundRect(stepped, { minX: 0, maxX: 3, minZ: 0, maxZ: 1 }, emitter);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second call on the same rect clears nothing more', () => {
    const grid = makeSteppedGrid(20, 20, 2, 10, 13);

    const first = levelGroundRect(grid, { minX: 0, maxX: 3, minZ: 0, maxZ: 1 });
    const second = levelGroundRect(grid, { minX: 0, maxX: 3, minZ: 0, maxZ: 1 });

    expect(first.voxelsCleared).toBeGreaterThan(0);
    expect(second.voxelsCleared).toBe(0);
    expect(second.targetY).toBe(first.targetY);
  });
});

// ── Cost/duration scale linearly with volume ────────────────────────────────
//
// A single grid, uniform at height H except column x=0 which sits at height
// L — so a rect [0, n-1] x [row, row] has volume exactly (n-1)*(H-L): one
// zero-excess low corner plus (n-1) full-excess columns. A rect twice the
// width minus one (2*(n-1)+1 cells) therefore clears EXACTLY twice the
// volume, giving an exact (not merely approximate) 2x cost/duration ratio.

describe('cost and duration scale linearly with volume', () => {
  const H = 20;
  const L = 10; // excess = 10 per full column
  const grid = makeSteppedGrid(30, 3, 1, L, H); // only column x=0 is low (splitX=1)
  const row = 1;

  const rectA: LevelOrderDef = { minX: 0, maxX: 4, minZ: row, maxZ: row }; // 5 cols -> volume 4*10=40
  const rectB: LevelOrderDef = { minX: 0, maxX: 8, minZ: row, maxZ: row }; // 9 cols -> volume 8*10=80

  it('LEVEL_GROUND_COST_PER_VOXEL: cost for a rect moving 2x the continuous volume of a smaller rect is exactly 2x', () => {
    const targetA = computeLevelTargetY(grid, rectA);
    const targetB = computeLevelTargetY(grid, rectB);
    const volumeA = computeLevelVolume(grid, computeLevelColumns(grid, rectA, targetA), targetA);
    const volumeB = computeLevelVolume(grid, computeLevelColumns(grid, rectB, targetB), targetB);
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
