// BlastSimulator2026 — HoleDrain unit tests (#1350)

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { drainBlockReason, drainHoles } from '../../../src/core/mining/HoleDrain.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import {
  HOLE_DRAIN_COST_PER_HOLE,
  HOLE_DRAIN_POROSITY_LIMIT,
} from '../../../src/core/config/balance.js';
import { setHoleWater } from '../../helpers/holeWater.js';

const TIGHT = 0.03;
const POROUS = 0.35;
const RICH = HOLE_DRAIN_COST_PER_HOLE * 100;

function makeHole(id: string): DrillHole {
  return { id, x: 0, z: 0, depth: 8, diameter: 0.15 };
}

function stateWith(ids: string[], cash = RICH) {
  const state = createGame({ seed: 42 });
  state.drillHoles = ids.map(makeHole);
  state.cash = cash;
  state.finances.cash = cash;
  return state;
}

describe('drainBlockReason', () => {
  it('is null for a wet untubed tight hole with enough cash', () => {
    expect(drainBlockReason({ level: 0.9, porosity: TIGHT }, false, RICH)).toBeNull();
  });

  it('is null for a wet tubed porous hole (tube first, then drain)', () => {
    expect(drainBlockReason({ level: 0.9, porosity: POROUS }, true, RICH)).toBeNull();
  });

  it('is "dry" for a hole with no water state', () => {
    expect(drainBlockReason(undefined, false, RICH)).toBe('dry');
  });

  it('is "dry" for a hole at level 0', () => {
    expect(drainBlockReason({ level: 0, porosity: TIGHT }, false, RICH)).toBe('dry');
    expect(drainBlockReason({ level: 0, porosity: POROUS }, true, RICH)).toBe('dry');
  });

  it('is "porous_untubed" for an untubed hole in porous rock', () => {
    expect(drainBlockReason({ level: 0.9, porosity: POROUS }, false, RICH)).toBe('porous_untubed');
  });

  it('blocks an untubed hole exactly at the porosity limit, allows just below it', () => {
    expect(drainBlockReason({ level: 0.9, porosity: HOLE_DRAIN_POROSITY_LIMIT }, false, RICH)).toBe('porous_untubed');
    expect(drainBlockReason({ level: 0.9, porosity: HOLE_DRAIN_POROSITY_LIMIT - 0.01 }, false, RICH)).toBeNull();
  });

  it('is "insufficient_funds" when cash is below the drain cost', () => {
    expect(drainBlockReason({ level: 0.9, porosity: TIGHT }, false, HOLE_DRAIN_COST_PER_HOLE - 1)).toBe('insufficient_funds');
    expect(drainBlockReason({ level: 0.9, porosity: TIGHT }, false, 0)).toBe('insufficient_funds');
  });

  it('allows draining with exactly the drain cost in cash', () => {
    expect(drainBlockReason({ level: 0.9, porosity: TIGHT }, false, HOLE_DRAIN_COST_PER_HOLE)).toBeNull();
  });

  it('reports dry before cost when a dry hole is also unaffordable', () => {
    expect(drainBlockReason({ level: 0, porosity: TIGHT }, false, 0)).toBe('dry');
  });
});

describe('drainHoles', () => {
  it('drains a wet hole to level 0, charging the cost and logging an expense', () => {
    const state = stateWith(['H1']);
    setHoleWater(state, ['H1'], 0.9, TIGHT);
    const txBefore = state.finances.transactions.length;

    const res = drainHoles(state, ['H1']);

    expect(res.drained).toEqual(['H1']);
    expect(res.refused).toEqual({});
    expect(res.cost).toBe(HOLE_DRAIN_COST_PER_HOLE);
    expect(state.holeWater['H1']!.level).toBe(0);
    expect(state.cash).toBe(RICH - HOLE_DRAIN_COST_PER_HOLE);
    expect(state.finances.transactions.length).toBe(txBefore + 1);
    const tx = state.finances.transactions[state.finances.transactions.length - 1]!;
    expect(tx.type).toBe('expense');
    expect(tx.amount).toBe(HOLE_DRAIN_COST_PER_HOLE);
  });

  it('refuses a dry hole without charging', () => {
    const state = stateWith(['H1']);
    const res = drainHoles(state, ['H1']);
    expect(res.drained).toEqual([]);
    expect(res.refused).toEqual({ H1: 'dry' });
    expect(res.cost).toBe(0);
    expect(state.cash).toBe(RICH);
    expect(state.finances.transactions.length).toBe(0);
  });

  it('refuses an untubed porous hole, leaving its water and the cash alone', () => {
    const state = stateWith(['H1']);
    setHoleWater(state, ['H1'], 0.9, POROUS);
    const res = drainHoles(state, ['H1']);
    expect(res.refused).toEqual({ H1: 'porous_untubed' });
    expect(res.drained).toEqual([]);
    expect(state.holeWater['H1']!.level).toBe(0.9);
    expect(state.cash).toBe(RICH);
  });

  it('drains a tubed porous hole', () => {
    const state = stateWith(['H1']);
    setHoleWater(state, ['H1'], 0.9, POROUS);
    state.tubingState.installedHoles = new Set(['H1']);
    const res = drainHoles(state, ['H1']);
    expect(res.drained).toEqual(['H1']);
    expect(state.holeWater['H1']!.level).toBe(0);
    expect(state.cash).toBe(RICH - HOLE_DRAIN_COST_PER_HOLE);
  });

  it('reports an id that is not a drilled hole as unknown_hole', () => {
    const state = stateWith(['H1']);
    const res = drainHoles(state, ['NOPE']);
    expect(res.refused).toEqual({ NOPE: 'unknown_hole' });
    expect(res.cost).toBe(0);
    expect(state.cash).toBe(RICH);
  });

  it('batch with some blocked: drains the allowed ones, reports the rest, charges only successes', () => {
    const state = stateWith(['H1', 'H2', 'H3', 'H4']);
    setHoleWater(state, ['H1'], 0.9, TIGHT);
    setHoleWater(state, ['H2'], 0.9, POROUS); // porous untubed
    // H3 dry
    setHoleWater(state, ['H4'], 0.7, TIGHT);

    const res = drainHoles(state, ['H1', 'H2', 'H3', 'H4']);

    expect(res.drained).toEqual(['H1', 'H4']);
    expect(res.refused).toEqual({ H2: 'porous_untubed', H3: 'dry' });
    expect(res.cost).toBe(2 * HOLE_DRAIN_COST_PER_HOLE);
    expect(state.cash).toBe(RICH - 2 * HOLE_DRAIN_COST_PER_HOLE);
    expect(state.holeWater['H1']!.level).toBe(0);
    expect(state.holeWater['H4']!.level).toBe(0);
    expect(state.holeWater['H2']!.level).toBe(0.9);
  });

  it('with insufficient cash refuses and leaves state unchanged', () => {
    const state = stateWith(['H1'], HOLE_DRAIN_COST_PER_HOLE - 1);
    setHoleWater(state, ['H1'], 0.9, TIGHT);
    const res = drainHoles(state, ['H1']);
    expect(res.drained).toEqual([]);
    expect(res.refused).toEqual({ H1: 'insufficient_funds' });
    expect(res.cost).toBe(0);
    expect(state.cash).toBe(HOLE_DRAIN_COST_PER_HOLE - 1);
    expect(state.holeWater['H1']!.level).toBe(0.9);
    expect(state.finances.transactions.length).toBe(0);
  });

  it('does nothing for an empty id list', () => {
    const state = stateWith(['H1']);
    expect(drainHoles(state, [])).toEqual({ drained: [], refused: {}, cost: 0 });
    expect(state.cash).toBe(RICH);
  });

  it('keeps the water state of other holes untouched', () => {
    const state = stateWith(['H1', 'H2']);
    setHoleWater(state, ['H1', 'H2'], 0.9, TIGHT);
    drainHoles(state, ['H1']);
    expect(state.holeWater['H2']!.level).toBe(0.9);
  });
});
