// BlastSimulator2026 — Mix scenario data
// The scenarios are data: check every request is for a sound that exists, is used
// the way its catalog entry allows, and is laid out in time.

import { describe, expect, it } from 'vitest';
import { SOUND_CATALOG, type SoundDefinition } from '../../../../src/audio/SoundCatalog.js';
import { buildMixScenario } from '../../../../src/audio/lab/mixScenarios.js';
import { isMixScenarioName, MIX_SCENARIO_NAMES, type MixScenario } from '../../../../src/audio/lab/mixTypes.js';
import { BLAST_AUDIO_CONFIG } from '../../../../src/core/config/audio/game.js';
import { LAB_RENDER_CONFIG } from '../../../../src/core/config/audio/lab.js';

const catalog: Readonly<Record<string, SoundDefinition>> = SOUND_CATALOG;

describe.each(MIX_SCENARIO_NAMES)('scenario %s', (name) => {
  const scenario = buildMixScenario(name);

  it('is named and has a listener and events', () => {
    expect(scenario.name).toBe(name);
    expect(scenario.title.length).toBeGreaterThan(5);
    expect(scenario.events.length).toBeGreaterThan(10);
    expect(scenario.listener).toEqual(LAB_RENDER_CONFIG.listener);
  });

  it('has events sorted by time, all inside the render', () => {
    const times = scenario.events.map(e => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...times)).toBeLessThan(scenario.durationS);
  });

  it('leaves room for the tail after its last event', () => {
    const last = Math.max(...scenario.events.map(e => e.t));
    expect(scenario.durationS - last).toBeGreaterThanOrEqual(0.5);
  });

  it('asks only for sounds in the catalog, used as one-shots or loops accordingly', () => {
    for (const event of scenario.events) {
      if (event.kind === 'duck') continue;
      const def = catalog[event.id];
      expect(def, `${event.id} is in the catalog`).toBeDefined();
      expect(def?.loop === true, `${event.id} is a loop`).toBe(event.kind === 'loop');
    }
  });

  it('gives a position only to sounds that are positional, and sets valid levels', () => {
    for (const event of scenario.events) {
      if (event.kind === 'play' && event.opts?.at) expect(catalog[event.id]?.spatial, `${event.id} is spatial`).toBe(true);
      if (event.kind === 'loop') {
        expect(event.level).toBeGreaterThanOrEqual(0);
        expect(event.level).toBeLessThanOrEqual(1);
      }
      if (event.kind === 'duck') expect(event.amountDb).toBeLessThan(0);
    }
  });

  it('is the same every time it is built', () => {
    expect(buildMixScenario(name)).toEqual(scenario);
  });
});

describe('the three scenarios together', () => {
  const all = MIX_SCENARIO_NAMES.map(buildMixScenario);

  it('play nearly every one-shot of the catalog', () => {
    const played = new Set<string>(all.flatMap(s => s.events.flatMap(e => (e.kind === 'play' ? [e.id] : []))));
    const missing = Object.entries(catalog).filter(([id, def]) => !def.loop && !played.has(id)).map(([id]) => id);
    // debris_pebble only plays for light, slow rain bins, which the planner decides
    expect(missing.filter(id => id !== 'debris_pebble')).toEqual([]);
  });

  it('start every bed of the catalog', () => {
    const started = new Set<string>(all.flatMap(s => s.events.flatMap(e => (e.kind === 'loop' && e.level > 0 ? [e.id] : []))));
    const beds = Object.entries(catalog).filter(([, def]) => def.loop).map(([id]) => id);
    expect(beds.filter(id => !started.has(id))).toEqual([]);
  });

  it('cover all three buses', () => {
    const buses = new Set(all.flatMap(s => s.events.flatMap(e => (e.kind === 'play' ? [catalog[e.id]?.bus] : []))));
    expect([...buses].sort()).toEqual(['ambient', 'effects', 'ui']);
  });
});

describe('ui-tour', () => {
  const scenario = buildMixScenario('ui-tour');
  it('keeps clicks to the same sound further apart than its cooldown, except the deliberate bursts', () => {
    const clicks = scenario.events.filter(e => e.kind === 'play' && e.id === 'ui_click').map(e => e.t);
    const gaps = clicks.slice(1).map((t, i) => t - (clicks[i] ?? 0));
    expect(gaps.filter(g => g * 1000 < (catalog.ui_click?.cooldownMs ?? 0))).toEqual([]);
  });
});

describe('blast', () => {
  const scenario = buildMixScenario('blast');
  const plays = scenario.events.flatMap(e => (e.kind === 'play' ? [e] : []));

  it('arms with a siren and quickening beeps, then fires the shot: snap and sub together, the sampled crack and boom just behind', () => {
    const beeps = plays.filter(e => e.id === 'blast_beep').map(e => e.t);
    expect(beeps.length).toBeGreaterThan(5);
    const gaps = beeps.slice(1).map((t, i) => t - (beeps[i] ?? 0));
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0] ?? 0);
    const snap = plays.find(e => e.id === 'blast_snap');
    const sub = plays.find(e => e.id === 'blast_sub');
    const crack = plays.find(e => e.id === 'blast_crack');
    expect(snap).toBeDefined();
    expect(sub?.t).toBe(snap?.t);
    expect(snap!.t).toBeGreaterThan(Math.max(...beeps));
    expect(crack!.t - snap!.t).toBeCloseTo(BLAST_AUDIO_CONFIG.crackDelayS, 9);
  });

  it('rains debris after the shot and ducks the ambience for it', () => {
    const shotAt = plays.find(e => e.id === 'blast_snap')!.t;
    const debris = plays.filter(e => e.id === 'debris_hit' || e.id === 'debris_pebble');
    expect(debris.length).toBeGreaterThan(20);
    expect(debris.every(e => e.t >= shotAt)).toBe(true);
    const ducks = scenario.events.filter(e => e.kind === 'duck');
    expect(ducks.some(d => d.t === shotAt && d.bus === 'ambient')).toBe(true);
  });

  it('runs the rain and wind beds under it and stops the siren before the shot', () => {
    const loops = scenario.events.flatMap(e => (e.kind === 'loop' ? [e] : []));
    expect(loops.some(l => l.id === 'amb_rain_heavy' && l.level > 0)).toBe(true);
    expect(loops.some(l => l.id === 'amb_wind' && l.level > 0)).toBe(true);
    const sirenOff = loops.find(l => l.id === 'blast_siren' && l.level === 0);
    expect(sirenOff!.t).toBeLessThan(plays.find(e => e.id === 'blast_snap')!.t);
  });
});

describe('busy-mine', () => {
  const scenario: MixScenario = buildMixScenario('busy-mine');

  it('lasts a minute and starts a storm for the last 15 seconds', () => {
    expect(scenario.durationS).toBe(60);
    const storm = scenario.events.filter(e => e.kind === 'loop' && e.id === 'amb_rain_heavy');
    expect(storm.map(e => e.t)).toEqual([45]);
    expect(scenario.events.filter(e => e.kind === 'play' && e.id === 'thunder').every(e => e.t > 45)).toBe(true);
  });

  it('keeps the work and hauling going the whole time', () => {
    for (const from of [0, 15, 30, 45]) {
      const work = scenario.events.filter(e => e.kind === 'play' && e.t >= from && e.t < from + 15 && /^(work|haul)_/.test(e.id));
      expect(work.length, `work after ${from} s`).toBeGreaterThan(3);
    }
  });
});

describe('isMixScenarioName', () => {
  it('knows the scenario names', () => {
    expect(isMixScenarioName('blast')).toBe(true);
    expect(isMixScenarioName('nope')).toBe(false);
  });
});
