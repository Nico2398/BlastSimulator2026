import { describe, it, expect } from 'vitest';
import { playCue } from '../../../../src/audio/director/playCue.js';
import { makeHarness, listenerAt } from './helpers.js';

describe('playCue', () => {
  it('plays a plain cue with its key and options', () => {
    const h = makeHarness();
    expect(playCue(h.env, { sound: 'ui_click', key: 'k', cooldownS: 0, gainDb: -2, pitchCents: 30, delayS: 0.5 })).toBe(true);
    expect(h.player.plays[0]?.opts).toEqual({ key: 'k', gainDb: -2, pitchCents: 30, delayS: 0.5 });
  });

  it('places a positional cue at its resolved position', () => {
    const h = makeHarness({ entityPosition: () => ({ x: 4, z: 5 }) });
    playCue(h.env, { sound: 'vehicle_horn', site: { entity: { kind: 'vehicle', id: 1 }, point: { x: 0, z: 0 } }, key: 'k', cooldownS: 0 });
    expect(h.player.plays[0]?.opts.at).toEqual({ x: 4, z: 5 });
  });

  it('skips a positional cue beyond the range factor without spending its cooldown', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 40) });
    const far = { sound: 'vehicle_horn', site: { point: { x: 5000, z: 0 } }, key: 'k', cooldownS: 5, rangeFactor: 2 } as const;
    expect(playCue(h.env, far)).toBe(false);
    expect(playCue(h.env, { ...far, site: { point: { x: 5, z: 0 } } })).toBe(true);
    expect(h.player.plays).toHaveLength(1);
  });

  it('defaults the range to the engine cull distance', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 40) });
    expect(playCue(h.env, { sound: 'vehicle_horn', site: { point: { x: 100000, z: 0 } }, key: 'k', cooldownS: 0 })).toBe(false);
    expect(playCue(h.env, { sound: 'vehicle_horn', site: { point: { x: 100, z: 0 } }, key: 'k', cooldownS: 0 })).toBe(true);
  });

  it('drops a cue still on cooldown and plays it again after', () => {
    const h = makeHarness();
    const cue = { sound: 'ui_click', key: 'k', cooldownS: 2 } as const;
    expect(playCue(h.env, cue)).toBe(true);
    expect(playCue(h.env, cue)).toBe(false);
    h.advance(2);
    expect(playCue(h.env, cue)).toBe(true);
  });
});
