import { describe, it, expect } from 'vitest';
import { DistantLife } from '../../../../src/audio/director/DistantLife.js';
import { cullM, distanceM } from '../../../../src/audio/director/listening.js';
import { SOUND_CATALOG } from '../../../../src/audio/SoundCatalog.js';
import { LIFE_CONFIG } from '../../../../src/core/config/audio/game.js';
import { listenerAt, makeHarness } from './helpers.js';

const STEP = 0.5;
const cfg = LIFE_CONFIG;

function run(h: ReturnType<typeof makeHarness>, life: DistantLife, seconds: number, active = true): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    h.advance(STEP);
    life.update(STEP, active);
  }
}

describe('DistantLife', () => {
  it('plays rarely: one far-off sound every 25 to 70 seconds', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 60) });
    const life = new DistantLife(h.env);
    run(h, life, 3600);
    const plays = h.player.plays;
    expect(plays.length).toBeGreaterThan(3600 / cfg.maxIntervalS - 2);
    expect(plays.length).toBeLessThan(3600 / cfg.minIntervalS + 2);
    const times = [0, ...plays.map(p => p.atS)];
    for (let i = 1; i < times.length - 0; i++) {
      const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
      if (i > 1) {
        expect(gap).toBeGreaterThanOrEqual(cfg.minIntervalS - STEP);
        expect(gap).toBeLessThanOrEqual(cfg.maxIntervalS + STEP);
      }
    }
  });

  it('plays catalog one-shots on the ambient bus, subdued and far away', () => {
    const h = makeHarness({ listener: listenerAt(10, 20, 80) });
    const life = new DistantLife(h.env);
    run(h, life, 7200);
    expect(h.player.plays.length).toBeGreaterThan(20);
    const configured = new Set(Object.keys(cfg.sounds));
    for (const play of h.player.plays) {
      expect(configured.has(play.id)).toBe(true);
      expect(play.opts.bus).toBe('ambient');
      expect(play.opts.gainDb).toBeGreaterThanOrEqual(cfg.minDb);
      expect(play.opts.gainDb).toBeLessThanOrEqual(cfg.maxDb);
      const distance = distanceM({ x: 10, z: 20 }, play.opts.at ?? { x: 0, z: 0 });
      expect(distance).toBeGreaterThanOrEqual(cfg.minDistanceM - 1e-6);
      expect(distance).toBeLessThanOrEqual(cfg.maxDistanceM + 1e-6);
    }
  });

  it('uses every configured sound, in their odds, from every direction', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 80) });
    const life = new DistantLife(h.env);
    run(h, life, 36000);
    const counts = new Map<string, number>();
    for (const p of h.player.plays) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    expect(new Set(counts.keys())).toEqual(new Set(Object.keys(cfg.sounds)));
    expect(counts.get('vehicle_scrap') ?? 0).toBeGreaterThan(counts.get('building_demolished') ?? 0);
    const quadrants = new Set(h.player.plays.map(p => `${Math.sign(p.opts.at?.x ?? 0)}${Math.sign(p.opts.at?.z ?? 0)}`));
    expect(quadrants.size).toBe(4);
  });

  it('never places a sound beyond what the engine would cull, even zoomed in', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 5) });
    const life = new DistantLife(h.env);
    run(h, life, 7200);
    expect(h.player.plays.length).toBeGreaterThan(20);
    for (const play of h.player.plays) {
      expect(distanceM({ x: 0, z: 0 }, play.opts.at ?? { x: 0, z: 0 })).toBeLessThanOrEqual(cullM(5) * cfg.maxCullShare + 1e-6);
    }
  });

  it('is silent while inactive and starts a fresh interval afterwards', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 60) });
    const life = new DistantLife(h.env);
    run(h, life, 600, false);
    expect(h.player.plays).toHaveLength(0);
    run(h, life, cfg.minIntervalS - 2);
    expect(h.player.plays).toHaveLength(0);
  });

  it('is silent without a listener', () => {
    const h = makeHarness({ listener: null });
    const life = new DistantLife(h.env);
    run(h, life, 600);
    expect(h.player.plays).toHaveLength(0);
  });

  it('starts a fresh interval after a reset', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 60) });
    const life = new DistantLife(h.env);
    run(h, life, cfg.minIntervalS - 2);
    life.reset();
    run(h, life, cfg.minIntervalS - 2);
    expect(h.player.plays).toHaveLength(0);
  });

  it('only draws from sounds that exist as one-shots in the catalog', () => {
    for (const id of Object.keys(cfg.sounds)) {
      const def = (SOUND_CATALOG as Record<string, { loop?: true }>)[id];
      expect(def, id).toBeDefined();
      expect(def?.loop, id).toBeUndefined();
    }
  });
});
