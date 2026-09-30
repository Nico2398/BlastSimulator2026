// BlastSimulator2026 — Unit tests: widening a built ramp (#1298)

import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGame, type BuiltRamp, type GameState } from '../../../src/core/state/GameState.js';
import { buildRamp, defineRampSegments, type RampDef } from '../../../src/core/mining/Ramp.js';
import {
  rampFootprint, findRampAtTile, nextRampWidth, validateWidenRamp, orderRampWiden,
} from '../../../src/core/mining/RampWidening.js';
import { RAMP_COST_PER_METER_PER_WIDTH, type RampWidth } from '../../../src/core/config/balance.js';

function makeElevatedGrid(sizeX: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++)
      for (let y = 0; y <= surfaceY; y++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

const DEF: RampDef = { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 6 };

/** A state owning one already-dug ramp (id 1) of `width`, on a fresh elevated grid with the corridor carved. */
function setup(width: RampWidth = 3, cash = 1_000_000) {
  const state = createGame({ seed: 42 });
  state.cash = cash;
  const grid = makeElevatedGrid(30, 40, 22);
  const def: RampDef = { ...DEF, width };
  const built = buildRamp(grid, def, 1e9);
  expect(built.success).toBe(true);
  const ramp: BuiltRamp = { id: 1, def, width, footprint: rampFootprint(def, width) };
  state.builtRamps.push(ramp);
  state.nextBuiltRampId = 2;
  return { state, grid, ramp };
}

function snapshot(state: GameState) {
  return {
    cash: state.cash,
    actions: state.pendingActions.length,
    planned: state.plannedRamps.length,
    builtWidth: state.builtRamps.map(r => r.width),
  };
}

describe('rampFootprint', () => {
  const cases: Array<[string, RampDef]> = [
    ['south', { originX: 15, originZ: 8, direction: 'south', length: 10, targetDepth: 4 }],
    ['north', { originX: 15, originZ: 25, direction: 'north', length: 10, targetDepth: 4 }],
    ['east', { originX: 8, originZ: 15, direction: 'east', length: 10, targetDepth: 4 }],
    ['west', { originX: 25, originZ: 15, direction: 'west', length: 10, targetDepth: 4 }],
  ];
  for (const [name, base] of cases) {
    for (const width of [3, 5, 7] as RampWidth[]) {
      it(`matches the bounding box of the carved cells for a ${name} ramp at width ${width}`, () => {
        const grid = makeElevatedGrid(40, 40, 22);
        const def = { ...base, width };
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const seg of defineRampSegments(grid, def)) for (const c of seg.cells) {
          minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
          minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
        }
        expect(rampFootprint(def, width)).toEqual({ minX, maxX, minZ, maxZ });
      });
    }
  }

  it('widens symmetrically about the origin line', () => {
    const f3 = rampFootprint(DEF, 3);
    const f7 = rampFootprint(DEF, 7);
    expect(f3.minX).toBe(9); expect(f3.maxX).toBe(11);
    expect(f7.minX).toBe(7); expect(f7.maxX).toBe(13);
    expect(f7.minZ).toBe(f3.minZ); expect(f7.maxZ).toBe(f3.maxZ);
  });
});

describe('findRampAtTile', () => {
  const mk = (id: number, minX: number, maxX: number, minZ: number, maxZ: number): BuiltRamp => ({
    id, def: DEF, width: 3, footprint: { minX, maxX, minZ, maxZ },
  });

  it('returns the ramp whose footprint contains the tile, bounds inclusive', () => {
    const r = mk(4, 9, 11, 5, 16);
    expect(findRampAtTile([r], 9, 5)).toBe(r);
    expect(findRampAtTile([r], 11, 16)).toBe(r);
    expect(findRampAtTile([r], 10, 10)).toBe(r);
  });

  it('returns the lowest-id ramp when footprints overlap', () => {
    const a = mk(3, 0, 10, 0, 10); const b = mk(1, 5, 15, 5, 15);
    expect(findRampAtTile([a, b], 7, 7)?.id).toBe(1);
  });

  it('returns null for a tile outside every footprint and for no ramps', () => {
    expect(findRampAtTile([mk(1, 9, 11, 5, 16)], 12, 10)).toBeNull();
    expect(findRampAtTile([mk(1, 9, 11, 5, 16)], 10, 17)).toBeNull();
    expect(findRampAtTile([], 0, 0)).toBeNull();
  });
});

describe('nextRampWidth', () => {
  it('steps through the options and ends at null', () => {
    expect(nextRampWidth(3)).toBe(5);
    expect(nextRampWidth(5)).toBe(7);
    expect(nextRampWidth(7)).toBeNull();
  });
});

describe('validateWidenRamp', () => {
  const ramp = (w: RampWidth): BuiltRamp => ({ id: 1, def: { ...DEF, width: w }, width: w, footprint: rampFootprint(DEF, w) });

  it('prices only the extra width', () => {
    const r = validateWidenRamp(ramp(3), 7, 1e9);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cost).toBeCloseTo(DEF.length * 4 * RAMP_COST_PER_METER_PER_WIDTH, 6);
  });

  it.each<[string, RampWidth, number, number]>([
    ['same width', 5, 5, 1e9],
    ['narrower', 5, 3, 1e9],
    ['not an option', 3, 4, 1e9],
    ['beyond the maximum', 3, 9, 1e9],
    ['insufficient cash', 3, 5, 1],
  ])('refuses %s', (_name, current, to, cash) => {
    const r = validateWidenRamp(ramp(current), to as RampWidth, cash);
    expect(r.success).toBe(false);
    if (!r.success) { expect(r.error.length).toBeGreaterThan(0); expect(r.errorKey).toMatch(/^(mining|console)\./); }
  });

  it('accepts cash exactly equal to the cost', () => {
    const cost = DEF.length * 2 * RAMP_COST_PER_METER_PER_WIDTH;
    expect(validateWidenRamp(ramp(3), 5, cost).success).toBe(true);
  });
});

describe('orderRampWiden', () => {
  it('charges only the delta cost and queues excavation for the new side strips only', () => {
    const { state, grid } = setup(3);
    const before = state.cash;
    const r = orderRampWiden(state, grid, 1, 5);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const delta = DEF.length * (5 - 3) * RAMP_COST_PER_METER_PER_WIDTH;
    expect(r.data.cost).toBeCloseTo(delta, 6);
    expect(before - state.cash).toBeCloseTo(delta, 6);

    expect(state.plannedRamps).toHaveLength(1);
    const planned = state.plannedRamps[0]!;
    expect(planned.id).toBe(r.data.plannedRampId);
    expect(planned.widenOf).toBe(1);
    expect(planned.segments.length).toBeGreaterThan(0);

    const xs = new Set<number>();
    for (const s of planned.segments) for (const c of s.cells) xs.add(c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual([8, 12]); // old corridor x 9..11 untouched
    const actions = state.pendingActions.filter(a => a.type === 'dig_ramp_segment');
    expect(actions).toHaveLength(planned.segments.length);
  });

  it('carves both new strips when going 3 to 7', () => {
    const { state, grid } = setup(3);
    const before = state.cash;
    const r = orderRampWiden(state, grid, 1, 7);
    expect(r.success).toBe(true);
    expect(before - state.cash).toBeCloseTo(DEF.length * 4 * RAMP_COST_PER_METER_PER_WIDTH, 6);
    const xs = new Set<number>();
    for (const s of state.plannedRamps[0]!.segments) for (const c of s.cells) xs.add(c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual([7, 8, 12, 13]);
  });

  it('charges only 5 to 7 delta for an already 5-wide ramp', () => {
    const { state, grid } = setup(5);
    const before = state.cash;
    expect(orderRampWiden(state, grid, 1, 7).success).toBe(true);
    expect(before - state.cash).toBeCloseTo(DEF.length * 2 * RAMP_COST_PER_METER_PER_WIDTH, 6);
  });

  it('leaves the ramp at its old width while the order is in flight', () => {
    const { state, grid } = setup(3);
    orderRampWiden(state, grid, 1, 5);
    expect(state.builtRamps[0]!.width).toBe(3);
    expect(state.builtRamps).toHaveLength(1);
  });

  const refusals: Array<[string, (s: ReturnType<typeof setup>) => Parameters<typeof orderRampWiden>]> = [
    ['an unknown ramp id', ({ state, grid }) => [state, grid, 99, 5]],
    ['a width equal to the current width', ({ state, grid }) => [state, grid, 1, 3]],
    ['a narrower width', ({ state, grid }) => [state, grid, 1, 3]],
    ['a width not in the options', ({ state, grid }) => [state, grid, 1, 4 as RampWidth]],
    ['a width beyond the maximum', ({ state, grid }) => [state, grid, 1, 9 as RampWidth]],
  ];
  for (const [name, args] of refusals) {
    it(`refuses ${name} without touching cash or the action queue`, () => {
      const fx = setup(name === 'a narrower width' ? 5 : 3);
      const before = snapshot(fx.state);
      const r = orderRampWiden(...args(fx));
      expect(r.success).toBe(false);
      if (!r.success) { expect(r.error.length).toBeGreaterThan(0); expect(r.errorKey).toMatch(/^(mining|console)\./); }
      expect(snapshot(fx.state)).toEqual(before);
    });
  }

  it('refuses when cash cannot cover the delta, changing nothing', () => {
    const fx = setup(3, 10);
    const before = snapshot(fx.state);
    const r = orderRampWiden(fx.state, fx.grid, 1, 7);
    expect(r.success).toBe(false);
    expect(snapshot(fx.state)).toEqual(before);
  });

  it('refuses a second widen while one is already in flight, changing nothing', () => {
    const { state, grid } = setup(3);
    expect(orderRampWiden(state, grid, 1, 5).success).toBe(true);
    const before = snapshot(state);
    const r = orderRampWiden(state, grid, 1, 7);
    expect(r.success).toBe(false);
    expect(snapshot(state)).toEqual(before);
  });
});
