// BlastSimulator2026 — Unit tests: queueing a multi-leg ramp order (#1939)

import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { defineRampSegments, validateRampOrder, type RampDef } from '../../../src/core/mining/Ramp.js';
import { queueRampOrder } from '../../../src/core/mining/RampOrder.js';
import { rampBoundingFootprint } from '../../../src/core/mining/RampPath.js';
import { recordBuiltRamp } from '../../../src/core/mining/RampWidening.js';

function makeGrid(): VoxelGrid {
  const grid = new VoxelGrid(60, 60);
  for (let z = 0; z < 60; z++)
    for (let x = 0; x < 60; x++)
      for (let y = 0; y <= 15; y++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

const LEGS = [{ direction: 'south' as const, length: 12 }, { direction: 'east' as const, length: 10 }];
const DEF: RampDef = { originX: 20, originZ: 10, direction: 'south', length: 22, targetDepth: 6, width: 3, legs: LEGS };

function order() {
  const state = createGame({ seed: 42 });
  state.cash = 1e6;
  const grid = makeGrid();
  const segments = defineRampSegments(grid, DEF);
  const cost = validateRampOrder(DEF, state.cash).cost;
  const footprint = rampBoundingFootprint({ originX: 20, originZ: 10, legs: LEGS }, 3);
  const id = queueRampOrder(state, DEF, footprint, segments, cost, 'Build ramp');
  return { state, segments, cost, id };
}

describe('queueRampOrder across legs (#1939)', () => {
  it('queues one dig_ramp_segment action per segment', () => {
    const { state, segments, id } = order();
    expect(id).not.toBeNull();
    const actions = state.pendingActions.filter(a => a.type === 'dig_ramp_segment');
    expect(actions).toHaveLength(segments.length);
  });

  it('queues segments in index order so leg k is dispatched before leg k+1', () => {
    const { state } = order();
    const planned = state.plannedRamps[0]!;
    expect(planned.segments.map(s => s.index)).toEqual(planned.segments.map((_, i) => i));
    const ids = planned.segments.map(s => s.actionId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('records the legs on the planned ramp definition', () => {
    const { state } = order();
    expect(state.plannedRamps[0]!.def.legs).toEqual(LEGS);
    expect(state.plannedRamps[0]!.def.length).toBe(22);
  });

  it('charges the full total-length cost once', () => {
    const { state, cost } = order();
    expect(cost).toBeGreaterThan(0);
    expect(1e6 - state.cash).toBeCloseTo(cost, 6);
  });

  it('the planned footprint is the path bounding box', () => {
    const { state } = order();
    expect(state.plannedRamps[0]!.footprint).toEqual({ minX: 19, maxX: 29, minZ: 10, maxZ: 23 });
  });
});

describe('recordBuiltRamp for a multi-leg order (#1939)', () => {
  it('records one built ramp whose def carries the ordered legs and a bounding-box footprint', () => {
    const { state } = order();
    const planned = state.plannedRamps[0]!;
    recordBuiltRamp(state, planned);
    expect(state.builtRamps).toHaveLength(1);
    expect(state.builtRamps[0]!.def.legs).toEqual(LEGS);
    expect(state.builtRamps[0]!.footprint).toEqual({ minX: 19, maxX: 29, minZ: 10, maxZ: 23 });
    expect(state.builtRamps[0]!.width).toBe(3);
  });
});
