import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  buildRamp, RAMP_COST_PER_METER,
  validateRampOrder, defineRampSegments, carveRampSegment, computeRampSegmentDurationTicks,
  type RampDef, type RampDirection,
} from '../../../src/core/mining/Ramp.js';
import { MAX_RAMP_LENGTH, RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS } from '../../../src/core/config/balance.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';

function fillGrid(grid: VoxelGrid) {
  for (let z = 0; z < grid.sizeZ; z++)
    for (let y = 0; y < grid.sizeY; y++)
      for (let x = 0; x < grid.sizeX; x++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
}

/**
 * Scan a column top-down for the highest voxel with density >= 0.5 — same rule as
 * NavGrid.computeSurfaceY, kept independent here so the assertion below tests
 * observable behaviour (does the physical terrain change?) rather than reaching
 * into Ramp.ts's own computeColumnSurfaceY helper.
 */
function localSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const voxel = grid.getVoxel(x, y, z);
    if (voxel && voxel.density >= 0.5) return y;
  }
  return -1;
}

/**
 * Realistic (non-flat-from-0) terrain: solid rock from y=0 up to a surface well
 * above the ramp's carved depth range, mirroring real game terrain (surface ~y=23)
 * rather than the thin fillGrid() helper above, which happens to hide the
 * absolute-vs-relative-depth bug because its surface sits right where the ramp
 * carves anyway.
 */
function makeElevatedGrid(sizeX: number, sizeY: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= surfaceY; y++) {
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
  }
  return grid;
}

describe('Ramp building', () => {
  it('buildRamp modifies voxel grid to create a sloped passage', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    // fillGrid fills the column solid from y=0 to the grid's top, so the column's
    // actual surface (not y=0) is where carving starts (step 0 → currentDepth 0).
    const surfaceY = localSurfaceY(grid, 10, 10);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.voxelsCleared).toBeGreaterThan(0);

    // Check that voxels along the ramp path are cleared, at the column's real surface.
    const startVoxel = grid.getVoxel(10, surfaceY, 10);
    expect(startVoxel?.density).toBe(0);
  });

  it('ramp connects surface level to a lower elevation', () => {
    const grid = new VoxelGrid(20, 15, 30);
    fillGrid(grid);

    // fillGrid fills the column solid from y=0 to the grid's top, so the origin
    // column's real surface (not y=0) is where carving starts (step 0 → currentDepth 0).
    const originSurfaceY = localSurfaceY(grid, 10, 5);

    const result = buildRamp(grid, {
      originX: 10, originZ: 5, direction: 'south', length: 15, targetDepth: 10,
    }, 50000);

    expect(result.success).toBe(true);

    // At the start (step 0): should be cleared at the column's real surface.
    expect(grid.getVoxel(10, originSurfaceY, 5)?.density).toBe(0);

    // At the end (step 14): should be cleared at y≈9 (depth 10 * 14/15 ≈ 9.3 → floor=9)
    expect(grid.getVoxel(10, 9, 19)?.density).toBe(0);
  });

  it('ramp building deducts cost from finances', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(10 * RAMP_COST_PER_METER);
  });

  it('fails with insufficient funds', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50);

    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
  });

  it('lowers the local surface height along the path on realistic (elevated) terrain', () => {
    // Surface at y=22 — not flat-from-0 — matching a real game map's terrain height,
    // where the buggy absolute-Y carving lands deep underground and never touches
    // the topmost solid voxel, so the column's surface never visibly drops.
    const grid = makeElevatedGrid(20, 30, 30, 22);

    const originSurfaceBefore = localSurfaceY(grid, 10, 10);
    expect(originSurfaceBefore).toBe(22);

    const length = 15;
    const targetDepth = 8;
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length, targetDepth,
    }, 50000);

    expect(result.success).toBe(true);

    // Origin column (start of ramp, step 0) — should be measurably lower than
    // the untouched surface once the ramp is actually an open cut, not buried rock.
    const originSurfaceAfter = localSurfaceY(grid, 10, 10);
    const originDrop = originSurfaceBefore - originSurfaceAfter;
    expect(originDrop).toBeGreaterThan(0);
    expect(originDrop).toBeLessThanOrEqual(targetDepth);

    // End column (last carved step, z = originZ + length - 1) — should have
    // dropped substantially further than the origin, consistent with targetDepth.
    const endZ = 10 + length - 1;
    const endSurfaceAfter = localSurfaceY(grid, 10, endZ);
    const endDrop = originSurfaceBefore - endSurfaceAfter;
    expect(endDrop).toBeGreaterThan(originDrop);
    expect(endDrop).toBeGreaterThanOrEqual(targetDepth - 3);
    expect(endDrop).toBeLessThanOrEqual(targetDepth + 1);
  });

  it('does not affect surface height of columns far outside the ramp path', () => {
    const grid = makeElevatedGrid(20, 30, 30, 22);
    const farSurfaceBefore = localSurfaceY(grid, 2, 2);

    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    const farSurfaceAfter = localSurfaceY(grid, 2, 2);
    expect(farSurfaceAfter).toBe(farSurfaceBefore);
  });
});

// ── #555: ordered ramp excavation — validateRampOrder / defineRampSegments /
// carveRampSegment / computeRampSegmentDurationTicks ─────────────────────────
//
// Ramp excavation becomes work (mirrors #553/#554's drill_hole/charge_hole
// pattern): order-time only validates + prices the ramp (validateRampOrder),
// the corridor is split into one excavation segment per existing per-step
// loop iteration (defineRampSegments), and each segment is carved
// independently (carveRampSegment) as its dig_ramp_segment PendingAction
// completes. These tests are Red today only because the four functions are
// stubs (Ramp.ts) — buildRamp itself is unchanged and used here purely as
// the reference behavior the segmented path must reproduce.

const ALL_DIRECTIONS: RampDirection[] = ['north', 'south', 'east', 'west'];

describe('defineRampSegments + carveRampSegment vs buildRamp (#555)', () => {
  const RAMP: Omit<RampDef, 'direction'> = { originX: 20, originZ: 20, length: 8, targetDepth: 6 };

  for (const direction of ALL_DIRECTIONS) {
    it(`sequentially carving every segment reaches an identical final grid to buildRamp — direction ${direction}`, () => {
      const gridDirect = makeElevatedGrid(40, 30, 40, 15);
      const gridSegmented = makeElevatedGrid(40, 30, 40, 15);
      const ramp: RampDef = { ...RAMP, direction };

      const directResult = buildRamp(gridDirect, ramp, 100000);
      expect(directResult.success).toBe(true);

      const segments = defineRampSegments(gridSegmented, ramp);
      for (const segment of segments) {
        carveRampSegment(gridSegmented, segment);
      }

      const mismatches: string[] = [];
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y < 30; y++) {
          for (let z = 0; z < 40; z++) {
            const a = gridDirect.densityAt(x, y, z);
            const b = gridSegmented.densityAt(x, y, z);
            if (a !== b) mismatches.push(`(${x},${y},${z}): direct=${a} segmented=${b}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }

  it('a partial carve clears exactly the carved segments\' own declared cells, and leaves not-yet-applied segments solid', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    expect(segments.length).toBeGreaterThan(0);

    const half = Math.ceil(segments.length / 2);
    const carved = segments.slice(0, half);
    const uncarved = segments.slice(half);

    for (const segment of carved) carveRampSegment(grid, segment);

    // Every carved segment's own declared cells are now cleared.
    for (const segment of carved) {
      for (const cell of segment.cells) {
        expect(grid.densityAt(cell.x, cell.y, cell.z)).toBe(0);
      }
    }

    // Every not-yet-applied segment's cells remain solid.
    for (const segment of uncarved) {
      for (const cell of segment.cells) {
        expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
      }
    }

    // No voxel outside the carved segments' own declared cells was touched —
    // every originally-solid cell (y <= 15, the makeElevatedGrid surface) not
    // in a carved segment's own cell list must still be solid.
    const carvedCellKeys = new Set(
      carved.flatMap(segment => segment.cells.map(c => `${c.x},${c.y},${c.z}`)),
    );
    for (let x = 0; x < 40; x++) {
      for (let z = 0; z < 40; z++) {
        for (let y = 0; y <= 15; y++) {
          const key = `${x},${y},${z}`;
          if (carvedCellKeys.has(key)) continue;
          expect(grid.densityAt(x, y, z)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('carving a segment whose cells were already cleared externally reports voxelsCleared: 0 and does not throw', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    expect(segments.length).toBeGreaterThan(0);

    const segment = segments[0]!;
    const firstCarve = carveRampSegment(grid, segment);
    expect(firstCarve.voxelsCleared).toBeGreaterThan(0);

    expect(() => carveRampSegment(grid, segment)).not.toThrow();
    const secondCarve = carveRampSegment(grid, segment);
    expect(secondCarve.voxelsCleared).toBe(0);
  });

  it('a segment already cleared by an external caller before the segment is ever carved also reports voxelsCleared: 0', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    expect(segments.length).toBeGreaterThan(0);

    const segment = segments[0]!;
    for (const cell of segment.cells) grid.clearVoxel(cell.x, cell.y, cell.z);

    const result = carveRampSegment(grid, segment);
    expect(result.voxelsCleared).toBe(0);
  });
});

describe('computeRampSegmentDurationTicks (#555)', () => {
  it('is ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * tier workRate multiplier))', () => {
    const voxelCount = 64;
    const tier1Ticks = computeRampSegmentDurationTicks(voxelCount, 1);
    const tier3Ticks = computeRampSegmentDurationTicks(voxelCount, 3);

    const expectedTier1 = Math.max(
      1, Math.ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * VEHICLE_TIER_MULTIPLIERS[1].workRate)),
    );
    const expectedTier3 = Math.max(
      1, Math.ceil(voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * VEHICLE_TIER_MULTIPLIERS[3].workRate)),
    );

    expect(tier1Ticks).toBe(expectedTier1);
    expect(tier3Ticks).toBe(expectedTier3);
    // A higher tier's faster workRate multiplier means fewer ticks for the
    // same voxel count.
    expect(tier3Ticks).toBeLessThan(tier1Ticks);
  });

  it('returns at least 1 tick even for zero voxels', () => {
    expect(computeRampSegmentDurationTicks(0, 1)).toBeGreaterThanOrEqual(1);
  });

  it('returns at least 1 tick for a tiny voxel count that would otherwise round to 0', () => {
    expect(computeRampSegmentDurationTicks(1, 3)).toBeGreaterThanOrEqual(1);
  });
});

// ── #924: computeRampSegmentDurationTicks routes proficiency/need/
// living-quarters multipliers through computeTaskDuration, the same formula
// every other skill-gated task duration uses. The skeleton commit already
// wires this passthrough correctly (default args 1,1,1 reproduce the old
// formula exactly), so these assertions largely PASS today already — they
// lock in the correct direction/magnitude of each multiplier rather than
// exercising a still-stubbed branch (that's ActionSelection.test.ts below).

describe('computeRampSegmentDurationTicks — proficiency/need/lq scaling (#924)', () => {
  it('scales linearly with voxel count: doubling voxelCount doubles the ticks (all else equal)', () => {
    // Both reduce to a clean integer (1600/8=200, 800/8=100 at tier 1), so
    // ceil() rounding cannot mask a non-linear relationship here.
    const half = computeRampSegmentDurationTicks(800, 1, 1, 1, 1);
    const full = computeRampSegmentDurationTicks(1600, 1, 1, 1, 1);

    expect(half).toBe(100);
    expect(full).toBe(200);
    expect(full).toBe(2 * half);
  });

  it('a Master (level 5) proficiency produces fewer ticks than a Rookie (level 1), in the exact ratio of PROFICIENCY_MULTIPLIERS[5]/[1]', () => {
    // voxelCount=800, tier=1 -> baseTicks = 800 / (8 * 1.0) = 100 exactly, so
    // the proficiency multiplier alone determines the result with no
    // rounding noise.
    const rookieTicks = computeRampSegmentDurationTicks(800, 1, 1, 1, 1);
    const masterTicks = computeRampSegmentDurationTicks(800, 1, 5, 1, 1);

    expect(rookieTicks).toBe(100);
    expect(masterTicks).toBe(40); // 100 * (0.40 / 1.00)
    expect(masterTicks).toBeLessThan(rookieTicks);
  });

  it('a lower needMultiplier (e.g. a hungry/exhausted digger) raises ticks — computeTaskDuration divides by it, so productivity below 1.0 costs more time', () => {
    const fullNeeds = computeRampSegmentDurationTicks(800, 1, 1, 1, 1);
    const lowNeeds = computeRampSegmentDurationTicks(800, 1, 1, 0.5, 1);

    expect(fullNeeds).toBe(100);
    expect(lowNeeds).toBe(200); // 100 / 0.5
    expect(lowNeeds).toBeGreaterThan(fullNeeds);
  });

  it('a lower lqMultiplier (e.g. no living quarters / overcrowded) raises ticks the same way needMultiplier does', () => {
    const goodLq = computeRampSegmentDurationTicks(800, 1, 1, 1, 1);
    const poorLq = computeRampSegmentDurationTicks(800, 1, 1, 1, 0.8);

    expect(goodLq).toBe(100);
    expect(poorLq).toBe(125); // ceil(100 / 0.8)
    expect(poorLq).toBeGreaterThan(goodLq);
  });

  it('a zero (or near-zero) voxelCount floors to 1 tick regardless of tier, proficiency, or need/lq multipliers', () => {
    expect(computeRampSegmentDurationTicks(0, 1, 1, 1, 1)).toBe(1);
    expect(computeRampSegmentDurationTicks(0, 3, 5, 0.5, 0.5)).toBe(1);
    expect(computeRampSegmentDurationTicks(0, 1, 5, 1, 1)).toBe(1);
  });
});

describe('validateRampOrder (#555)', () => {
  const BASE_RAMP: RampDef = { originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 8 };

  it('accepts a valid order without mutating any grid, cost = RAMP_COST_PER_METER * length', () => {
    const result = validateRampOrder(BASE_RAMP, 50000);
    expect(result.success).toBe(true);
    expect(result.cost).toBe(BASE_RAMP.length * RAMP_COST_PER_METER);
  });

  it('rejects insufficient funds with the same message convention buildRamp uses today', () => {
    const totalCost = BASE_RAMP.length * RAMP_COST_PER_METER;
    const cash = 50;
    const result = validateRampOrder(BASE_RAMP, cash);
    expect(result.success).toBe(false);
    expect(result.message).toBe(`Insufficient funds: need $${formatMoney(totalCost)}, have $${formatMoney(cash)}`);
    expect(result.cost).toBe(0);
  });

  it('rejects a non-positive length with a finite-positive message', () => {
    const result = validateRampOrder({ ...BASE_RAMP, length: 0 }, 50000);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Invalid ramp length: length must be a finite positive number.');
    expect(result.cost).toBe(0);
  });

  it('rejects a non-positive target depth with buildRamp\'s own message', () => {
    const result = validateRampOrder({ ...BASE_RAMP, targetDepth: 0 }, 50000);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Target depth must be positive');
    expect(result.cost).toBe(0);
  });

  // #788 point 3: the length bound used to live only in buildRampCommand
  // (the console command) — it now lives here, in core, so every caller of
  // buildRamp/validateRampOrder is protected, not just the console.
  it('rejects a non-finite length, carrying a translation key for the console layer', () => {
    const result = validateRampOrder({ ...BASE_RAMP, length: Infinity }, 50000);
    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toContain('finite');
    expect(result.cost).toBe(0);
    expect(result.messageKey).toBe('mining.build_ramp.invalid_length');
  });

  it('rejects a length exceeding MAX_RAMP_LENGTH, naming the length and the limit, carrying a translation key + params', () => {
    const result = validateRampOrder({ ...BASE_RAMP, length: MAX_RAMP_LENGTH + 1 }, 50_000_000);
    expect(result.success).toBe(false);
    expect(result.message.toLowerCase()).toContain('too long');
    expect(result.message).toContain(String(MAX_RAMP_LENGTH + 1));
    expect(result.message).toContain(String(MAX_RAMP_LENGTH));
    expect(result.cost).toBe(0);
    expect(result.messageKey).toBe('mining.build_ramp.too_long');
    expect(result.messageParams).toEqual({ length: MAX_RAMP_LENGTH + 1, limit: MAX_RAMP_LENGTH });
  });

  it('accepts a length exactly at MAX_RAMP_LENGTH (boundary)', () => {
    const result = validateRampOrder({ ...BASE_RAMP, length: MAX_RAMP_LENGTH }, 50_000_000);
    expect(result.success).toBe(true);
  });
});
