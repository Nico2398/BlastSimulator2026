import { describe, it, expect, vi } from 'vitest';
import {
  VoxelGrid, computeVoxelColumnSurfaceY, computeVoxelColumnSurfaceHeight, setVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import {
  buildRamp, RAMP_COST_PER_METER, RAMP_WIDTH,
  validateRampOrder, defineRampSegments, carveRampSegment, computeRampSegmentDurationTicks,
  computeRampSegmentCarveTarget, carveRampSegmentSlice, computeMinimumRampLength, isRampCellPending,
  type RampDef, type RampDirection, type RampSegmentDef,
} from '../../../src/core/mining/Ramp.js';
import { isStepClimbable } from '../../../src/core/nav/NavGrid.js';
import {
  MAX_RAMP_LENGTH, RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS, RAMP_CUT_SLOPE_RATIO,
  NAV_MAX_SLOPE_DEGREES,
} from '../../../src/core/config/balance.js';
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

    // length:15/targetDepth:8 (ratio 0.533) — must stay under RAMP_CUT_SLOPE_RATIO
    // (#1152, ~0.566) or validateRampOrder now refuses the order before this
    // test's carve-side assertions ever run.
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 15, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.voxelsCleared).toBeGreaterThan(0);

    // The origin (step 0) has zero continuous depth by design — a ramp
    // starts flush with the existing surface, not a voxel below it — so its
    // floor-row cell is re-banded back to that same continuous height
    // (#1151) rather than left as a hard, fully-cleared voxel: exactly 0.5,
    // the crossing density at an integer surface height
    // (VoxelGrid.surfaceDensityAt). It is still "solid" by the >=0.5
    // walkability threshold, correctly reproducing "no drop here".
    const startVoxel = grid.getVoxel(10, surfaceY, 10);
    expect(startVoxel?.density).toBe(0.5);
  });

  it('ramp connects surface level to a lower elevation', () => {
    const grid = new VoxelGrid(20, 15, 30);
    fillGrid(grid);

    // fillGrid fills the column solid from y=0 to the grid's top, so the origin
    // column's real surface (not y=0) is where carving starts (step 0 → currentDepth 0).
    const originSurfaceY = localSurfaceY(grid, 10, 5);

    // length:18/targetDepth:10 (ratio 0.556) — must stay under
    // RAMP_CUT_SLOPE_RATIO (#1152, ~0.566); length:15 (ratio 0.667) used to
    // work only because validateRampOrder didn't check slope yet.
    const length = 18;
    const result = buildRamp(grid, {
      originX: 10, originZ: 5, direction: 'south', length, targetDepth: 10,
    }, 50000);

    expect(result.success).toBe(true);

    // At the start (step 0): zero continuous depth by design, so the
    // floor-row cell is re-banded back to the original surface height
    // (#1151) rather than fully cleared — exactly 0.5, still "solid" by the
    // >=0.5 walkability threshold.
    expect(grid.getVoxel(10, originSurfaceY, 5)?.density).toBe(0.5);

    // At the last step (17 of 18): depth 10 * 17/18 ≈ 9.44, floor ≈
    // originSurfaceY(14) - 9.44 ≈ 4.56 — well below y=9, so y=9 is cleared.
    const endZ = 5 + length - 1;
    expect(grid.getVoxel(10, 9, endZ)?.density).toBe(0);
  });

  it('ramp building deducts cost from finances', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    // length:15/targetDepth:8 (ratio 0.533) — see slope note on the first test above.
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 15, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(15 * RAMP_COST_PER_METER);
  });

  it('fails with insufficient funds', () => {
    const grid = new VoxelGrid(20, 15, 20);
    fillGrid(grid);

    // length:15/targetDepth:8 (ratio 0.533, under RAMP_CUT_SLOPE_RATIO) — must
    // stay under the slope cap so this order is refused for insufficient
    // funds specifically, not for being too steep (#1152 checks slope before
    // charging cash).
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 15, targetDepth: 8,
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

    // Origin column (start of ramp, step 0) has zero continuous depth by
    // design — the ramp starts flush with the existing surface, not a voxel
    // below it — so continuous banding (#1151) re-grades its floor-row cell
    // back to that exact original height instead of leaving the hard,
    // fully-cleared voxel step the pre-#1151 rule produced. No drop at all
    // is the correct, un-buried outcome here.
    const originSurfaceAfter = localSurfaceY(grid, 10, 10);
    const originDrop = originSurfaceBefore - originSurfaceAfter;
    expect(originDrop).toBe(0);

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

    // length:15/targetDepth:8 (ratio 0.533) — see slope note above.
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 15, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    const farSurfaceAfter = localSurfaceY(grid, 2, 2);
    expect(farSurfaceAfter).toBe(farSurfaceBefore);
  });

  // #1148 — extends the "far outside the ramp path" check above from just the
  // surface index to every voxel in the column, and authors a genuine
  // fractional crossing on that far column so a stray touch would be visible
  // even if it happened well above the flat surface index.
  it('a column entirely outside the ramp path is bit-for-bit unchanged at every Y', () => {
    const grid = makeElevatedGrid(20, 30, 30, 22);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    setVoxelColumnSurfaceHeight(grid, 2, 2, 22.5, compId);

    const farBefore: number[] = [];
    for (let y = 0; y < grid.sizeY; y++) farBefore.push(grid.densityAt(2, y, 2));

    // length:15/targetDepth:8 (ratio 0.533) — see slope note above.
    const result = buildRamp(grid, {
      originX: 10, originZ: 10, direction: 'south', length: 15, targetDepth: 8,
    }, 50000);

    expect(result.success).toBe(true);
    for (let y = 0; y < grid.sizeY; y++) {
      expect(grid.densityAt(2, y, 2), `density at y=${y} should be unchanged`).toBe(farBefore[y]);
    }
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
  // length:11/targetDepth:6 (ratio 0.545) — length:8 (ratio 0.75) exceeded
  // RAMP_CUT_SLOPE_RATIO (#1152, ~0.566), so buildRamp's own validateRampOrder
  // call below would refuse the order before this describe's
  // defineRampSegments-vs-buildRamp comparisons ever ran.
  const RAMP: Omit<RampDef, 'direction'> = { originX: 20, originZ: 20, length: 11, targetDepth: 6 };

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

    // Every carved segment's own declared cells are now cleared — except a
    // column's own floor-row cell (`floorAdjustment` set), which continuous
    // banding (#1151) re-grades to the column's true continuous depth: a
    // residual crossing density in (0, 0.5], never a hard 0.
    for (const segment of carved) {
      for (const cell of segment.cells) {
        if (cell.floorAdjustment !== undefined) {
          expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
          expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeLessThanOrEqual(0.5);
        } else {
          expect(grid.densityAt(cell.x, cell.y, cell.z)).toBe(0);
        }
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

// ── #1148: post-carve renormalisation ─────────────────────────────────────
//
// carveRampSegment/carveRampSegmentSlice clear exactly the cells they're
// handed — they don't know about a column's own crossing band above those
// cells. A column authored with setVoxelColumnSurfaceHeight can carry a
// genuine fractional crossing (sub-threshold density) immediately above its
// real top; carving that real top's own cell must not leave that residue
// stranded, and the newly exposed top must read back as a well-formed band.

describe('carveRampSegment — post-carve renormalisation (#1148)', () => {
  function buildFractionalColumnFixture() {
    const grid = new VoxelGrid(20, 10, 20);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(5, y, 5, compId, undefined, 1);
    // Genuine fractional crossing above the real top: y=3 is the real top
    // (density >= 0.5), y=4 carries the residual sub-threshold crossing.
    setVoxelColumnSurfaceHeight(grid, 5, 5, 3.5, compId);
    return { grid, compId };
  }

  it('carving the column\'s real-top cell leaves no nonzero density strictly above the new top', () => {
    const { grid } = buildFractionalColumnFixture();

    const result = carveRampSegment(grid, {
      cells: [{ x: 5, y: 3, z: 5 }],
      region: { minX: 5, maxX: 5, minY: 3, maxY: 3, minZ: 5, maxZ: 5 },
    });

    expect(result.voxelsCleared).toBe(1);
    for (let y = 3; y < grid.sizeY; y++) {
      expect(grid.densityAt(5, y, 5), `density at y=${y} should be 0`).toBe(0);
    }
  });

  it('the carved floor\'s column is plain solid rock, not a manufactured crossing', () => {
    // Carving through the genuine crossing exposes plain, never-graded rock
    // below (y=0..2 were filled at density 1, not written via
    // setVoxelColumnSurfaceHeight): there is no natural crossing left to
    // preserve, so the new top stays a hard step rather than being smeared
    // into a fresh band that never existed pre-carve.
    const { grid } = buildFractionalColumnFixture();

    carveRampSegment(grid, {
      cells: [{ x: 5, y: 3, z: 5 }],
      region: { minX: 5, maxX: 5, minY: 3, maxY: 3, minZ: 5, maxZ: 5 },
    });

    const newTop = computeVoxelColumnSurfaceY(grid, 5, 5);
    expect(newTop).not.toBeNull();
    expect(newTop).toBe(2);
    expect(grid.densityAt(5, newTop!, 5)).toBe(1);
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
    // Deliberately not RAMP (length:8/targetDepth:6, ratio 0.75) — this test's
    // buildRamp call goes through validateRampOrder's new slope check
    // (#1152, cap ~0.566), unlike this describe's other, defineRampSegments-
    // only tests above, which don't validate and can keep using RAMP as-is.
    const ramp: RampDef = { originX: 20, originZ: 20, direction: 'south', length: 11, targetDepth: 6 };

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
    // plateau(20) → canyon(0) → bench(15). Terrain that *descends* along the
    // ramp is what forces the gap now (#1152): the floor is a straight line
    // from the ramp's own start elevation, so it no longer dives with the
    // terrain, while `ceilingY` still tracks each column's own local surface.
    // A later column whose local surface — and so its ceiling — sits below an
    // earlier column's floor contributes at no y the earlier ones do, and the
    // band between them has zero contributing columns. Before #1152 the floor
    // was read per column, so it followed the canyon down and the ranges
    // always overlapped; a plateau/canyon/plateau fixture no longer gaps.
    if (stepOffset <= 1) return 20;
    if (stepOffset <= 4) return 0;
    return 15;
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

  it('fills the canyon columns up to the floor line instead of leaving a gap y-band with zero contributing columns (#1172)', () => {
    const grid = makeSteppedGrid();
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const segments = defineRampSegments(grid, ramp);

    // Hand-traced (clearanceHeight=3, RAMP length 8 / targetDepth 6, so the
    // #1152 straight-line floor is f(step) = 20 - 0.75*step):
    //
    //   step 0-1  floor 20.00/19.25  local surface 20 → ceiling 23        → y 20,21,22
    //   step 2-4  floor 18.50..17.00 local surface  0 → floor > surface+3,
    //             a fill column (#1172): ceiling = max(surface, floor) + 3
    //             → y up to floor+3, contributing at its own floorRowY
    //             (19, 18 or 17) with a fillTarget cell instead of a gap.
    //   step 5-7  floor 16.25..14.75 local surface 15 → ceiling 18        → y 15,16,17
    //
    // globalMinY=14.75, globalMaxY=22 → every candidate y in 22..15 (8
    // values) now has a contributor — the canyon's own fill cells replace
    // what used to be the zero-contributor gap at y=18,19 (#1172 FILL
    // decision: a dip below the floor line is raised to it, not skipped).
    expect(segments.length).toBe(8);
    expect(segments.some(s => s.targetY === 18)).toBe(true);
    expect(segments.some(s => s.targetY === 19)).toBe(true);
    expect(segments.some(s => s.cells.some(c => c.fillTarget !== undefined))).toBe(true);
    expect(segments.some(s => s.targetY >= 20 && s.targetY <= 22)).toBe(true);
    expect(segments.some(s => s.targetY >= 15 && s.targetY <= 17)).toBe(true);
  });

  // ── #1152: floor is a pure constant-slope line anchored to the ramp's own
  // start elevation — it no longer reads local per-step terrain at all (not
  // even smoothed), so a single-column terrain spike can perturb this
  // column's headroom (ceilingY, which still tracks raw local surface) but
  // never its floor. Supersedes the pre-#1152 #1166 median3-smoothing test
  // that used to live here: median3 only rejected a single-column spike,
  // leaving a genuine multi-column feature free to bend the floor — #1152
  // removes local-terrain dependence entirely, so a floor line is imperturbed
  // by terrain of any width.

  /** Per-column solid-to-`surfaceY` grid, one column per z (ramp runs south, so
   * every column along the ramp shares the same x band). */
  function makeGridFromSurfaceFn(fn: (z: number) => number): VoxelGrid {
    const grid = new VoxelGrid(40, 30, 40);
    for (let z = 0; z < 40; z++) {
      const s = fn(z);
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y <= s; y++) {
          grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
        }
      }
    }
    return grid;
  }

  /** Maps each column's z to the y-row carrying that column's own
   * `floorAdjustment` — i.e. the column's own carved floor row. */
  function floorRowsByZ(segments: RampSegmentDef[]): Map<number, number> {
    const rows = new Map<number, number>();
    for (const segment of segments) {
      for (const cell of segment.cells) {
        if (cell.floorAdjustment !== undefined) rows.set(cell.z, cell.y);
      }
    }
    return rows;
  }

  /** Maps each column's z to the highest y it contributes any cell at across
   * every segment — the column's own top included row, which tracks ceilingY
   * (raw local surface + clearance), not the floor. */
  function topRowsByZ(segments: RampSegmentDef[]): Map<number, number> {
    const rows = new Map<number, number>();
    for (const segment of segments) {
      for (const cell of segment.cells) {
        const current = rows.get(cell.z);
        if (current === undefined || cell.y > current) rows.set(cell.z, cell.y);
      }
    }
    return rows;
  }

  it('a single-column terrain spike shifts that column\'s headroom (ceilingY) but leaves its carved floor row untouched', () => {
    const flatGrid = makeGridFromSurfaceFn(() => 20);
    // One lone column (z=24, step 4) sits one voxel lower than its flat
    // neighbours either side.
    const spikedGrid = makeGridFromSurfaceFn(z => (z === 24 ? 19 : 20));
    const ramp: RampDef = { ...RAMP, direction: 'south' };

    const flatSegments = defineRampSegments(flatGrid, ramp);
    const spikedSegments = defineRampSegments(spikedGrid, ramp);

    // Floor: identical, column for column — the floor no longer reads local
    // terrain at all, so a spike in raw surface height cannot move it.
    const flatFloors = floorRowsByZ(flatSegments);
    const spikedFloors = floorRowsByZ(spikedSegments);
    expect(spikedFloors.size).toBe(flatFloors.size);
    for (const [z, y] of flatFloors) {
      expect(spikedFloors.get(z)).toBe(y);
    }

    // Ceiling/headroom: the spiked column's own top included row does shift,
    // by exactly the spike's own 1-voxel drop, because ceilingY still tracks
    // that column's raw local surface.
    const flatTops = topRowsByZ(flatSegments);
    const spikedTops = topRowsByZ(spikedSegments);
    expect(flatTops.get(24)).toBeDefined();
    expect(spikedTops.get(24)).toBe(flatTops.get(24)! - 1);
    // Every other column's top row is unaffected by the one-column spike.
    for (const [z, y] of flatTops) {
      if (z === 24) continue;
      expect(spikedTops.get(z)).toBe(y);
    }
  });
});

// ── #1152: ramps are cut as a constant-slope road — floor descends by a
// fixed rise per metre of run, anchored to the ramp's own start elevation,
// regardless of local ground undulation along the way; level across the
// 3-cell width; capped under RAMP_CUT_SLOPE_RATIO.

describe('defineRampSegments — constant-slope floor geometry (#1152)', () => {
  /** Column-by-z solid terrain, like the #1152 describe above's helper, kept
   * local to this describe so a bump/dip shape can be authored per test. */
  function makeGridFromSurfaceFn(fn: (z: number) => number): VoxelGrid {
    const grid = new VoxelGrid(40, 30, 40);
    for (let z = 0; z < 40; z++) {
      const s = fn(z);
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y <= s; y++) {
          grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
        }
      }
    }
    return grid;
  }

  /** Per-column continuous floor height: `(floorRowY - 1) + floorAdjustment`
   * (the exact target `bandRampFloorColumn` grades that column's floor to),
   * keyed by z. */
  function floorHeightsByZ(segments: RampSegmentDef[]): Map<number, number> {
    const heights = new Map<number, number>();
    for (const segment of segments) {
      for (const cell of segment.cells) {
        if (cell.floorAdjustment !== undefined) {
          heights.set(cell.z, (cell.y - 1) + cell.floorAdjustment);
        }
      }
    }
    return heights;
  }

  const ORIGIN_X = 20;
  const ORIGIN_Z = 20;
  const LENGTH = 20;
  const TARGET_DEPTH = 10; // ratio 0.5, under RAMP_CUT_SLOPE_RATIO (~0.566)
  const ORIGIN_SURFACE_Y = 20;

  /** Straight-line floor target at `step`, anchored to the ramp's own start
   * elevation (ORIGIN_SURFACE_Y) — the formula #1152 requires, independent of
   * whatever the local column's own raw surface happens to read. */
  function expectedFloorHeight(step: number): number {
    return ORIGIN_SURFACE_Y - (step / LENGTH) * TARGET_DEPTH;
  }

  it('follows a straight line anchored to the ramp\'s start elevation across a mid-ramp bump, ignoring the bump\'s own local surface entirely', () => {
    // A sustained 3-column-wide bump (steps 8-10) raised 5m above the
    // surrounding flat terrain — wide enough that a per-column or
    // median-of-3 smoothing scheme would still treat it as a genuine terrain
    // feature and let it perturb the floor. #1152's floor formula must
    // ignore it completely regardless of width.
    const grid = makeGridFromSurfaceFn(z => {
      const step = z - ORIGIN_Z;
      return (step >= 8 && step <= 10) ? ORIGIN_SURFACE_Y + 5 : ORIGIN_SURFACE_Y;
    });
    const ramp: RampDef = { originX: ORIGIN_X, originZ: ORIGIN_Z, direction: 'south', length: LENGTH, targetDepth: TARGET_DEPTH };

    const floors = floorHeightsByZ(defineRampSegments(grid, ramp));

    for (let step = 0; step < LENGTH; step++) {
      const z = ORIGIN_Z + step;
      const actual = floors.get(z);
      expect(actual, `floor height missing for step ${step} (z=${z})`).toBeDefined();
      expect(actual!).toBeCloseTo(expectedFloorHeight(step), 6);
    }
  });

  // The mid-ramp-dip case (previously "cuts nothing where the dip already
  // sits below the line") moved to the "Ramp — fill across terrain dips
  // (#1172)" describe below: a dip below the line is now FILLED to reach it,
  // not left as an unwalkable notch.

  it('floor Y is identical across all 3 width columns at every step, even where terrain undulates', () => {
    const grid = makeGridFromSurfaceFn(z => {
      const step = z - ORIGIN_Z;
      return (step >= 8 && step <= 10) ? ORIGIN_SURFACE_Y + 5 : ORIGIN_SURFACE_Y;
    });
    const ramp: RampDef = { originX: ORIGIN_X, originZ: ORIGIN_Z, direction: 'south', length: LENGTH, targetDepth: TARGET_DEPTH };

    const segments = defineRampSegments(grid, ramp);

    // Group floor-row cells by z, then by x — every x at a given z must carry
    // the identical continuous floor height (ramp runs 'south', so width
    // varies in x).
    const byZThenX = new Map<number, Map<number, number>>();
    for (const segment of segments) {
      for (const cell of segment.cells) {
        if (cell.floorAdjustment === undefined) continue;
        const heights = byZThenX.get(cell.z) ?? new Map<number, number>();
        heights.set(cell.x, (cell.y - 1) + cell.floorAdjustment);
        byZThenX.set(cell.z, heights);
      }
    }

    expect(byZThenX.size).toBeGreaterThan(0);
    for (const [, heightsByX] of byZThenX) {
      const values = [...heightsByX.values()];
      expect(values.length).toBeGreaterThanOrEqual(1);
      for (const v of values) expect(v).toBeCloseTo(values[0]!, 6);
    }
  });

  it('the floor\'s overall slope never exceeds RAMP_CUT_SLOPE_RATIO, even at the steepest length/depth the order validator allows', () => {
    // Steepest depth/length ratio validateRampOrder is expected to allow
    // (fractionally above the minimum length's own boundary), computed
    // directly from RAMP_CUT_SLOPE_RATIO rather than via computeMinimumRampLength
    // (under test elsewhere), so if defineRampSegments' own floor line ever
    // exceeded the cap, it would be exceeded right here.
    const targetDepth = 10;
    const length = Math.ceil(targetDepth / RAMP_CUT_SLOPE_RATIO) + 1;
    const grid = makeGridFromSurfaceFn(() => ORIGIN_SURFACE_Y);
    const ramp: RampDef = { originX: ORIGIN_X, originZ: ORIGIN_Z, direction: 'south', length, targetDepth };

    const floors = floorHeightsByZ(defineRampSegments(grid, ramp));

    for (let step = 0; step + 1 < length; step++) {
      const a = floors.get(ORIGIN_Z + step);
      const b = floors.get(ORIGIN_Z + step + 1);
      if (a === undefined || b === undefined) continue;
      const rise = a - b; // positive: descending downhill
      expect(rise).toBeLessThanOrEqual(RAMP_CUT_SLOPE_RATIO + 1e-6);
    }
  });
});

// ── #1172: a ramp's straight floor line must be reached everywhere, even
// where existing terrain already dips below it. #1152 above only ever cuts
// (clears solid rock down to the line); a column whose ground already sits
// below the line emitted NO cell at all, leaving an unwalkable notch. This
// change FILLS those columns up to the line instead — same fixture shape as
// the #1152 dip test it replaces: a 3-column dip (steps 8-10) 5m below the
// surrounding flat terrain, on a 20-step ramp descending 10m from
// originSurfaceY 20. Steps 8 and 9 sit below the line (need fill); step 10's
// dip floor lands exactly on the line (an ordinary cut, nothing to fill).

describe('Ramp — fill across terrain dips (#1172)', () => {
  const ORIGIN_X = 20;
  const ORIGIN_Z = 20;
  const LENGTH = 20;
  const TARGET_DEPTH = 10; // ratio 0.5, under RAMP_CUT_SLOPE_RATIO (~0.566)
  const ORIGIN_SURFACE_Y = 20;
  /** Distinct from the ambient 'cruite' terrain, so a filled voxel's rock can
   * be told apart from a default/hardcoded composition (item 9). */
  const DIP_ROCK_ID = 'sandite';

  function expectedFloorHeight(step: number): number {
    return ORIGIN_SURFACE_Y - (step / LENGTH) * TARGET_DEPTH;
  }

  /** steps 8-10: 5m below the surrounding flat terrain. */
  function groundAt(step: number): number {
    return (step >= 8 && step <= 10) ? ORIGIN_SURFACE_Y - 5 : ORIGIN_SURFACE_Y;
  }

  /** Same per-column solid-to-surface shape as the #1152 describe's own
   * makeGridFromSurfaceFn, but the dip columns (steps 8-10) carry a distinct
   * rock composition from the ambient terrain (item 9). */
  function makeDipGrid(): VoxelGrid {
    const grid = new VoxelGrid(40, 30, 40);
    const ambientCompId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
    const dipCompId = grid.palette.intern({ rocks: [{ rockId: DIP_ROCK_ID, coefficient: 1.0 }] });
    for (let z = 0; z < 40; z++) {
      const step = z - ORIGIN_Z;
      const isDip = step >= 8 && step <= 10;
      const surface = groundAt(step);
      const compId = isDip ? dipCompId : ambientCompId;
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y <= surface; y++) {
          grid.fillVoxel(x, y, z, compId, undefined, 1.0);
        }
      }
    }
    return grid;
  }

  function makeDipRamp(): RampDef {
    return { originX: ORIGIN_X, originZ: ORIGIN_Z, direction: 'south', length: LENGTH, targetDepth: TARGET_DEPTH };
  }

  /** Every column's own floor-row contribution, whichever kind of cell it
   * carries: a `floorAdjustment` cut cell's continuous height, or a
   * `fillTarget` fill cell's target height. */
  function combinedFloorByZ(segments: RampSegmentDef[]): Map<number, number> {
    const heights = new Map<number, number>();
    for (const segment of segments) {
      for (const cell of segment.cells) {
        if (cell.floorAdjustment !== undefined) heights.set(cell.z, (cell.y - 1) + cell.floorAdjustment);
        else if (cell.fillTarget !== undefined) heights.set(cell.z, cell.fillTarget);
      }
    }
    return heights;
  }

  /** Carries out a full carve via defineRampSegments + carveRampSegment, in
   * declared segment order — the same pattern the "sequentially carving
   * every segment reaches an identical final grid to buildRamp" test (#555
   * describe above) uses. Returns totals summed across every segment. */
  function carveWholeRamp(grid: VoxelGrid, segments: RampSegmentDef[]): { voxelsCleared: number; voxelsFilled: number } {
    let voxelsCleared = 0;
    let voxelsFilled = 0;
    for (const segment of segments) {
      const result = carveRampSegment(grid, segment);
      voxelsCleared += result.voxelsCleared;
      voxelsFilled += result.voxelsFilled;
    }
    return { voxelsCleared, voxelsFilled };
  }

  // ── item 1: every step emits a floor cell, dip included ──────────────────

  it('emits a floor cell (floorAdjustment or fillTarget) for every step — no step is left with neither', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    const floors = combinedFloorByZ(segments);

    for (let step = 0; step < LENGTH; step++) {
      const z = ORIGIN_Z + step;
      expect(floors.get(z), `step ${step} (z=${z}) has neither floorAdjustment nor fillTarget`).toBeDefined();
      expect(floors.get(z)!).toBeCloseTo(expectedFloorHeight(step), 6);
    }
  });

  it('steps 8 and 9 (below the line, previously MISSING) carry a fillTarget cell set to the line height, not a floorAdjustment cut cell', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());

    for (const step of [8, 9]) {
      const z = ORIGIN_Z + step;
      const fillCells = segments.flatMap(s => s.cells).filter(c => c.z === z && c.fillTarget !== undefined);
      expect(fillCells.length, `step ${step} (z=${z}) has no fillTarget cell`).toBeGreaterThan(0);
      for (const cell of fillCells) {
        expect(cell.floorAdjustment).toBeUndefined();
        expect(cell.fillTarget!).toBeCloseTo(expectedFloorHeight(step), 6);
      }
    }
  });

  it('step 10 — dip ground exactly at the line — still gets an ordinary floorAdjustment cut cell, not a fillTarget', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    const z = ORIGIN_Z + 10;

    const cutCell = segments.flatMap(s => s.cells).find(c => c.z === z && c.floorAdjustment !== undefined);
    expect(cutCell).toBeDefined();
    expect(cutCell!.fillTarget).toBeUndefined();
  });

  // ── item 4: columns already at/above the line are unaffected ─────────────

  it('a column already at/above the line (outside the dip) is unaffected — ordinary floorAdjustment cut, no fillTarget', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    for (const step of [0, 4, 7, 11, 15, 19]) {
      const z = ORIGIN_Z + step;
      const cell = segments.flatMap(s => s.cells).find(c => c.z === z && c.floorAdjustment !== undefined);
      expect(cell, `step ${step} missing floorAdjustment cell`).toBeDefined();
      expect(cell!.fillTarget).toBeUndefined();
    }
  });

  // ── item 2 + 3: post-carve line integrity and walkability ────────────────

  it('after a full carve, every step\'s actual column height equals the straight line — including the dip, with no exception', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    carveWholeRamp(grid, segments);

    for (let step = 0; step < LENGTH; step++) {
      const z = ORIGIN_Z + step;
      const actual = computeVoxelColumnSurfaceHeight(grid, ORIGIN_X, z);
      expect(actual, `step ${step} (z=${z}) column height`).toBeCloseTo(expectedFloorHeight(step), 6);
    }
  });

  it('after a full carve, the ramp is walkable end to end — every adjacent step pair satisfies the real navmesh slope check (isStepClimbable)', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    carveWholeRamp(grid, segments);

    for (let step = 0; step + 1 < LENGTH; step++) {
      const fromY = computeVoxelColumnSurfaceHeight(grid, ORIGIN_X, ORIGIN_Z + step);
      const toY = computeVoxelColumnSurfaceHeight(grid, ORIGIN_X, ORIGIN_Z + step + 1);
      expect(isStepClimbable(fromY, toY, 1), `step ${step} -> ${step + 1} (${fromY} -> ${toY}) not climbable`).toBe(true);
    }
  });

  // ── item 5: no extra cash cost from filling ───────────────────────────────

  it('validateRampOrder\'s cost for the dip-crossing ramp order equals RAMP_COST_PER_METER * length — priced by length, not terrain/volume', () => {
    const ramp = makeDipRamp();
    const result = validateRampOrder(ramp, 1_000_000);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(LENGTH * RAMP_COST_PER_METER);

    // Same order, different origin (well away from the dip, so — were cost
    // ever terrain-derived — it would read flat ground instead): identical
    // cost, confirming the price tracks length alone (#1172 decision: no new
    // cash cost from filling).
    const flatElsewhere: RampDef = { ...ramp, originZ: 200 };
    const flatResult = validateRampOrder(flatElsewhere, 1_000_000);
    expect(flatResult.cost).toBe(result.cost);
  });

  // ── item 6: filled cells count as ticked work ─────────────────────────────

  it('carving the dip-crossing ramp reports voxelsFilled > 0 for the fill columns and voxelsCleared > 0 for the ordinary cut columns', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    const totals = carveWholeRamp(grid, segments);

    expect(totals.voxelsFilled).toBeGreaterThan(0);
    expect(totals.voxelsCleared).toBeGreaterThan(0);
  });

  // ── item 7: isRampCellPending direct unit tests ───────────────────────────

  describe('isRampCellPending', () => {
    it('a fillTarget cell whose column is still below the target reports pending (true)', () => {
      const grid = new VoxelGrid(10, 10, 10); // column (3,3) is entirely empty -> no ground (NaN height, #1184)
      const cell = { x: 3, y: 5, z: 3, fillTarget: 5 };
      expect(isRampCellPending(grid, cell)).toBe(true);
    });

    it('a fillTarget cell whose column has already reached (or exceeded) the target reports not pending (false)', () => {
      const grid = new VoxelGrid(10, 10, 10);
      const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
      setVoxelColumnSurfaceHeight(grid, 3, 3, 5, compId);

      expect(isRampCellPending(grid, { x: 3, y: 5, z: 3, fillTarget: 5 })).toBe(false);

      // Exceeding the target (filled higher than needed) is also "done".
      setVoxelColumnSurfaceHeight(grid, 3, 3, 6, compId);
      expect(isRampCellPending(grid, { x: 3, y: 5, z: 3, fillTarget: 5 })).toBe(false);
    });

    it('a plain cut cell (no fillTarget) with solid rock still at that exact voxel reports pending (true) — matches today\'s densityAt(...) > 0 check', () => {
      const grid = new VoxelGrid(10, 10, 10);
      grid.setVoxel(3, 5, 3, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      expect(isRampCellPending(grid, { x: 3, y: 5, z: 3 })).toBe(true);
    });

    it('a plain cut cell (no fillTarget) already cleared reports not pending (false)', () => {
      const grid = new VoxelGrid(10, 10, 10); // never filled -> density 0
      expect(isRampCellPending(grid, { x: 3, y: 5, z: 3 })).toBe(false);
    });
  });

  // ── item 8: idempotency ────────────────────────────────────────────────

  it('re-carving an already-filled dip segment reports voxelsFilled: 0 and voxelsCleared: 0 the second time — no double fill/charge', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());

    const first = carveWholeRamp(grid, segments);
    expect(first.voxelsFilled).toBeGreaterThan(0);

    const second = carveWholeRamp(grid, segments);
    expect(second.voxelsFilled).toBe(0);
    expect(second.voxelsCleared).toBe(0);
  });

  // ── item 9: fill material matches natural rock ────────────────────────────

  it('the filled voxels\' composition matches the dip column\'s own pre-existing rock, not a default/hardcoded composition', () => {
    const grid = makeDipGrid();
    const segments = defineRampSegments(grid, makeDipRamp());
    carveWholeRamp(grid, segments);

    for (const step of [8, 9]) {
      const z = ORIGIN_Z + step;
      const scanFrom = Math.floor(groundAt(step));
      const scanTo = Math.ceil(expectedFloorHeight(step)) + 1;
      const filledRocks: string[] = [];
      for (let y = scanFrom; y <= scanTo; y++) {
        if (grid.densityAt(ORIGIN_X, y, z) > 0) filledRocks.push(grid.dominantRockAt(ORIGIN_X, y, z));
      }
      expect(filledRocks.length, `step ${step} (z=${z}): no filled voxel found in [${scanFrom}, ${scanTo}]`).toBeGreaterThan(0);
      for (const rock of filledRocks) expect(rock).toBe(DIP_ROCK_ID);
    }
  });

  // ── item 11: stray-density sweep must not clip a fresh fill ──────────────

  it('a fill deeper than the stray-density sweep\'s own clipping window (SURFACE_BAND_HALF) reaches its full fillTarget height, not clipped back down', () => {
    // captureColumnTopsForCarve/renormaliseCarvedColumns (VoxelGrid.ts) sweep
    // only [oldTopY+1, oldTopY+SURFACE_BAND_HALF] above a column's pre-carve
    // top, an assumption that a carve only ever drops a column's top. A dip
    // deep enough that its fillTarget sits well past that window proves the
    // fill isn't silently clipped back down to near the old ground by that
    // sweep.
    const originSurfaceY = 30;
    const length = 20;
    const targetDepth = 4; // ratio 0.2, comfortably under RAMP_CUT_SLOPE_RATIO
    const originX = 20;
    const originZ = 20;
    const deepDipStep = 10;
    const lineAtDip = originSurfaceY - (deepDipStep / length) * targetDepth;
    // 8m below the line — far past SURFACE_BAND_HALF (1 voxel).
    const deepDipGround = lineAtDip - 8;

    const grid = new VoxelGrid(40, 40, 40);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
    for (let z = 0; z < 40; z++) {
      const step = z - originZ;
      const surface = step === deepDipStep ? deepDipGround : originSurfaceY;
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y <= Math.floor(surface); y++) {
          grid.fillVoxel(x, y, z, compId, undefined, 1.0);
        }
      }
    }

    const ramp: RampDef = { originX, originZ, direction: 'south', length, targetDepth };
    const segments = defineRampSegments(grid, ramp);
    for (const segment of segments) carveRampSegment(grid, segment);

    const finalHeight = computeVoxelColumnSurfaceHeight(grid, originX, originZ + deepDipStep);
    expect(finalHeight).toBeCloseTo(lineAtDip, 6);
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
  // length:10/targetDepth:5 (ratio 0.5) — targetDepth:8 (ratio 0.8) exceeded
  // RAMP_CUT_SLOPE_RATIO (#1152, ~0.566), which would trip the new
  // slope-too-steep rejection before any of these length/cash/depth-bound
  // checks got a chance to run.
  const BASE_RAMP: RampDef = { originX: 10, originZ: 10, direction: 'south', length: 10, targetDepth: 5 };

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

  // ── #1152: refuse an order whose length can't reach its depth within the
  // slope cap, before charging cash ────────────────────────────────────────

  describe('slope-too-steep rejection', () => {
    const targetDepth = 8;
    // Independent formula, not a call into the (stubbed) computeMinimumRampLength
    // under test elsewhere — this is the source-of-truth minimum a ramp of
    // this depth needs to stay under RAMP_CUT_SLOPE_RATIO.
    const minLength = targetDepth / RAMP_CUT_SLOPE_RATIO;
    // What the refusal *message* names, which is not the raw float above:
    // a ramp's length is a whole number of tiles, so the shortest orderable
    // length is the ceiling of the true minimum. `maxDegrees` names the
    // walkability limit the player is being held to (NAV_MAX_SLOPE_DEGREES),
    // not RAMP_CUT_SLOPE_RATIO's own 98% cut margin — the margin is internal
    // headroom against float rounding, not a rule the player can read off
    // the game's own slope limit.
    const displayMinLength = Math.ceil(minLength);

    it('rejects a length just under the minimum required for its depth, carrying a translation key + params, without charging cash', () => {
      const tooShortLength = minLength - 0.5;
      const result = validateRampOrder({ ...BASE_RAMP, targetDepth, length: tooShortLength }, 50_000_000);

      expect(result.success).toBe(false);
      expect(result.cost).toBe(0);
      expect(result.messageKey).toBe('mining.build_ramp.slope_too_steep');
      expect(result.messageParams?.depth).toBe(targetDepth);
      expect(result.messageParams?.length).toBe(tooShortLength);
      expect(result.messageParams?.minLength).toBe(displayMinLength);
      expect(result.messageParams?.maxDegrees).toBe(NAV_MAX_SLOPE_DEGREES);
    });

    it('rejects a too-steep order even with cash far exceeding its cost — the refusal is about slope, not affordability', () => {
      const tooShortLength = minLength - 0.5;
      // Cost at this length would be trivially affordable; a plain cash check
      // alone would accept this order, so success:false here proves the
      // slope gate fires independently of (and ahead of) the cash check.
      const result = validateRampOrder({ ...BASE_RAMP, targetDepth, length: tooShortLength }, 1_000_000_000);

      expect(result.success).toBe(false);
      expect(result.cost).toBe(0);
      expect(result.messageKey).toBe('mining.build_ramp.slope_too_steep');
    });

    it('accepts a length exactly at (or fractionally above) the computed minimum for its depth', () => {
      const result = validateRampOrder({ ...BASE_RAMP, targetDepth, length: minLength + 1e-6 }, 50_000_000);
      expect(result.success).toBe(true);
    });

    it('accepts a length comfortably above the computed minimum for its depth', () => {
      const result = validateRampOrder({ ...BASE_RAMP, targetDepth, length: minLength * 2 }, 50_000_000);
      expect(result.success).toBe(true);
    });
  });
});

describe('computeMinimumRampLength (#1152)', () => {
  it('returns targetDepth / RAMP_CUT_SLOPE_RATIO for a positive depth', () => {
    const targetDepth = 12;
    expect(computeMinimumRampLength(targetDepth)).toBeCloseTo(targetDepth / RAMP_CUT_SLOPE_RATIO, 10);
  });

  it('returns 0 for a zero depth', () => {
    expect(computeMinimumRampLength(0)).toBe(0);
  });

  it('returns 0 for a negative depth', () => {
    expect(computeMinimumRampLength(-5)).toBe(0);
  });

  it('scales linearly with depth: doubling targetDepth doubles the minimum length', () => {
    const half = computeMinimumRampLength(10);
    const full = computeMinimumRampLength(20);
    expect(full).toBeCloseTo(2 * half, 10);
  });

  it('handles a large depth without overflow or precision loss', () => {
    const targetDepth = 5000;
    expect(computeMinimumRampLength(targetDepth)).toBeCloseTo(targetDepth / RAMP_CUT_SLOPE_RATIO, 6);
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

    carveRampSegmentSlice(grid, cells, 0, 3, emitter);

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
      // (nearest-to-entrance-first) array order. A column's own floor-row
      // cell (`floorAdjustment` set) is the one exception: continuous
      // banding (#1151) re-grades it to the column's true continuous depth,
      // a residual crossing density in (0, 0.5], never a hard 0.
      for (let i = 0; i < totalCells; i++) {
        const cell = segment.cells[i]!;
        if (i < carvedSoFar) {
          if (cell.floorAdjustment !== undefined) {
            expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
            expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeLessThanOrEqual(0.5);
          } else {
            expect(grid.densityAt(cell.x, cell.y, cell.z)).toBe(0);
          }
        } else {
          expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
        }
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

  it('#1148: widens the emitted terrain:updated region\'s maxY to include renormalisation past the raw carved cell', () => {
    const grid = new VoxelGrid(20, 10, 20);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
    const X = 5, Z = 5, TOP_Y = 3;
    for (let y = 0; y <= TOP_Y; y++) grid.fillVoxel(X, y, Z, compId, undefined, 1);
    // Stray sub-threshold residue stranded one cell above the real top — the
    // carve below removes the real top, exposing this leftover crossing that
    // renormalisation must sweep away, one cell past the carve's own cell.
    grid.fillVoxel(X, TOP_Y + 1, Z, compId, undefined, 0.3);

    const cells = [{ x: X, y: TOP_Y, z: Z }];

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = carveRampSegmentSlice(grid, cells, 0, 1, emitter);

    expect(result.voxelsCleared).toBe(1);
    // The raw carved cell's own Y is TOP_Y, but renormalisation reaches one
    // cell higher to clear the stranded residue — the region must widen to match.
    expect(result.region!.maxY).toBe(TOP_Y + 1);
    expect(grid.densityAt(X, TOP_Y + 1, Z)).toBe(0);

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0]![0] as { region: { maxY: number } };
    expect(emitted.region.maxY).toBe(TOP_Y + 1);
  });
});
