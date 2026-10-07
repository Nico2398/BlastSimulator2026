// BlastSimulator2026 — WetHoles unit tests (#1350: wetness is per-hole water state)

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import {
  wetHoles,
  wetHoleIdsFor,
  tickHoleWater,
  classifyWetChargedHoles,
} from '../../../src/core/mining/WetHoles.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { HOLE_WET_THRESHOLD } from '../../../src/core/config/balance.js';
import { setHoleWater } from '../../helpers/holeWater.js';

function makeHole(id: string): DrillHole {
  return { id, x: 0, z: 0, depth: 8, diameter: 0.15 };
}

function stateWith(ids: string[]) {
  const state = createGame({ seed: 42 });
  state.drillHoles = ids.map(makeHole);
  return state;
}

const TIGHT = () => 0.03;
const POROUS = () => 0.35;

function tickN(state: ReturnType<typeof stateWith>, weather: Parameters<typeof tickHoleWater>[1], n: number, porosityOf: (h: DrillHole) => number) {
  for (let i = 0; i < n; i++) tickHoleWater(state, weather, porosityOf);
}

describe('wetHoles', () => {
  it('lists holes whose water level is past the wet threshold, in hole order', () => {
    const state = stateWith(['H1', 'H2', 'H3']);
    setHoleWater(state, ['H1', 'H3'], HOLE_WET_THRESHOLD + 0.2);
    setHoleWater(state, ['H2'], HOLE_WET_THRESHOLD - 0.1);

    expect(wetHoles(state)).toEqual(['H1', 'H3']);
  });

  it('is empty for dry holes, even when it is raining right now', () => {
    const state = stateWith(['H1', 'H2']);
    state.weather.current = 'storm';
    expect(wetHoles(state)).toEqual([]);
  });

  it('keeps a tubed hole wet while it still holds water (tubing does not remove water)', () => {
    const state = stateWith(['H1', 'H2']);
    state.tubingState.installedHoles = new Set(['H1']);
    setHoleWater(state, ['H1', 'H2'], 0.9);

    expect(wetHoles(state)).toEqual(['H1', 'H2']);
  });

  it('ignores water entries of holes that no longer exist', () => {
    const state = stateWith(['H1']);
    setHoleWater(state, ['H1', 'GONE'], 0.9);
    expect(wetHoles(state)).toEqual(['H1']);
  });

  it('returns an empty list when there are no drill holes', () => {
    const state = stateWith([]);
    expect(wetHoles(state)).toEqual([]);
  });
});

describe('wetHoleIdsFor', () => {
  it('returns the wet hole ids as a set', () => {
    const state = stateWith(['H1', 'H2', 'H3']);
    setHoleWater(state, ['H1', 'H3'], 0.9);

    const ids = wetHoleIdsFor(state);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(['H1', 'H3']);
  });

  it('is empty when no hole holds water', () => {
    expect(wetHoleIdsFor(stateWith(['H1'])).size).toBe(0);
  });

  it('is empty with no holes', () => {
    expect(wetHoleIdsFor(stateWith([])).size).toBe(0);
  });

  it('agrees with wetHoles', () => {
    const state = stateWith(['H1', 'H2']);
    setHoleWater(state, ['H2'], 0.5);
    expect([...wetHoleIdsFor(state)]).toEqual(wetHoles(state));
  });
});

describe('tickHoleWater (#1350)', () => {
  it('leaves dry holes dry in sunny weather', () => {
    const state = stateWith(['H1']);
    tickN(state, 'sunny', 20, POROUS);
    expect(wetHoles(state)).toEqual([]);
    expect(state.holeWater['H1']?.level ?? 0).toBe(0);
  });

  it('an untubed hole is wet within 2 storm ticks', () => {
    const state = stateWith(['H1']);
    tickN(state, 'storm', 2, TIGHT);
    expect(wetHoles(state)).toEqual(['H1']);
  });

  it('light rain wets an untubed hole more slowly than a storm', () => {
    const light = stateWith(['H1']);
    const storm = stateWith(['H1']);
    tickN(light, 'light_rain', 2, TIGHT);
    tickN(storm, 'storm', 2, TIGHT);
    expect(light.holeWater['H1']!.level).toBeGreaterThan(0);
    expect(light.holeWater['H1']!.level).toBeLessThan(storm.holeWater['H1']!.level);
  });

  it('a tubed hole never rises, however hard it rains', () => {
    const state = stateWith(['H1', 'H2']);
    state.tubingState.installedHoles = new Set(['H1']);
    tickN(state, 'storm', 30, POROUS);
    expect(state.holeWater['H1']?.level ?? 0).toBe(0);
    expect(wetHoles(state)).toEqual(['H2']);
  });

  it('a hole tubed while wet keeps its level through the storm and the dry spell after', () => {
    const state = stateWith(['H1']);
    tickN(state, 'storm', 3, POROUS);
    const level = state.holeWater['H1']!.level;
    expect(level).toBeGreaterThan(HOLE_WET_THRESHOLD);
    state.tubingState.installedHoles = new Set(['H1']);
    tickN(state, 'storm', 10, POROUS);
    tickN(state, 'sunny', 100, POROUS);
    expect(state.holeWater['H1']!.level).toBe(level);
    expect(wetHoles(state)).toEqual(['H1']);
  });

  it('builds ground wetness in rain and lets it decay in dry weather', () => {
    const state = stateWith(['H1']);
    expect(state.groundWetness).toBe(0);
    tickN(state, 'storm', 5, TIGHT);
    const soaked = state.groundWetness;
    expect(soaked).toBeGreaterThan(0);
    tickN(state, 'sunny', 5, TIGHT);
    expect(state.groundWetness).toBeLessThan(soaked);
  });

  it('records each hole with its rock porosity from porosityOf', () => {
    const state = stateWith(['H1', 'H2']);
    tickN(state, 'storm', 1, h => (h.id === 'H1' ? 0.35 : 0.03));
    expect(state.holeWater['H1']!.porosity).toBe(0.35);
    expect(state.holeWater['H2']!.porosity).toBe(0.03);
  });

  it('a porous hole is wet from the ground after the storm ends; a tight hole is not', () => {
    const state = stateWith(['P', 'T']);
    const porosityOf = (h: DrillHole) => (h.id === 'P' ? 0.35 : 0.03);
    tickN(state, 'storm', 12, porosityOf);
    // Drain both by hand so only seepage from the soaked ground can refill them.
    state.holeWater['P']!.level = 0;
    state.holeWater['T']!.level = 0;
    tickN(state, 'sunny', 6, porosityOf);
    expect(state.holeWater['P']!.level).toBeGreaterThan(0);
    expect(wetHoleIdsFor(state).has('T')).toBe(false);
  });

  it('water in a porous hole outlasts water in a tight hole after the rain stops', () => {
    const state = stateWith(['P', 'T']);
    const porosityOf = (h: DrillHole) => (h.id === 'P' ? 0.35 : 0.03);
    tickN(state, 'storm', 10, porosityOf);
    let tightDryAt = -1;
    let porousDryAt = -1;
    for (let i = 1; i <= 400; i++) {
      tickHoleWater(state, 'sunny', porosityOf);
      if (tightDryAt < 0 && (state.holeWater['T']?.level ?? 0) <= 0) tightDryAt = i;
      if (porousDryAt < 0 && (state.holeWater['P']?.level ?? 0) <= 0) porousDryAt = i;
    }
    expect(tightDryAt).toBeGreaterThan(0);
    expect(porousDryAt).toBeGreaterThan(tightDryAt);
  });

  it('both fade to dry in the end', () => {
    const state = stateWith(['P', 'T']);
    const porosityOf = (h: DrillHole) => (h.id === 'P' ? 0.35 : 0.03);
    tickN(state, 'storm', 10, porosityOf);
    tickN(state, 'sunny', 600, porosityOf);
    expect(wetHoles(state)).toEqual([]);
  });

  it('handles an empty hole list', () => {
    const state = stateWith([]);
    expect(() => tickHoleWater(state, 'storm', TIGHT)).not.toThrow();
  });
});

describe('classifyWetChargedHoles (#1348)', () => {
  const charge = (explosiveId: string) => ({ explosiveId, amountKg: 8, stemmingM: 2 });

  it('flags a wet boomite hole as wet and fizzled', () => {
    const r = classifyWetChargedHoles({ H1: charge('boomite') }, new Set(['H1']));
    expect(r).toEqual({ wet: ['H1'], fizzled: ['H1'] });
  });

  it('flags a wet krackle (emulsion) hole as wet only', () => {
    const r = classifyWetChargedHoles({ H1: charge('krackle') }, new Set(['H1']));
    expect(r).toEqual({ wet: ['H1'], fizzled: [] });
  });

  it('ignores wet holes that carry no charge', () => {
    const r = classifyWetChargedHoles({ H1: charge('boomite') }, new Set(['H1', 'H2']));
    expect(r).toEqual({ wet: ['H1'], fizzled: ['H1'] });
  });

  it('ignores charged holes that are dry', () => {
    const r = classifyWetChargedHoles({ H1: charge('boomite'), H2: charge('boomite') }, new Set(['H2']));
    expect(r).toEqual({ wet: ['H2'], fizzled: ['H2'] });
  });

  it('splits a mixed blast and sorts ids', () => {
    const r = classifyWetChargedHoles(
      { H3: charge('boomite'), H1: charge('krackle'), H2: charge('boomite') },
      new Set(['H3', 'H2', 'H1']),
    );
    expect(r.wet).toEqual(['H1', 'H2', 'H3']);
    expect(r.fizzled).toEqual(['H2', 'H3']);
  });

  it('returns empty lists for no wet holes or no charges', () => {
    expect(classifyWetChargedHoles({ H1: charge('boomite') }, new Set())).toEqual({ wet: [], fizzled: [] });
    expect(classifyWetChargedHoles({}, new Set(['H1']))).toEqual({ wet: [], fizzled: [] });
  });

  it('treats an unknown explosive as wet but not fizzled, without throwing', () => {
    let r: { wet: string[]; fizzled: string[] } | undefined;
    expect(() => { r = classifyWetChargedHoles({ H1: charge('no_such_explosive') }, new Set(['H1'])); }).not.toThrow();
    expect(r).toEqual({ wet: ['H1'], fizzled: [] });
  });
});
