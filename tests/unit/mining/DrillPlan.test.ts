import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createGridPlan, addHole, removeHole, holeNumericId, resetHoleIds, digVoxel,
  landDrilledHole, computeDrillHoleDurationTicks,
} from '../../../src/core/mining/DrillPlan.js';
import type { DigVoxelResult, PlannedHole } from '../../../src/core/mining/DrillPlan.js';
import {
  VoxelGrid, computeVoxelColumnSurfaceY, setVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import type { VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  DRILL_HOLE_BASE_DURATION_TICKS,
  DRILL_HOLE_REFERENCE_DEPTH_M,
  DRILL_HOLE_REFERENCE_DIAMETER_M,
} from '../../../src/core/config/balance.js';

beforeEach(() => resetHoleIds());

describe('DrillPlan', () => {
  it('createGridPlan creates correct number of holes', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    expect(holes.length).toBe(12);
  });

  it('createGridPlan positions are correct', () => {
    const holes = createGridPlan({ x: 20, z: 25 }, 3, 4, 3, 8, 0.15);
    // First row: (20,25), (23,25), (26,25), (29,25)
    expect(holes[0]!.x).toBe(20);
    expect(holes[0]!.z).toBe(25);
    expect(holes[1]!.x).toBe(23);
    expect(holes[1]!.z).toBe(25);
    // Second row starts at z=28
    expect(holes[4]!.x).toBe(20);
    expect(holes[4]!.z).toBe(28);
  });

  it('grid spacing is correctly applied', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 5, 10, 0.1);
    expect(holes[0]!.x).toBe(0);
    expect(holes[1]!.x).toBe(5);
    expect(holes[2]!.z).toBe(5);
  });

  it('addHole appends a hole with unique ID', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const added = addHole(holes, 10, 15, 6, 0.1);
    expect(holes.length).toBe(2);
    expect(added.id).not.toBe(holes[0]!.id);
    expect(added.x).toBe(10);
    expect(added.z).toBe(15);
    expect(added.depth).toBe(6);
  });

  it('removeHole removes the matching hole and returns true', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const targetId = holes[0]!.id;

    const removed = removeHole(holes, targetId);

    expect(removed).toBe(true);
    expect(holes.length).toBe(1);
    expect(holes.find(h => h.id === targetId)).toBeUndefined();
  });

  it('removeHole returns false and leaves the plan untouched when the ID is unknown', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 2, 3, 8, 0.15);

    const removed = removeHole(holes, 'H999');

    expect(removed).toBe(false);
    expect(holes.length).toBe(2);
  });

  it('removeHole on an empty plan returns false', () => {
    const holes: ReturnType<typeof createGridPlan> = [];

    expect(removeHole(holes, 'H1')).toBe(false);
  });

  it('holeNumericId parses the counter value out of a generated ID', () => {
    expect(holeNumericId('H1')).toBe(1);
    expect(holeNumericId('H42')).toBe(42);
  });

  it('holeNumericId round-trips IDs produced by createGridPlan and addHole', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const added = addHole(holes, 5, 5, 8, 0.15);

    expect(holeNumericId(holes[0]!.id)).toBe(1);
    expect(holeNumericId(holes[1]!.id)).toBe(2);
    expect(holeNumericId(added.id)).toBe(3);
  });

  // ── #553: createGridPlan/addHole still produce stable, sequential ids ──────
  // (type-only skeleton change — PlannedHole = DrillHole — must not disturb
  // id generation).

  it('createGridPlan produces stable, sequential ids across a full grid', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    expect(holes.map(h => h.id)).toEqual(['H1', 'H2', 'H3', 'H4']);
  });

  it('addHole continues the sequential id counter after a grid plan', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const added = addHole(holes, 9, 9, 8, 0.15);
    expect(added.id).toBe('H3');
  });
});

// ---------------------------------------------------------------------------
// landDrilledHole tests (#553)
// ---------------------------------------------------------------------------

describe('landDrilledHole', () => {
  it('preserves id/x/z/depth/diameter exactly from the planned hole', () => {
    const planned: PlannedHole = { id: 'H7', x: 12.5, z: -3, depth: 9, diameter: 0.2 };

    const drilled = landDrilledHole(planned);

    expect(drilled).toEqual({ id: 'H7', x: 12.5, z: -3, depth: 9, diameter: 0.2 });
  });

  it('returns a hole usable as a DrillHole (same shape, not a reference copy issue)', () => {
    const planned: PlannedHole = { id: 'H1', x: 0, z: 0, depth: 8, diameter: 0.15 };

    const drilled = landDrilledHole(planned);

    expect(drilled.id).toBe(planned.id);
    expect(drilled.x).toBe(planned.x);
    expect(drilled.z).toBe(planned.z);
    expect(drilled.depth).toBe(planned.depth);
    expect(drilled.diameter).toBe(planned.diameter);
  });
});

// ---------------------------------------------------------------------------
// computeDrillHoleDurationTicks tests (#553)
// ---------------------------------------------------------------------------

describe('computeDrillHoleDurationTicks', () => {
  it('reference depth/diameter costs exactly DRILL_HOLE_BASE_DURATION_TICKS', () => {
    const ticks = computeDrillHoleDurationTicks(DRILL_HOLE_REFERENCE_DEPTH_M, DRILL_HOLE_REFERENCE_DIAMETER_M);
    expect(ticks).toBe(DRILL_HOLE_BASE_DURATION_TICKS);
  });

  it('double depth doubles the duration', () => {
    const base = computeDrillHoleDurationTicks(DRILL_HOLE_REFERENCE_DEPTH_M, DRILL_HOLE_REFERENCE_DIAMETER_M);
    const doubled = computeDrillHoleDurationTicks(DRILL_HOLE_REFERENCE_DEPTH_M * 2, DRILL_HOLE_REFERENCE_DIAMETER_M);
    expect(doubled).toBe(base * 2);
  });

  it('double diameter doubles the duration', () => {
    const base = computeDrillHoleDurationTicks(DRILL_HOLE_REFERENCE_DEPTH_M, DRILL_HOLE_REFERENCE_DIAMETER_M);
    const doubled = computeDrillHoleDurationTicks(DRILL_HOLE_REFERENCE_DEPTH_M, DRILL_HOLE_REFERENCE_DIAMETER_M * 2);
    expect(doubled).toBe(base * 2);
  });

  it('a very small depth/diameter clamps to a minimum of 1 tick, never 0 or negative', () => {
    const ticks = computeDrillHoleDurationTicks(0.001, 0.001);
    expect(ticks).toBe(1);
  });

  it('zero depth/diameter clamps to a minimum of 1 tick', () => {
    const ticks = computeDrillHoleDurationTicks(0, 0);
    expect(ticks).toBe(1);
    expect(ticks).toBeGreaterThan(0);
  });

  it('scales roughly linearly with depth for two arbitrary depths at reference diameter', () => {
    const shallow = computeDrillHoleDurationTicks(4, DRILL_HOLE_REFERENCE_DIAMETER_M);
    const deep = computeDrillHoleDurationTicks(16, DRILL_HOLE_REFERENCE_DIAMETER_M);
    expect(deep).toBeGreaterThan(shallow);
  });
});

// ---------------------------------------------------------------------------
// digVoxel tests
// ---------------------------------------------------------------------------

/** A fully solid voxel fixture. */
function solidVoxel(): VoxelData {
  return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };
}

describe('digVoxel', () => {
  // 5 × 5 × 5 grid — large enough for all surface-Y scenarios
  let grid: VoxelGrid;

  beforeEach(() => {
    grid = new VoxelGrid(5, 5, 5);
  });

  it('returns success:true when digging a solid voxel', () => {
    grid.setVoxel(2, 3, 2, solidVoxel());

    const result: DigVoxelResult = digVoxel(grid, 2, 3, 2);

    expect(result.success).toBe(true);
  });

  it('sets the voxel density to 0 after digging', () => {
    grid.setVoxel(2, 3, 2, solidVoxel());

    digVoxel(grid, 2, 3, 2);

    expect(grid.getVoxel(2, 3, 2)!.density).toBe(0);
  });

  it('returns affectedCell matching the dug x and z', () => {
    grid.setVoxel(1, 2, 3, solidVoxel());

    const result = digVoxel(grid, 1, 2, 3);

    expect(result.affectedCell).toEqual({ x: 1, z: 3 });
  });

  it('newSurfaceY drops to the next solid voxel below when the top voxel is dug', () => {
    // Column at (2, z=2): solid at y=3 (top) and y=2 (below)
    grid.setVoxel(2, 3, 2, solidVoxel());
    grid.setVoxel(2, 2, 2, solidVoxel());

    const result = digVoxel(grid, 2, 3, 2); // dig the top

    expect(result.newSurfaceY).toBe(2);
  });

  it('newSurfaceY is null when the last voxel in the column is dug', () => {
    // Column at (2, z=2): only y=3 is solid — digging it leaves an empty column
    grid.setVoxel(2, 3, 2, solidVoxel());

    const result = digVoxel(grid, 2, 3, 2);

    expect(result.newSurfaceY).toBeNull();
  });

  it('newSurfaceY is unchanged when a non-top voxel is dug', () => {
    // Column at (2, z=2): solid at y=3 (top) and y=2; digging y=2 leaves y=3 as surface
    grid.setVoxel(2, 3, 2, solidVoxel());
    grid.setVoxel(2, 2, 2, solidVoxel());

    const result = digVoxel(grid, 2, 2, 2); // dig the lower voxel

    expect(result.newSurfaceY).toBe(3);
  });

  it('returns success:false with an error when coordinates are out of bounds', () => {
    const result = digVoxel(grid, 99, 0, 0);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns success:false with an error when the target voxel is already empty', () => {
    // grid initialises every cell to empty — no setVoxel call needed
    const result = digVoxel(grid, 2, 2, 2);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ── #1148: post-carve renormalisation ─────────────────────────────────────

  it('digging the column\'s real top leaves no stranded sub-threshold density above the new top', () => {
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(2, y, 2, compId, undefined, 1);
    // Genuine fractional crossing above the real top: y=3 is the real top
    // (density >= 0.5), y=4 carries the residual sub-threshold crossing that
    // setVoxelColumnSurfaceHeight's own band write leaves above it.
    setVoxelColumnSurfaceHeight(grid, 2, 2, 3.5, compId);
    const oldTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    expect(oldTop).toBe(3);
    expect(grid.densityAt(2, oldTop + 1, 2)).toBeGreaterThan(0);

    digVoxel(grid, 2, oldTop, 2);

    for (let y = oldTop; y < grid.sizeY; y++) {
      expect(grid.densityAt(2, y, 2), `density at y=${y} should be 0`).toBe(0);
    }
  });

  it('the post-dig state needs no further cleanup — the exposed top is plain solid rock, not a manufactured crossing', () => {
    // Digging through the genuine crossing exposes plain, never-graded rock
    // below (y=0..2 were filled at density 1, not written via
    // setVoxelColumnSurfaceHeight): there is no natural crossing left to
    // preserve, so the new top stays a hard step rather than being smeared
    // into a fresh band that never existed pre-carve.
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(2, y, 2, compId, undefined, 1);
    setVoxelColumnSurfaceHeight(grid, 2, 2, 3.5, compId);
    const oldTop = computeVoxelColumnSurfaceY(grid, 2, 2);

    digVoxel(grid, 2, oldTop, 2);

    const newTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    expect(newTop).toBe(2);
    expect(grid.densityAt(2, newTop, 2)).toBe(1);
  });

  it('digging a non-top voxel does not disturb anything above the unmoved top', () => {
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(2, y, 2, compId, undefined, 1);
    setVoxelColumnSurfaceHeight(grid, 2, 2, 3.5, compId);
    const oldTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    const aboveBefore: number[] = [];
    for (let y = oldTop; y < grid.sizeY; y++) aboveBefore.push(grid.densityAt(2, y, 2));

    digVoxel(grid, 2, 1, 2); // dig a buried, non-top voxel — the top never moves

    expect(computeVoxelColumnSurfaceY(grid, 2, 2)).toBe(oldTop);
    const aboveAfter: number[] = [];
    for (let y = oldTop; y < grid.sizeY; y++) aboveAfter.push(grid.densityAt(2, y, 2));
    expect(aboveAfter).toEqual(aboveBefore);
  });

  it('#1148: emits terrain:updated with region maxY widened by renormalisation past the dug voxel\'s own y', () => {
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(2, y, 2, compId, undefined, 1);
    // Genuine fractional crossing above the real top: y=3 is the real top
    // (density >= 0.5), y=4 carries the residual sub-threshold crossing that
    // setVoxelColumnSurfaceHeight's own band write leaves above it.
    setVoxelColumnSurfaceHeight(grid, 2, 2, 3.5, compId);
    const oldTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    expect(oldTop).toBe(3);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    digVoxel(grid, 2, oldTop, 2, emitter);

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0]![0] as { region: { maxY: number } };
    // The dug voxel's own y is oldTop (3), but renormalisation reaches one
    // cell higher to clear the stranded residue at oldTop+1 — the emitted
    // region must widen to match, not stop at the raw dug voxel's own y.
    expect(emitted.region.maxY).toBe(oldTop + 1);
  });
});
