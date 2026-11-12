import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createGridPlan, addHole, removeHole, holeNumericId, maxHoleNumericId, digVoxel, landDrilledHole, computeDrillHoleDurationTicks,
  fleetDrillReachM, drillDepthRefusal, minDrillRigTier, fleetDrillDiameterM, drillDiameterRefusal,
  gridCellPositions, createHolesAt, GRID_LAYOUTS, drillHoleCost, estimateDrillWorkTicks,
} from '../../../src/core/mining/DrillPlan.js';
import { computeRigDurationTicks } from '../../../src/core/entities/Vehicle.js';
import { computeTaskDuration } from '../../../src/core/entities/EmployeeTaskDuration.js';
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
  DRILL_RIG_MAX_DEPTH_M,
  DRILL_COST_PER_METRE,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
} from '../../../src/core/config/balance.js';

const holeCounter = { nextHoleId: 1 };

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('DrillPlan', () => {
  it('createGridPlan creates correct number of holes', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    expect(holes.length).toBe(12);
  });

  it('createGridPlan positions are correct', () => {
    const holes = createGridPlan(holeCounter, { x: 20, z: 25 }, 3, 4, 3, 8, 0.15);
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
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 5, 10, 0.1);
    expect(holes[0]!.x).toBe(0);
    expect(holes[1]!.x).toBe(5);
    expect(holes[2]!.z).toBe(5);
  });

  it('addHole appends a hole with unique ID', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const added = addHole(holeCounter, holes, 10, 15, 6, 0.1);
    expect(holes.length).toBe(2);
    expect(added.id).not.toBe(holes[0]!.id);
    expect(added.x).toBe(10);
    expect(added.z).toBe(15);
    expect(added.depth).toBe(6);
  });

  it('removeHole removes the matching hole and returns true', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const targetId = holes[0]!.id;

    const removed = removeHole(holes, targetId);

    expect(removed).toBe(true);
    expect(holes.length).toBe(1);
    expect(holes.find(h => h.id === targetId)).toBeUndefined();
  });

  it('removeHole returns false and leaves the plan untouched when the ID is unknown', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);

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
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const added = addHole(holeCounter, holes, 5, 5, 8, 0.15);

    expect(holeNumericId(holes[0]!.id)).toBe(1);
    expect(holeNumericId(holes[1]!.id)).toBe(2);
    expect(holeNumericId(added.id)).toBe(3);
  });

  // ── #553: createGridPlan/addHole still produce stable, sequential ids ──────
  // (type-only skeleton change — PlannedHole = DrillHole — must not disturb
  // id generation).

  it('createGridPlan produces stable, sequential ids across a full grid', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    expect(holes.map(h => h.id)).toEqual(['H1', 'H2', 'H3', 'H4']);
  });

  it('addHole continues the sequential id counter after a grid plan', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const added = addHole(holeCounter, holes, 9, 9, 8, 0.15);
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

  // A drilled hole keeps the pattern cell it was ordered in: the permit area and powder factor read it.
  it('keeps the spacing and burden of the grid the hole was ordered in', () => {
    const planned: PlannedHole = { id: 'H4', x: 14, z: 13, depth: 8, diameter: 0.089, spacingM: 4, burdenM: 3 };

    expect(landDrilledHole(planned)).toEqual({ id: 'H4', x: 14, z: 13, depth: 8, diameter: 0.089, spacingM: 4, burdenM: 3 });
  });

  it('a hole ordered outside any grid lands with no pattern cell at all, not undefined fields', () => {
    const drilled = landDrilledHole({ id: 'H1', x: 0, z: 0, depth: 8, diameter: 0.15 });

    expect('spacingM' in drilled).toBe(false);
    expect('burdenM' in drilled).toBe(false);
  });

  it('boundary: copies each of spacing and burden on its own', () => {
    const drilled = landDrilledHole({ id: 'H2', x: 0, z: 0, depth: 8, diameter: 0.15, spacingM: 5 });

    expect(drilled.spacingM).toBe(5);
    expect('burdenM' in drilled).toBe(false);
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
  // 5 × 5 grid, GRID_HEIGHT tall — large enough for all surface-Y scenarios
  const GRID_HEIGHT = 5;
  let grid: VoxelGrid;

  beforeEach(() => {
    grid = new VoxelGrid(5, 5);
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
    expect(oldTop).not.toBeNull();
    expect(oldTop).toBe(3);
    expect(grid.densityAt(2, oldTop! + 1, 2)).toBeGreaterThan(0);

    digVoxel(grid, 2, oldTop!, 2);

    for (let y = oldTop!; y < GRID_HEIGHT; y++) {
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
    expect(oldTop).not.toBeNull();

    digVoxel(grid, 2, oldTop!, 2);

    const newTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    expect(newTop).not.toBeNull();
    expect(newTop).toBe(2);
    expect(grid.densityAt(2, newTop!, 2)).toBe(1);
  });

  it('digging a non-top voxel does not disturb anything above the unmoved top', () => {
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 2; y++) grid.fillVoxel(2, y, 2, compId, undefined, 1);
    setVoxelColumnSurfaceHeight(grid, 2, 2, 3.5, compId);
    const oldTop = computeVoxelColumnSurfaceY(grid, 2, 2);
    expect(oldTop).not.toBeNull();
    const aboveBefore: number[] = [];
    for (let y = oldTop!; y < GRID_HEIGHT; y++) aboveBefore.push(grid.densityAt(2, y, 2));

    digVoxel(grid, 2, 1, 2); // dig a buried, non-top voxel — the top never moves

    expect(computeVoxelColumnSurfaceY(grid, 2, 2)).toBe(oldTop);
    const aboveAfter: number[] = [];
    for (let y = oldTop!; y < GRID_HEIGHT; y++) aboveAfter.push(grid.densityAt(2, y, 2));
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
    expect(oldTop).not.toBeNull();
    expect(oldTop).toBe(3);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    digVoxel(grid, 2, oldTop!, 2, emitter);

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0]![0] as { region: { maxY: number } };
    // The dug voxel's own y is oldTop (3), but renormalisation reaches one
    // cell higher to clear the stranded residue at oldTop+1 — the emitted
    // region must widen to match, not stop at the raw dug voxel's own y.
    expect(emitted.region.maxY).toBe(oldTop! + 1);
  });
});

// ── #1352: the id counter lives on the caller's state, not in the module ────

describe('hole id counter (#1352)', () => {
  const hole = (id: string) => ({ id, x: 0, z: 0, depth: 8, diameter: 0.15 });

  it('createGridPlan advances the counter by rows*cols', () => {
    const counter = { nextHoleId: 1 };
    const holes = createGridPlan(counter, { x: 0, z: 0 }, 2, 3, 3, 8, 0.15);
    expect(holes.map(h => h.id)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    expect(counter.nextHoleId).toBe(7);
  });

  it('createGridPlan starts at the counter value it is given', () => {
    const counter = { nextHoleId: 10 };
    const holes = createGridPlan(counter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    expect(holes.map(h => h.id)).toEqual(['H10', 'H11']);
    expect(counter.nextHoleId).toBe(12);
  });

  it('two counters are independent', () => {
    const a = { nextHoleId: 1 };
    const b = { nextHoleId: 1 };
    const ha = addHole(a, [], 0, 0, 8, 0.15);
    addHole(a, [], 1, 1, 8, 0.15);
    const hb = addHole(b, [], 0, 0, 8, 0.15);
    expect(ha.id).toBe('H1');
    expect(hb.id).toBe('H1');
    expect(a.nextHoleId).toBe(3);
    expect(b.nextHoleId).toBe(2);
  });

  it('sequential adds are unique and increasing', () => {
    const counter = { nextHoleId: 1 };
    const holes: ReturnType<typeof createGridPlan> = [];
    const ids = [0, 1, 2, 3, 4].map(i => addHole(counter, holes, i, i, 8, 0.15).id);
    expect(ids).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
    expect(new Set(ids).size).toBe(5);
  });

  it('removing the highest hole does not reuse its id', () => {
    const counter = { nextHoleId: 1 };
    const holes: ReturnType<typeof createGridPlan> = [];
    addHole(counter, holes, 0, 0, 8, 0.15);
    const top = addHole(counter, holes, 1, 1, 8, 0.15);
    removeHole(holes, top.id);
    const next = addHole(counter, holes, 2, 2, 8, 0.15);
    expect(next.id).toBe('H3');
  });

  it('addHole skips ids held by reservedHoles', () => {
    const counter = { nextHoleId: 1 };
    const added = addHole(counter, [], 5, 5, 8, 0.15, [hole('H1'), hole('H2')]);
    expect(added.id).toBe('H3');
    expect(counter.nextHoleId).toBe(4);
  });

  it('addHole skips ids held by the plan itself', () => {
    const counter = { nextHoleId: 1 };
    const holes = [hole('H1')];
    expect(addHole(counter, holes, 5, 5, 8, 0.15).id).toBe('H2');
  });
});

describe('maxHoleNumericId (#1352)', () => {
  it('returns 0 for no ids', () => {
    expect(maxHoleNumericId([])).toBe(0);
  });

  it('returns the highest numeric part', () => {
    expect(maxHoleNumericId(['H1', 'H7', 'H3'])).toBe(7);
  });

  it('compares numerically, not lexically', () => {
    expect(maxHoleNumericId(['H9', 'H10'])).toBe(10);
  });

  it('ignores ids that are not H<n>', () => {
    expect(maxHoleNumericId(['foo', 'H', 'H2x', 'X99', 'h50', 'H4'])).toBe(4);
  });

  it('returns 0 when no id matches', () => {
    expect(maxHoleNumericId(['foo', 'bar'])).toBe(0);
  });

  it('accepts any iterable and does not consume state', () => {
    const set = new Set(['H2', 'H5']);
    expect(maxHoleNumericId(set)).toBe(5);
    expect(maxHoleNumericId(set)).toBe(5);
    expect(set.size).toBe(2);
  });
});

// ── Drill rig reach by tier (#1679) ──

const rig = (tier: 1 | 2 | 3) => ({ type: 'drill_rig' as const, tier });

describe('fleetDrillReachM (#1679)', () => {
  it('is the tier value of a single rig: 12 / 24 / 40 m', () => {
    expect(fleetDrillReachM([rig(1)])).toBe(12);
    expect(fleetDrillReachM([rig(2)])).toBe(24);
    expect(fleetDrillReachM([rig(3)])).toBe(40);
    expect(fleetDrillReachM([rig(3)])).toBe(DRILL_RIG_MAX_DEPTH_M[3]);
  });

  it('takes the best rig in the fleet', () => {
    expect(fleetDrillReachM([rig(1), rig(2), rig(1)])).toBe(24);
    expect(fleetDrillReachM([rig(3), rig(1)])).toBe(40);
  });

  it('ignores vehicles that are not drill rigs', () => {
    expect(fleetDrillReachM([rig(1), { type: 'rock_digger', tier: 3 }, { type: 'debris_hauler', tier: 3 }])).toBe(12);
  });

  it('boundary: with no rig owned (empty or only other vehicles) falls back to the tier-1 reach', () => {
    expect(fleetDrillReachM([])).toBe(12);
    expect(fleetDrillReachM([{ type: 'rock_digger', tier: 3 }])).toBe(12);
  });
});

describe('drillDepthRefusal (#1679)', () => {
  it('refuses a 20 m hole with only a tier-1 rig, naming depth and reach', () => {
    expect(drillDepthRefusal(20, [rig(1)])).toEqual({
      key: 'mining.drill_plan.refused_depth',
      params: { depth: 20, reach: 12 },
    });
  });

  it('accepts a 20 m hole with a tier-2 rig', () => {
    expect(drillDepthRefusal(20, [rig(2)])).toBeNull();
  });

  it('boundary: depth equal to reach is accepted, just past it is refused', () => {
    expect(drillDepthRefusal(12, [rig(1)])).toBeNull();
    expect(drillDepthRefusal(12.5, [rig(1)])).not.toBeNull();
    expect(drillDepthRefusal(40, [rig(3)])).toBeNull();
    expect(drillDepthRefusal(41, [rig(3)])).not.toBeNull();
  });

  it('a non-rig vehicle does not extend the reach', () => {
    expect(drillDepthRefusal(20, [rig(1), { type: 'rock_digger', tier: 3 }])).not.toBeNull();
  });

  it('openings that drill 6-8 m holes are never refused, even with no rig', () => {
    expect(drillDepthRefusal(6, [])).toBeNull();
    expect(drillDepthRefusal(8, [rig(1)])).toBeNull();
  });
});

describe('minDrillRigTier (#1714)', () => {
  it('maps a depth to the lowest rig tier that reaches it', () => {
    expect(minDrillRigTier(6)).toBe(1);
    expect(minDrillRigTier(12)).toBe(1);
    expect(minDrillRigTier(20)).toBe(2);
    expect(minDrillRigTier(30)).toBe(3);
  });

  it('boundary: exact tier reach stays on that tier, just past it steps up', () => {
    expect(minDrillRigTier(DRILL_RIG_MAX_DEPTH_M[1])).toBe(1);
    expect(minDrillRigTier(12.1)).toBe(2);
    expect(minDrillRigTier(DRILL_RIG_MAX_DEPTH_M[2])).toBe(2);
    expect(minDrillRigTier(24.1)).toBe(3);
    expect(minDrillRigTier(DRILL_RIG_MAX_DEPTH_M[3])).toBe(3);
  });

  it('rejection: degenerate (0, NaN) falls back to tier 1; beyond the deepest rig clamps to tier 3', () => {
    expect(minDrillRigTier(0)).toBe(1);
    expect(minDrillRigTier(NaN)).toBe(1);
    expect(minDrillRigTier(41)).toBe(3);
    expect(minDrillRigTier(1000)).toBe(3);
  });

  it('agrees with drillDepthRefusal: a rig of the returned tier always accepts the depth', () => {
    for (const depth of [1, 12, 12.1, 18, 24, 24.1, 40]) {
      expect(drillDepthRefusal(depth, [rig(minDrillRigTier(depth))])).toBeNull();
    }
  });
});

describe('fleetDrillDiameterM (#1934)', () => {
  it('is the widest hole the best drill rig can bore', () => {
    expect(fleetDrillDiameterM([rig(1)])).toBe(0.089);
    expect(fleetDrillDiameterM([rig(1), rig(2)])).toBe(0.127);
    expect(fleetDrillDiameterM([rig(3), rig(1)])).toBe(0.165);
  });

  it('ignores vehicles that are not drill rigs', () => {
    expect(fleetDrillDiameterM([rig(1), { type: 'rock_digger', tier: 3 }])).toBe(0.089);
  });

  it('boundary: with no rig falls back to the tier-1 diameter', () => {
    expect(fleetDrillDiameterM([])).toBe(0.089);
  });
});

describe('drillDiameterRefusal (#1934)', () => {
  it('refuses 127 mm with only a tier-1 rig, naming diameter and max', () => {
    const refusal = drillDiameterRefusal(0.127, [rig(1)]);
    expect(refusal).not.toBeNull();
    expect(refusal!.key).toBe('mining.drill_plan.refused_diameter');
    // Params are millimetres: the i18n text reads "{diameter} mm ... up to {reach} mm".
    expect(refusal!.params.reach).toBe(89);
    expect(refusal!.params.diameter).toBe(127);
  });

  it('accepts 127 mm with a tier-2 rig', () => {
    expect(drillDiameterRefusal(0.127, [rig(2)])).toBeNull();
  });

  it('165 mm needs a tier-3 rig', () => {
    expect(drillDiameterRefusal(0.165, [rig(2)])).not.toBeNull();
    expect(drillDiameterRefusal(0.165, [rig(3)])).toBeNull();
  });

  it('boundary: the default diameter is never refused, even with no rig', () => {
    expect(drillDiameterRefusal(0.089, [rig(1)])).toBeNull();
    expect(drillDiameterRefusal(0.089, [])).toBeNull();
  });

  it('no rig behaves like a tier-1 rig', () => {
    expect(drillDiameterRefusal(0.127, [])).not.toBeNull();
  });

  it('a non-rig vehicle does not extend the diameter', () => {
    expect(drillDiameterRefusal(0.127, [rig(1), { type: 'rock_digger', tier: 3 }])).not.toBeNull();
  });
});

describe('computeDrillHoleDurationTicks ignores the new capacity rules (#1934 pin)', () => {
  it('still scales linearly with diameter and only with diameter, depth and base', () => {
    const base = computeDrillHoleDurationTicks(8, 0.089);
    expect(computeDrillHoleDurationTicks(8, 0.127)).toBe(
      Math.max(1, Math.round(DRILL_HOLE_BASE_DURATION_TICKS * (8 / DRILL_HOLE_REFERENCE_DEPTH_M) * (0.127 / DRILL_HOLE_REFERENCE_DIAMETER_M))),
    );
    expect(computeDrillHoleDurationTicks(8, 0.127)).toBeGreaterThan(base);
  });
});

describe('computeDrillHoleDurationTicks stays the tier-1 base (#1935)', () => {
  it('is not pre-divided by any rig work rate', () => {
    const base = computeDrillHoleDurationTicks(8, DRILL_HOLE_REFERENCE_DIAMETER_M);
    expect(base).toBe(Math.max(1, Math.round(
      DRILL_HOLE_BASE_DURATION_TICKS * (8 / DRILL_HOLE_REFERENCE_DEPTH_M),
    )));
  });
});

describe('computeRigDurationTicks (#1935)', () => {
  // A wide 8 m hole (6x reference diameter, 36 ticks): the 6-tick reference base is too coarse for
  // ceil-rounding to leave the 1/workRate ratio visible.
  const base = computeDrillHoleDurationTicks(8, DRILL_HOLE_REFERENCE_DIAMETER_M * 6);

  it('tier 1 equals the plain task duration', () => {
    expect(computeRigDurationTicks(base, 1)).toBe(computeTaskDuration(base, 1, 1, 1, 1));
  });

  it('tier 2 divides the base by workRate 1.4 (~0.71x for an 8 m hole)', () => {
    const t2 = computeRigDurationTicks(base, 2);
    expect(t2).toBe(computeTaskDuration(base / 1.4, 1, 1, 1, 1));
    expect(t2 / computeRigDurationTicks(base, 1)).toBeCloseTo(1 / 1.4, 1);
  });

  it('tier 3 divides the base by workRate 2 (~0.5x for an 8 m hole)', () => {
    const t3 = computeRigDurationTicks(base, 3);
    expect(t3).toBe(computeTaskDuration(base / 2, 1, 1, 1, 1));
    expect(t3 / computeRigDurationTicks(base, 1)).toBeCloseTo(0.5, 1);
  });

  it('tier 3 < tier 2 < tier 1', () => {
    expect(computeRigDurationTicks(base, 3)).toBeLessThan(computeRigDurationTicks(base, 2));
    expect(computeRigDurationTicks(base, 2)).toBeLessThan(computeRigDurationTicks(base, 1));
  });

  it('proficiency, need and living-quarters multipliers still apply on top of the tier', () => {
    expect(computeRigDurationTicks(base, 2, 4, 0.9, 0.85))
      .toBe(computeTaskDuration(base / 1.4, 4, 0.9, 0.85, 1));
  });
});

// ── Grid shape: burden between rows, aligned or staggered rows ──

describe('gridCellPositions — burden and layout', () => {
  it('defaults to a square, aligned mesh: rows as far apart as the holes in them', () => {
    expect(gridCellPositions({ x: 20, z: 25 }, 2, 3, 3)).toEqual([
      { x: 20, z: 25 }, { x: 23, z: 25 }, { x: 26, z: 25 },
      { x: 20, z: 28 }, { x: 23, z: 28 }, { x: 26, z: 28 },
    ]);
  });

  it('puts holes `spacing` apart along x and rows `burden` apart along z, row-major', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 2, 4, 3)).toEqual([
      { x: 0, z: 0 }, { x: 4, z: 0 },
      { x: 0, z: 3 }, { x: 4, z: 3 },
      { x: 0, z: 6 }, { x: 4, z: 6 },
    ]);
  });

  it('staggered shifts every odd row by half a spacing and drops its last hole; even rows stay in line with the origin', () => {
    const cells = gridCellPositions({ x: 10, z: 0 }, 4, 3, 4, 3, 'staggered');

    expect(cells).toEqual([
      { x: 10, z: 0 }, { x: 14, z: 0 }, { x: 18, z: 0 },
      { x: 12, z: 3 }, { x: 16, z: 3 },
      { x: 10, z: 6 }, { x: 14, z: 6 }, { x: 18, z: 6 },
      { x: 12, z: 9 }, { x: 16, z: 9 },
    ]);
  });

  it('a staggered grid stays inside the rows x cols rectangle it was laid out on', () => {
    const origin = { x: 10, z: 10 };
    for (const spacing of [2, 3, 4, 5, 6]) {
      const cells = gridCellPositions(origin, 5, 4, spacing, 3, 'staggered');
      const farX = origin.x + 3 * spacing;
      expect(Math.max(...cells.map(c => c.x)), `spacing ${spacing}`).toBeLessThanOrEqual(farX);
      expect(Math.min(...cells.map(c => c.x)), `spacing ${spacing}`).toBe(origin.x);
    }
  });

  it('a half spacing that is not a whole metre is rounded down, so holes stay on cells', () => {
    // 5 m spacing: odd rows shift floor(2.5) = 2 m.
    const cells = gridCellPositions({ x: 0, z: 0 }, 2, 2, 5, 5, 'staggered');
    expect(cells.slice(2)).toEqual([{ x: 2, z: 5 }]);
    // 3 m spacing: floor(1.5) = 1 m.
    expect(gridCellPositions({ x: 0, z: 0 }, 2, 2, 3, 3, 'staggered')[2]).toEqual({ x: 1, z: 3 });
  });

  it('boundary: a one-column staggered grid lies in line, with nothing to stagger against', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 1, 4, 3, 'staggered')).toEqual(gridCellPositions({ x: 0, z: 0 }, 3, 1, 4, 3));
  });

  it('boundary: at 1 m spacing the half-spacing shift rounds to 0, so a staggered grid lies in line', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 3, 1, 2, 'staggered')).toEqual(gridCellPositions({ x: 0, z: 0 }, 3, 3, 1, 2));
  });

  it('an explicit square layout is the default one', () => {
    expect(gridCellPositions({ x: 5, z: 5 }, 3, 4, 4, 3, 'square')).toEqual(gridCellPositions({ x: 5, z: 5 }, 3, 4, 4, 3));
  });

  it('a single row is never shifted, whatever the layout', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 1, 3, 4, 3, 'staggered')).toEqual([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 8, z: 0 }]);
  });

  it('rejection: no rows or no columns gives no cells', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 0, 3, 4, 3, 'staggered')).toEqual([]);
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 0, 4)).toEqual([]);
  });
});

describe('GRID_LAYOUTS', () => {
  it('lists the two layouts a drill plan may order, aligned first', () => {
    expect(GRID_LAYOUTS).toEqual(['square', 'staggered']);
  });

  it('an aligned grid lays out rows × cols holes; a staggered one a hole fewer on every odd row', () => {
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 4, 4, 3, 'square')).toHaveLength(12);
    expect(gridCellPositions({ x: 0, z: 0 }, 3, 4, 4, 3, 'staggered')).toHaveLength(4 + 3 + 4);
  });
});

describe('createHolesAt / createGridPlan record the pattern cell', () => {
  it('createHolesAt stamps every hole with the cell it is given', () => {
    const counter = { nextHoleId: 1 };
    const holes = createHolesAt(counter, [{ x: 1, z: 2 }, { x: 5, z: 2 }], 8, 0.089, { spacingM: 4, burdenM: 3 });

    expect(holes).toEqual([
      { id: 'H1', x: 1, z: 2, depth: 8, diameter: 0.089, spacingM: 4, burdenM: 3 },
      { id: 'H2', x: 5, z: 2, depth: 8, diameter: 0.089, spacingM: 4, burdenM: 3 },
    ]);
    expect(counter.nextHoleId).toBe(3);
  });

  it('createHolesAt without a cell leaves the holes without spacing or burden', () => {
    const [hole] = createHolesAt({ nextHoleId: 1 }, [{ x: 1, z: 2 }], 8, 0.089);

    expect('spacingM' in hole!).toBe(false);
    expect('burdenM' in hole!).toBe(false);
  });

  it('boundary: no positions, no holes, and the counter does not move', () => {
    const counter = { nextHoleId: 7 };
    expect(createHolesAt(counter, [], 8, 0.089, { spacingM: 4, burdenM: 4 })).toEqual([]);
    expect(counter.nextHoleId).toBe(7);
  });

  it('createGridPlan records its spacing and, by default, a burden equal to it', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 5, 8, 0.089);

    expect(holes.every(h => h.spacingM === 5 && h.burdenM === 5)).toBe(true);
  });

  it('createGridPlan with a burden and a staggered layout drills exactly the staggered cells and records both', () => {
    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 3, 3, 4, 8, 0.089, 3, 'staggered');

    expect(holes.map(h => ({ x: h.x, z: h.z }))).toEqual(gridCellPositions({ x: 10, z: 10 }, 3, 3, 4, 3, 'staggered'));
    expect(holes[3]).toMatchObject({ x: 12, z: 13 }); // first hole of row 1, shifted 2 m
    expect(holes.every(h => h.spacingM === 4 && h.burdenM === 3)).toBe(true);
  });
});

// ── Drilling costs money and rig time ──

describe('drillHoleCost', () => {
  it('an 89 mm hole costs DRILL_COST_PER_METRE ($12) per metre: an 8 m hole is $96', () => {
    expect(DRILL_COST_PER_METRE).toBe(12);
    expect(drillHoleCost(8, DRILL_HOLE_DEFAULT_DIAMETER_M)).toBe(96);
    expect(drillHoleCost(8, DRILL_HOLE_DEFAULT_DIAMETER_M)).toBe(DRILL_COST_PER_METRE * 8);
  });

  it('is linear in depth for a given bore', () => {
    expect(drillHoleCost(16, 0.089)).toBe(2 * drillHoleCost(8, 0.089));
    expect(drillHoleCost(4, 0.089)).toBe(drillHoleCost(8, 0.089) / 2);
  });

  it('scales with the bore relative to 89 mm: a wider hole costs more per metre', () => {
    // 12 x 8 x 127/89 = 136.98 -> 137; 12 x 8 x 165/89 = 177.98 -> 178.
    expect(drillHoleCost(8, 0.127)).toBe(137);
    expect(drillHoleCost(8, 0.165)).toBe(178);
    expect(drillHoleCost(8, 0.165)).toBeGreaterThan(drillHoleCost(8, 0.127));
  });

  it('rounds to whole dollars', () => {
    // 12 x 1 x 127/89 = 17.12
    expect(drillHoleCost(1, 0.127)).toBe(17);
    for (const [depth, diameter] of [[7.3, 0.127], [5, 0.165], [2.5, 0.089]] as const) {
      expect(Number.isInteger(drillHoleCost(depth, diameter))).toBe(true);
    }
  });

  it('boundary: a hole of no depth costs nothing', () => {
    expect(drillHoleCost(0, 0.089)).toBe(0);
  });
});

describe('estimateDrillWorkTicks', () => {
  const holes = (n: number, depth = 8, diameter = 0.089) => Array.from({ length: n }, () => ({ depth, diameter }));

  it('is each hole\'s rig work at that tier, summed', () => {
    const set = [{ depth: 8, diameter: 0.089 }, { depth: 12, diameter: 0.127 }, { depth: 3, diameter: 0.165 }];
    for (const tier of [1, 2, 3] as const) {
      const expected = set.reduce((sum, h) => sum + computeRigDurationTicks(computeDrillHoleDurationTicks(h.depth, h.diameter), tier), 0);
      expect(estimateDrillWorkTicks(set, tier), `tier ${tier}`).toBe(expected);
    }
  });

  it('a better rig drills the same holes in fewer ticks', () => {
    const nine = holes(9);
    const t1 = estimateDrillWorkTicks(nine, 1);
    const t2 = estimateDrillWorkTicks(nine, 2);
    const t3 = estimateDrillWorkTicks(nine, 3);
    expect(t2).toBeLessThan(t1);
    expect(t3).toBeLessThan(t2);
  });

  it('more holes take longer: the estimate adds up across holes', () => {
    expect(estimateDrillWorkTicks(holes(9), 1)).toBe(9 * estimateDrillWorkTicks(holes(1), 1));
    expect(estimateDrillWorkTicks(holes(3), 2)).toBeGreaterThan(estimateDrillWorkTicks(holes(2), 2));
  });

  it('a deeper or wider hole takes longer on the same rig', () => {
    expect(estimateDrillWorkTicks(holes(1, 16), 1)).toBeGreaterThan(estimateDrillWorkTicks(holes(1, 8), 1));
    expect(estimateDrillWorkTicks(holes(1, 8, 0.165), 1)).toBeGreaterThan(estimateDrillWorkTicks(holes(1, 8, 0.089), 1));
  });

  it('boundary: no holes is no work', () => {
    expect(estimateDrillWorkTicks([], 1)).toBe(0);
    expect(estimateDrillWorkTicks([], 3)).toBe(0);
  });
});
