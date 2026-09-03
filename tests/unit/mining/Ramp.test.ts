import { describe, it, expect, vi } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  buildRamp, RAMP_COST_PER_METER, RAMP_WIDTH,
  validateRampOrder, defineRampSegments, carveRampSegment, computeRampSegmentDurationTicks,
  computeRampSegmentCarveTarget, carveRampSegmentSlice,
  type RampDef, type RampDirection,
} from '../../../src/core/mining/Ramp.js';
import { MAX_RAMP_LENGTH, RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS } from '../../../src/core/config/balance.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

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

    // Layer-based grouping (#925): the topmost layer(s) are pure clearance
    // headroom above the (flat) surface and carve zero voxels — pick the
    // first layer that actually has solid cells rather than assuming
    // segments[0] does.
    const segment = segments.find(s => s.cells.length > 0)!;
    expect(segment).toBeDefined();
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

// ── #925: layered (bench) excavation order ────────────────────────────────
//
// defineRampSegments used to split the corridor into one segment per COLUMN
// (full depth carved at one (x,z) position before moving to the next),
// which mid-dig leaves a single deep notch at the column currently being
// worked while its neighbours sit untouched at the original surface height
// — "a half-dug ramp is a row of pits". This rework groups cells by
// absolute world Y instead: one segment per horizontal LAYER (bench),
// topmost first, each spanning every column in the footprint that still has
// a solid cell at that Y. Final geometry (the union of every segment's
// cells) is unchanged — only the grouping/order changes, which the
// "sequentially carving every segment reaches an identical final grid to
// buildRamp" tests above already lock in for all 4 directions.

describe('defineRampSegments — layered (bench) excavation order (#925)', () => {
  const RAMP: Omit<RampDef, 'direction'> = { originX: 20, originZ: 20, length: 8, targetDepth: 6 };

  it('orders segments index 0..N-1 strictly from the topmost Y (globalMaxY) to the bottommost Y (globalMinY) — targetY strictly decreases across adjacent segments', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    expect(segments.length).toBeGreaterThan(1);

    for (let i = 0; i < segments.length; i++) {
      expect(segments[i]!.index).toBe(i);
    }
    for (let i = 0; i + 1 < segments.length; i++) {
      expect(segments[i]!.targetY).toBeGreaterThan(segments[i + 1]!.targetY);
    }
  });

  it('each segment spans exactly one absolute Y row — region.minY === region.maxY === targetY when non-null (a layer, not a column)', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    const withRegion = segments.filter(s => s.region !== null);
    expect(withRegion.length).toBeGreaterThan(0);

    for (const segment of withRegion) {
      expect(segment.region!.minY).toBe(segment.region!.maxY);
      expect(segment.region!.minY).toBe(segment.targetY);
      for (const cell of segment.cells) {
        expect(cell.y).toBe(segment.targetY);
      }
    }
  });

  it('every cell in a deeper segment sits strictly below every cell in the segment immediately above it', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);
    expect(segments.length).toBeGreaterThan(1);

    for (let i = 0; i + 1 < segments.length; i++) {
      const upperCells = segments[i]!.cells;
      const lowerCells = segments[i + 1]!.cells;
      if (upperCells.length === 0 || lowerCells.length === 0) continue; // covered by the targetY-ordering test above
      const minUpperY = Math.min(...upperCells.map(c => c.y));
      const maxLowerY = Math.max(...lowerCells.map(c => c.y));
      expect(maxLowerY).toBeLessThan(minUpperY);
    }
  });

  it('a layer with zero solid cells (already cleared before defineRampSegments runs) still returns a segment with finite, in-range targetX/targetZ/targetY — region is null, the anchor is not', () => {
    const surfaceY = 15;
    const grid = makeElevatedGrid(40, 30, 40, surfaceY);
    const ramp: RampDef = { originX: 20, originZ: 20, direction: 'south', length: 8, targetDepth: 6 };

    // The topmost row every column in the footprint could contribute
    // (clearanceHeight=3 → ceilingY=surfaceY+3, so y=surfaceY+2 is within
    // every column's [floorY, ceilingY) band regardless of step) — clear it
    // for the whole footprint up front so defineRampSegments finds zero
    // solid cells there, forcing a null-region layer at the very top.
    const halfWidth = Math.floor(RAMP_WIDTH / 2);
    for (let w = -halfWidth; w <= halfWidth; w++) {
      for (let step = 0; step < ramp.length; step++) {
        grid.clearVoxel(ramp.originX + w, surfaceY + 2, ramp.originZ + step);
      }
    }

    const segments = defineRampSegments(grid, ramp);
    const emptyLayer = segments.find(s => s.region === null);
    expect(emptyLayer).toBeDefined();
    expect(emptyLayer!.index).toBe(0);
    expect(emptyLayer!.cells).toEqual([]);
    expect(Number.isFinite(emptyLayer!.targetX)).toBe(true);
    expect(Number.isFinite(emptyLayer!.targetZ)).toBe(true);
    expect(Number.isFinite(emptyLayer!.targetY)).toBe(true);
    expect(emptyLayer!.targetY).toBe(surfaceY + 2);
    // The anchor X/Z must still land within the ramp's own footprint, not
    // some arbitrary/default coordinate.
    expect(emptyLayer!.targetX).toBeGreaterThanOrEqual(ramp.originX - halfWidth);
    expect(emptyLayer!.targetX).toBeLessThanOrEqual(ramp.originX + halfWidth);
    expect(emptyLayer!.targetZ).toBeGreaterThanOrEqual(ramp.originZ);
    expect(emptyLayer!.targetZ).toBeLessThanOrEqual(ramp.originZ + ramp.length - 1);
  });

  it('the total cell count summed across all segments equals buildRamp\'s own voxelsCleared count for the same RampDef (final geometry is unchanged by the regrouping)', () => {
    const gridDirect = makeElevatedGrid(40, 30, 40, 15);
    const gridSegmented = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const buildResult = buildRamp(gridDirect, ramp, 100000);
    expect(buildResult.success).toBe(true);
    expect(buildResult.voxelsCleared).toBeGreaterThan(0);

    const segments = defineRampSegments(gridSegmented, ramp);
    const totalCells = segments.reduce((sum, s) => sum + s.cells.length, 0);
    expect(totalCells).toBe(buildResult.voxelsCleared);
  });

  // ── #937 regression: disjoint per-column [floorY, ceilingY) ranges ────────
  // Every fixture above uses flat terrain via makeElevatedGrid, so every
  // column's floor/ceiling band overlaps every other column's and Pass 2
  // never sees a y with zero contributing columns. This fixture forces that
  // gap: the footprint crosses a plateau→canyon→plateau step in surface
  // height, producing disjoint per-column ranges — regression coverage for
  // the Pass 2 guard (`if (bandMinX === Infinity) continue;`), which used to
  // instead emit a segment with NaN targetX/targetZ for a y with zero
  // contributing columns.

  function surfaceYAt(z: number): number {
    const stepOffset = z - 20; // originZ = 20
    return (stepOffset <= 1 || stepOffset >= 6) ? 20 : 5; // plateau(20) / canyon(5) / plateau(20)
  }

  function makeSteppedGrid(): VoxelGrid {
    const grid = new VoxelGrid(40, 30, 40);
    for (let z = 0; z < 40; z++) {
      const s = surfaceYAt(z);
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y <= s; y++) {
          grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
        }
      }
    }
    return grid;
  }

  it('on terrain with disjoint per-column floor/ceiling ranges (plateau→canyon→plateau), no segment has NaN/Infinity/undefined targetX/targetY/targetZ, index stays contiguous, and targetY strictly decreases', () => {
    const grid = makeSteppedGrid();
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(Number.isFinite(segment.targetX)).toBe(true);
      expect(Number.isFinite(segment.targetY)).toBe(true);
      expect(Number.isFinite(segment.targetZ)).toBe(true);
    }
    for (let i = 0; i < segments.length; i++) {
      expect(segments[i]!.index).toBe(i);
    }
    for (let i = 0; i + 1 < segments.length; i++) {
      expect(segments[i]!.targetY).toBeGreaterThan(segments[i + 1]!.targetY);
    }
  });

  it('skips exactly the y-band with zero contributing columns instead of emitting an invalid segment for it, and emits segments on both sides of the gap', () => {
    const grid = makeSteppedGrid();
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);

    // Hand-traced (clearanceHeight=3, currentDepth(step)=floor((step/8)*6)):
    // globalMinY=2, globalMaxY=22. Covered y = {2..7} ∪ {15..22}. The band
    // y=8..14 (7 values) has zero contributing columns and must be skipped
    // entirely, leaving 21 candidate y values - 7 skipped = 14 segments.
    expect(segments.length).toBe(14);
    for (const s of segments) {
      expect(s.targetY < 8 || s.targetY > 14).toBe(true);
    }
    expect(segments.some(s => s.targetY >= 2 && s.targetY <= 7)).toBe(true);
    expect(segments.some(s => s.targetY >= 15 && s.targetY <= 22)).toBe(true);
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

// ── #946: progressive ramp segment carving ────────────────────────────────
//
// Box-cut ramp digging used to carve a whole segment (a full horizontal
// layer) in one shot on completion — visually a slab vanishing at once.
// computeRampSegmentCarveTarget/carveRampSegmentSlice split that into a
// per-tick carve, proportional to the action's own tick progress, ordered
// nearest-to-entrance first (the existing array order defineRampSegments
// already produces). These tests are Red today only because both functions
// are stubs.

describe('computeRampSegmentCarveTarget (#946)', () => {
  it('returns 0 at 0 ticks elapsed', () => {
    expect(computeRampSegmentCarveTarget(10, 0, 5)).toBe(0);
  });

  it('returns floor(totalCells/2) at 50% elapsed', () => {
    // 11 cells, 50% elapsed -> floor(5.5) = 5, exercising the floor/rounding.
    expect(computeRampSegmentCarveTarget(11, 5, 10)).toBe(5);
    expect(computeRampSegmentCarveTarget(10, 2, 4)).toBe(5);
  });

  it('returns totalCells at 100% elapsed', () => {
    expect(computeRampSegmentCarveTarget(10, 5, 5)).toBe(10);
  });

  it('clamps to totalCells when ticksElapsed exceeds totalTicks', () => {
    expect(computeRampSegmentCarveTarget(10, 8, 5)).toBe(10);
    expect(computeRampSegmentCarveTarget(10, 1000, 5)).toBe(10);
  });

  it('returns totalCells when totalTicks <= 0, guarding against a divide-by-zero', () => {
    expect(computeRampSegmentCarveTarget(10, 3, 0)).toBe(10);
    expect(computeRampSegmentCarveTarget(10, 3, -2)).toBe(10);
    expect(computeRampSegmentCarveTarget(0, 0, 0)).toBe(0);
  });
});

describe('carveRampSegmentSlice (#946)', () => {
  /** 6 cells at distinct, individually addressable positions, all solid. */
  function makeSliceFixture(): { grid: VoxelGrid; cells: { x: number; y: number; z: number }[] } {
    const grid = new VoxelGrid(20, 10, 20);
    const cells = [0, 1, 2, 3, 4, 5].map(i => ({ x: 5 + i, y: 3, z: 5 }));
    for (const cell of cells) {
      grid.setVoxel(cell.x, cell.y, cell.z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0, oreDensities: {}, fractureModifier: 1.0,
      });
    }
    return { grid, cells };
  }

  it('carving [from, to) clears only that sub-range of cells', () => {
    const { grid, cells } = makeSliceFixture();

    const result = carveRampSegmentSlice(grid, cells, 2, 4);

    expect(result.voxelsCleared).toBe(2);
    // Inside the range: cleared.
    expect(grid.densityAt(cells[2]!.x, cells[2]!.y, cells[2]!.z)).toBe(0);
    expect(grid.densityAt(cells[3]!.x, cells[3]!.y, cells[3]!.z)).toBe(0);
    // Outside the range: untouched.
    expect(grid.densityAt(cells[0]!.x, cells[0]!.y, cells[0]!.z)).toBeGreaterThan(0);
    expect(grid.densityAt(cells[1]!.x, cells[1]!.y, cells[1]!.z)).toBeGreaterThan(0);
    expect(grid.densityAt(cells[4]!.x, cells[4]!.y, cells[4]!.z)).toBeGreaterThan(0);
    expect(grid.densityAt(cells[5]!.x, cells[5]!.y, cells[5]!.z)).toBeGreaterThan(0);
  });

  it('a cell already at density 0 within the range is skipped without being double-counted', () => {
    const { grid, cells } = makeSliceFixture();
    grid.clearVoxel(cells[3]!.x, cells[3]!.y, cells[3]!.z); // already cleared, e.g. by a blast

    const result = carveRampSegmentSlice(grid, cells, 2, 5); // range covers indices 2,3,4

    // Only indices 2 and 4 were actually cleared by this call — 3 was already gone.
    expect(result.voxelsCleared).toBe(2);
  });

  it("the returned region bboxes only the cells this call actually cleared, not the full segment/array", () => {
    const { grid, cells } = makeSliceFixture(); // cells span x=5..10

    const result = carveRampSegmentSlice(grid, cells, 1, 3); // clears cells[1] (x=6), cells[2] (x=7) only

    expect(result.region).not.toBeNull();
    expect(result.region!.minX).toBe(6);
    expect(result.region!.maxX).toBe(7);
    // Not the full cells array's span (x=5..10).
    expect(result.region!.minX).toBeGreaterThan(5);
    expect(result.region!.maxX).toBeLessThan(10);
  });

  it('emits terrain:updated exactly once when voxelsCleared > 0', () => {
    const { grid, cells } = makeSliceFixture();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    carveRampSegmentSlice(grid, cells, 0, 3);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not emit terrain:updated when the slice clears nothing', () => {
    const { grid, cells } = makeSliceFixture();
    for (const cell of cells) grid.clearVoxel(cell.x, cell.y, cell.z); // pre-cleared

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveRampSegmentSlice(grid, cells, 0, cells.length, emitter);

    expect(result.voxelsCleared).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('an empty slice (from === to) clears nothing and does not emit', () => {
    const { grid, cells } = makeSliceFixture();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveRampSegmentSlice(grid, cells, 2, 2, emitter);

    expect(result.voxelsCleared).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('driving a real segment through increasing elapsed fractions clears cells roughly proportionally, and exactly cells.length at 100%', () => {
    const grid = makeElevatedGrid(40, 30, 40, 15);
    const ramp: RampDef = { originX: 20, originZ: 20, direction: 'south', length: 8, targetDepth: 6 };
    const segments = defineRampSegments(grid, ramp);
    const segment = segments.find(s => s.cells.length >= 8)!;
    expect(segment).toBeDefined();

    const totalCells = segment.cells.length;
    const totalTicks = 4;
    let carvedSoFar = 0;
    const targets: number[] = [];

    for (let ticksElapsed = 1; ticksElapsed <= totalTicks; ticksElapsed++) {
      const target = computeRampSegmentCarveTarget(totalCells, ticksElapsed, totalTicks);
      expect(Number.isFinite(target)).toBe(true);
      expect(target).toBeGreaterThanOrEqual(carvedSoFar);
      expect(target).toBeLessThanOrEqual(totalCells);

      carveRampSegmentSlice(grid, segment.cells, carvedSoFar, target);
      carvedSoFar = target;
      targets.push(target);

      // Every cell carved so far is actually cleared; every cell not yet
      // reached is still solid — carving proceeds in the segment's own
      // (nearest-to-entrance-first) array order.
      for (let i = 0; i < totalCells; i++) {
        const cell = segment.cells[i]!;
        if (i < carvedSoFar) expect(grid.densityAt(cell.x, cell.y, cell.z)).toBe(0);
        else expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
      }
    }

    expect(carvedSoFar).toBe(totalCells);
    // Roughly proportional: the 50%-elapsed step (index 1, ticksElapsed=2)
    // should be well short of complete and well past empty.
    expect(targets[1]!).toBeGreaterThan(0);
    expect(targets[1]!).toBeLessThan(totalCells);
  });

  it('a 40+ cell segment worked over 5 ticks emits terrain:updated once per tick that made progress, not once per voxel', () => {
    // A wide, long footprint so a single (topmost) layer spans the whole
    // corridor — RAMP_WIDTH(3) * length(20) gives plenty of headroom over 40.
    const grid = makeElevatedGrid(60, 30, 60, 15);
    const ramp: RampDef = { originX: 20, originZ: 20, direction: 'south', length: 20, targetDepth: 6 };
    const segments = defineRampSegments(grid, ramp);
    const segment = segments.find(s => s.cells.length >= 40)!;
    expect(segment).toBeDefined();
    expect(segment.cells.length).toBeGreaterThanOrEqual(40);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const totalCells = segment.cells.length;
    const totalTicks = 5;
    let carvedSoFar = 0;
    for (let ticksElapsed = 1; ticksElapsed <= totalTicks; ticksElapsed++) {
      const target = computeRampSegmentCarveTarget(totalCells, ticksElapsed, totalTicks);
      carveRampSegmentSlice(grid, segment.cells, carvedSoFar, target, emitter);
      carvedSoFar = target;
    }

    expect(carvedSoFar).toBe(totalCells);
    // Bounded by ticks (5), not by cell count (40+) — the whole point of
    // slicing instead of emitting per-voxel.
    expect(handler).toHaveBeenCalledTimes(totalTicks);
    expect(handler.mock.calls.length).toBeLessThan(totalCells);
  });
});
