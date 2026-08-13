import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGridPlan, addHole, removeHole, holeNumericId, resetHoleIds, digVoxel,
  landDrilledHole, computeDrillHoleDurationTicks,
} from '../../../src/core/mining/DrillPlan.js';
import type { DigVoxelResult, PlannedHole } from '../../../src/core/mining/DrillPlan.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { VoxelData } from '../../../src/core/world/VoxelGrid.js';
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

  it('newSurfaceY is -1 when the last voxel in the column is dug', () => {
    // Column at (2, z=2): only y=3 is solid — digging it leaves an empty column
    grid.setVoxel(2, 3, 2, solidVoxel());

    const result = digVoxel(grid, 2, 3, 2);

    expect(result.newSurfaceY).toBe(-1);
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
});
