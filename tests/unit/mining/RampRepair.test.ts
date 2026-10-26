// BlastSimulator2026 — Unit tests: repairing a built ramp a blast damaged (#2045)
//
// Contract: quoteRampRepair re-defines the built ramp landed on its end floor as it stands now and keeps only the
// cells off its line; orderRampRepair charges that work per cell and queues it as a planned ramp tied to the built
// one (`repairOf`), which recordBuiltRamp updates in place instead of adding a second ramp.

import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { computeVoxelColumnSurfaceHeight, setVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { createGame, type BuiltRamp, type GameState } from '../../../src/core/state/GameState.js';
import { buildRamp, carveRampSegment, landRampOnGrid, type RampDef } from '../../../src/core/mining/Ramp.js';
import { rampFootprint, recordBuiltRamp } from '../../../src/core/mining/RampWidening.js';
import { orderRampRepair, quoteRampRepair } from '../../../src/core/mining/RampRepair.js';
import { RAMP_REPAIR_COST_PER_CELL, RAMP_REPAIR_TOLERANCE_M } from '../../../src/core/config/balance.js';

const ROCK = { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
const TOP = 15;
/** Surface at TOP for z < 25, a dug floor `floorDrop` lower from there on. */
function siteGrid(floorDrop: number): VoxelGrid {
  const grid = new VoxelGrid(40, 50);
  for (let z = 0; z < 50; z++) {
    for (let x = 0; x < 40; x++) {
      const top = z < 25 ? TOP : TOP - floorDrop;
      for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, ROCK);
    }
  }
  return grid;
}

/** A ramp from (10, 0) south 25 tiles: its end row is z = 25, the first row of the dug floor. */
const DEF: RampDef = { originX: 10, originZ: 0, direction: 'south', length: 25, targetDepth: 6, width: 3, cutSlopeRatio: Math.tan(20 * Math.PI / 180) * 0.98 };

/** A built 6 m ramp onto the floor, dug and recorded as the game records one. */
function builtSite(): { grid: VoxelGrid; state: GameState; ramp: BuiltRamp } {
  const grid = siteGrid(6);
  const state = createGame({ seed: 42 });
  state.cash = 1_000_000;
  const landed = landRampOnGrid(grid, DEF);
  expect(buildRamp(grid, landed, Infinity).success).toBe(true);
  recordBuiltRamp(state, { id: 1, def: landed, footprint: rampFootprint(landed, 3), segments: [] });
  return { grid, state, ramp: state.builtRamps[0]! };
}

/** A blast deepens the three foot columns of the ramp by `metres`. */
function blowFoot(grid: VoxelGrid, metres: number): void {
  for (const z of [22, 23, 24]) {
    for (const x of [9, 10, 11]) {
      const top = Math.floor(computeVoxelColumnSurfaceHeight(grid, x, z));
      for (let y = top; y > top - metres; y--) grid.clearVoxel(x, y, z);
    }
  }
}

describe('quoteRampRepair (#2045)', () => {
  it('refuses an intact ramp: nothing is off its line', () => {
    const { grid, ramp } = builtSite();
    expect(quoteRampRepair(grid, ramp)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.intact' });
  });

  it('reads intact when another order nudged the ground its line starts from: the whole line moves with it', () => {
    // A ramp whose origin sits on another ramp's carve re-anchors on it; a hair off everywhere is no damage,
    // or two chained ramps re-order each other's repair forever.
    const { grid, ramp } = builtSite();
    const compId = grid.palette.intern(ROCK.composition);
    const origin = computeVoxelColumnSurfaceHeight(grid, 10, 0);
    setVoxelColumnSurfaceHeight(grid, 10, 0, origin + RAMP_REPAIR_TOLERANCE_M * 0.7, compId);
    expect(quoteRampRepair(grid, ramp)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.intact' });
  });

  it('a dip past the tolerance in one column is damage, and the repair re-cuts the whole line', () => {
    const { grid, ramp } = builtSite();
    const compId = grid.palette.intern(ROCK.composition);
    for (const x of [9, 10, 11]) {
      setVoxelColumnSurfaceHeight(grid, x, 12, computeVoxelColumnSurfaceHeight(grid, x, 12) - RAMP_REPAIR_TOLERANCE_M * 2, compId);
    }
    const quote = quoteRampRepair(grid, ramp);
    expect(quote.success).toBe(true);
    if (!quote.success) return;
    expect(quote.data.cells).toBeGreaterThanOrEqual(3);
  });

  it('quotes the cells a blast threw out of the foot, at the per-cell cost', () => {
    const { grid, ramp } = builtSite();
    blowFoot(grid, 2);
    const quote = quoteRampRepair(grid, ramp);
    expect(quote.success).toBe(true);
    if (!quote.success) return;
    expect(quote.data.cells).toBeGreaterThanOrEqual(9);
    expect(quote.data.cost).toBe(quote.data.cells * RAMP_REPAIR_COST_PER_CELL);
    expect(quote.data.segments.every((s, i) => s.index === i && s.cells.length > 0)).toBe(true);
  });

  it('refuses when a deeper floor puts the ramp out of reach within the slope limit: build a longer ramp', () => {
    const { ramp } = builtSite();
    const deeper = siteGrid(14); // 14 m over 25 m is steeper than 20 degrees
    expect(quoteRampRepair(deeper, ramp)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.out_of_reach' });
  });
});

describe('quoteRampRepair with overlapping ramps (#2091)', () => {
  /** builtSite plus a second ramp beside it whose west column is the first ramp's east column (x = 11). */
  function sharedColumnSite() {
    const site = builtSite();
    const beside = landRampOnGrid(site.grid, { ...DEF, originX: 12 });
    expect(buildRamp(site.grid, beside, Infinity).success).toBe(true);
    recordBuiltRamp(site.state, { id: 2, def: beside, footprint: rampFootprint(beside, 3), segments: [] });
    const compId = site.grid.palette.intern(ROCK.composition);
    setVoxelColumnSurfaceHeight(site.grid, 11, 12, computeVoxelColumnSurfaceHeight(site.grid, 11, 12) - RAMP_REPAIR_TOLERANCE_M * 3, compId);
    return { ...site, newer: site.state.builtRamps[1]! };
  }

  it('a newer ramp leaves a tile an older ramp covers to that ramp: damage there is not its own', () => {
    const { grid, state, newer } = sharedColumnSite();
    expect(quoteRampRepair(grid, newer, state.builtRamps)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.intact' });
  });

  it('the older ramp still owns and repairs the shared tile', () => {
    const { grid, state, ramp } = sharedColumnSite();
    expect(quoteRampRepair(grid, ramp, state.builtRamps).success).toBe(true);
  });

  it('without the built ramps the newer ramp reads the shared tile as its own', () => {
    const { grid, newer } = sharedColumnSite();
    expect(quoteRampRepair(grid, newer).success).toBe(true);
  });
});

describe('orderRampRepair (#2045)', () => {
  it('charges the quote and queues the work as a planned ramp tied to the built one', () => {
    const { grid, state, ramp } = builtSite();
    blowFoot(grid, 2);
    const cash = state.cash;
    const result = orderRampRepair(state, grid, ramp.id);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(state.cash).toBe(cash - result.data.cost);
    const planned = state.plannedRamps.find(p => p.id === result.data.plannedRampId)!;
    expect(planned.repairOf).toBe(ramp.id);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toHaveLength(planned.segments.length);
  });

  it('once dug, the ramp is intact again and stays one built ramp', () => {
    const { grid, state, ramp } = builtSite();
    blowFoot(grid, 2);
    const result = orderRampRepair(state, grid, ramp.id);
    expect(result.success).toBe(true);
    const planned = state.plannedRamps.at(-1)!;
    for (const s of planned.segments) carveRampSegment(grid, s);
    recordBuiltRamp(state, planned);
    expect(state.builtRamps).toHaveLength(1);
    expect(quoteRampRepair(grid, state.builtRamps[0]!)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.intact' });
  });

  it('refuses a second order while one is under way', () => {
    const { grid, state, ramp } = builtSite();
    blowFoot(grid, 2);
    expect(orderRampRepair(state, grid, ramp.id).success).toBe(true);
    expect(orderRampRepair(state, grid, ramp.id)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.in_progress' });
  });

  it('refuses when the cash does not cover the repair, charging nothing', () => {
    const { grid, state, ramp } = builtSite();
    blowFoot(grid, 2);
    state.cash = 1;
    expect(orderRampRepair(state, grid, ramp.id)).toMatchObject({ success: false, errorKey: 'mining.repair_ramp.short_funds' });
    expect(state.cash).toBe(1);
    expect(state.plannedRamps).toEqual([]);
  });

  it('refuses an unknown ramp', () => {
    const { grid, state } = builtSite();
    expect(orderRampRepair(state, grid, 99)).toMatchObject({ success: false, errorKey: 'mining.widen_ramp.not_found' });
  });
});
