// BlastSimulator2026 — WetHoles unit tests

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { wetHoles, wetHoleIdsFor, classifyWetChargedHoles } from '../../../src/core/mining/WetHoles.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';

function makeHole(id: string): DrillHole {
  return { id, x: 0, z: 0, depth: 8, diameter: 0.15 };
}

describe('wetHoles', () => {
  it('returns every untubed hole while it is raining', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1'), makeHole('H2'), makeHole('H3')];
    state.tubingState.installedHoles = new Set(['H2']);

    expect(wetHoles(state, 'heavy_rain')).toEqual(['H1', 'H3']);
  });

  it('returns no holes when the weather is not raining', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1'), makeHole('H2')];
    state.tubingState.installedHoles = new Set();

    expect(wetHoles(state, 'sunny')).toEqual([]);
    expect(wetHoles(state, 'cloudy')).toEqual([]);
    expect(wetHoles(state, 'heat_wave')).toEqual([]);
    expect(wetHoles(state, 'cold_snap')).toEqual([]);
  });

  it('excludes every hole once all holes are tubed, even in a storm', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1'), makeHole('H2')];
    state.tubingState.installedHoles = new Set(['H1', 'H2']);

    expect(wetHoles(state, 'storm')).toEqual([]);
  });

  it('returns an empty list when there are no drill holes', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [];

    expect(wetHoles(state, 'light_rain')).toEqual([]);
  });
});

describe('wetHoleIdsFor', () => {
  it('returns the untubed hole ids as a set while raining', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1'), makeHole('H2'), makeHole('H3')];
    state.tubingState.installedHoles = new Set(['H2']);

    const ids = wetHoleIdsFor(state, 'heavy_rain');
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(['H1', 'H3']);
  });

  it('is empty when sunny', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1')];
    expect(wetHoleIdsFor(state, 'sunny').size).toBe(0);
  });

  it('is empty with no holes', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [];
    expect(wetHoleIdsFor(state, 'storm').size).toBe(0);
  });

  it('is empty when every hole is tubed', () => {
    const state = createGame({ seed: 42 });
    state.drillHoles = [makeHole('H1'), makeHole('H2')];
    state.tubingState.installedHoles = new Set(['H1', 'H2']);
    expect(wetHoleIdsFor(state, 'light_rain').size).toBe(0);
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
