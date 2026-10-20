// BlastSimulator2026 — WetHoles unit tests (#1350: wetness is per-hole water state)

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import {
  wetHoles,
  wetHoleIdsFor,
  tickHoleWater,
  classifyWetChargedHoles,
  fizzlingHoles,
  rainExposedHoles,
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
    expect([...ids]).toEqual(['H1', 'H3']);
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
    expect(r).toEqual({ wet: ['H1'], fizzled: ['H1'], chargedCount: 1 });
  });

  it('flags a wet krackle (emulsion) hole as wet only', () => {
    const r = classifyWetChargedHoles({ H1: charge('krackle') }, new Set(['H1']));
    expect(r).toEqual({ wet: ['H1'], fizzled: [], chargedCount: 1 });
  });

  it('ignores wet holes that carry no charge', () => {
    const r = classifyWetChargedHoles({ H1: charge('boomite') }, new Set(['H1', 'H2']));
    expect(r).toEqual({ wet: ['H1'], fizzled: ['H1'], chargedCount: 1 });
  });

  it('ignores charged holes that are dry', () => {
    const r = classifyWetChargedHoles({ H1: charge('boomite'), H2: charge('boomite') }, new Set(['H2']));
    expect(r).toEqual({ wet: ['H2'], fizzled: ['H2'], chargedCount: 2 });
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
    expect(classifyWetChargedHoles({ H1: charge('boomite') }, new Set())).toEqual({ wet: [], fizzled: [], chargedCount: 1 });
    expect(classifyWetChargedHoles({}, new Set(['H1']))).toEqual({ wet: [], fizzled: [], chargedCount: 0 });
  });

  it('treats an unknown explosive as wet but not fizzled, without throwing', () => {
    let r: { wet: string[]; fizzled: string[]; chargedCount: number } | undefined;
    expect(() => { r = classifyWetChargedHoles({ H1: charge('no_such_explosive') }, new Set(['H1'])); }).not.toThrow();
    expect(r).toEqual({ wet: ['H1'], fizzled: [], chargedCount: 1 });
  });

  it('chargedCount counts every charged hole, wet or dry (#1675)', () => {
    const r = classifyWetChargedHoles(
      { H1: charge('boomite'), H2: charge('krackle'), H3: charge('boomite'), H4: charge('boomite') },
      new Set(['H1', 'H9']),
    );
    expect(r.chargedCount).toBe(4);
    expect(r.fizzled).toEqual(['H1']);
  });
});

describe('fizzlingHoles (#1957)', () => {
  const charge = (explosiveId: string) => ({ explosiveId, amountKg: 8, stemmingM: 2 });

  it('lists charged wet holes with a water-sensitive charge, sorted', () => {
    const state = stateWith(['H3', 'H1', 'H2']);
    state.chargesByHole = { H3: charge('boomite'), H1: charge('boomite'), H2: charge('boomite') };
    setHoleWater(state, ['H3', 'H1'], 0.9);
    expect(fizzlingHoles(state)).toEqual(['H1', 'H3']);
  });

  it('agrees with classifyWetChargedHoles(...).fizzled', () => {
    const state = stateWith(['H1', 'H2', 'H3']);
    state.chargesByHole = { H1: charge('boomite'), H2: charge('krackle'), H3: charge('obliviax') };
    setHoleWater(state, ['H1', 'H2', 'H3'], 0.9);
    expect(fizzlingHoles(state)).toEqual(classifyWetChargedHoles(state.chargesByHole, wetHoleIdsFor(state)).fizzled);
    expect(fizzlingHoles(state)).toEqual(['H1', 'H3']);
  });

  it('ignores dry holes', () => {
    const state = stateWith(['H1', 'H2']);
    state.chargesByHole = { H1: charge('boomite'), H2: charge('boomite') };
    setHoleWater(state, ['H1'], HOLE_WET_THRESHOLD - 0.1);
    expect(fizzlingHoles(state)).toEqual([]);
  });

  it('ignores wet holes without a charge', () => {
    const state = stateWith(['H1', 'H2']);
    state.chargesByHole = { H1: charge('boomite') };
    setHoleWater(state, ['H1', 'H2'], 0.9);
    expect(fizzlingHoles(state)).toEqual(['H1']);
  });

  it('ignores water-resistant charges (krackle)', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('krackle') };
    setHoleWater(state, ['H1'], 0.9);
    expect(fizzlingHoles(state)).toEqual([]);
  });

  it('ignores an unknown explosive without throwing', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('no_such_explosive') };
    setHoleWater(state, ['H1'], 0.9);
    expect(fizzlingHoles(state)).toEqual([]);
  });

  it('tubing does not mask water already in the hole', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('boomite') };
    state.tubingState.installedHoles = new Set(['H1']);
    setHoleWater(state, ['H1'], 0.9);
    expect(fizzlingHoles(state)).toEqual(['H1']);
  });

  it('is empty with no holes or no charges', () => {
    expect(fizzlingHoles(stateWith([]))).toEqual([]);
    const state = stateWith(['H1']);
    setHoleWater(state, ['H1'], 0.9);
    expect(fizzlingHoles(state)).toEqual([]);
  });
});

describe('rainExposedHoles (#1957)', () => {
  const charge = (explosiveId: string) => ({ explosiveId, amountKg: 8, stemmingM: 2 });

  it('is empty when it is not raining, however sensitive the charges', () => {
    const state = stateWith(['H1', 'H2']);
    state.chargesByHole = { H1: charge('boomite'), H2: charge('obliviax') };
    for (const w of ['sunny', 'cloudy'] as const) {
      state.weather.current = w;
      expect(rainExposedHoles(state)).toEqual([]);
    }
  });

  it('lists charged untubed water-sensitive holes in light rain, dry or wet, sorted', () => {
    const state = stateWith(['H3', 'H1', 'H2']);
    state.chargesByHole = { H3: charge('boomite'), H1: charge('boomite'), H2: charge('obliviax') };
    setHoleWater(state, ['H2'], 0.9);
    state.weather.current = 'light_rain';
    expect(rainExposedHoles(state)).toEqual(['H1', 'H2', 'H3']);
  });

  it('counts every rain state: heavy rain and storm too', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('boomite') };
    for (const w of ['light_rain', 'heavy_rain', 'storm'] as const) {
      state.weather.current = w;
      expect(rainExposedHoles(state), w).toEqual(['H1']);
    }
  });

  it('excludes tubed holes', () => {
    const state = stateWith(['H1', 'H2']);
    state.chargesByHole = { H1: charge('boomite'), H2: charge('boomite') };
    state.tubingState.installedHoles = new Set(['H1']);
    state.weather.current = 'storm';
    expect(rainExposedHoles(state)).toEqual(['H2']);
  });

  it('excludes uncharged holes', () => {
    const state = stateWith(['H1', 'H2']);
    state.chargesByHole = { H1: charge('boomite') };
    state.weather.current = 'light_rain';
    expect(rainExposedHoles(state)).toEqual(['H1']);
  });

  it('excludes water-resistant charges (krackle)', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('krackle') };
    state.weather.current = 'storm';
    expect(rainExposedHoles(state)).toEqual([]);
  });

  it('excludes an unknown explosive without throwing', () => {
    const state = stateWith(['H1']);
    state.chargesByHole = { H1: charge('no_such_explosive') };
    state.weather.current = 'storm';
    expect(() => rainExposedHoles(state)).not.toThrow();
    expect(rainExposedHoles(state)).toEqual([]);
  });

  it('is empty with no holes', () => {
    const state = stateWith([]);
    state.weather.current = 'storm';
    expect(rainExposedHoles(state)).toEqual([]);
  });
});
