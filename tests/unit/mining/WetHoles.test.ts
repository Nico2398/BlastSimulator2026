// BlastSimulator2026 — WetHoles unit tests

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { wetHoles } from '../../../src/core/mining/WetHoles.js';
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
