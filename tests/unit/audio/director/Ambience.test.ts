import { describe, it, expect } from 'vitest';
import { Ambience } from '../../../../src/audio/director/Ambience.js';
import { AMBIENCE_CONFIG } from '../../../../src/core/config/audio/game.js';
import type { WeatherState } from '../../../../src/core/weather/WeatherCycle.js';
import { makeHarness, type Harness } from './helpers.js';

const STEP = 0.1;
const cfg = AMBIENCE_CONFIG;

interface Input {
  weather: WeatherState | null;
  paused: boolean;
  menuUp: boolean;
  viewDistance: number | null;
}

const GAME: Input = { weather: 'sunny', paused: false, menuUp: false, viewDistance: 70 };

interface Fixture {
  readonly h: Harness;
  readonly ambience: Ambience;
  run(seconds: number, input: Partial<Input>): void;
  level(bed: 'amb_wind' | 'amb_rain_light' | 'amb_rain_heavy'): number;
}

function fixture(seed = 42): Fixture {
  const h = makeHarness({ seed });
  const ambience = new Ambience(h.env);
  return {
    h,
    ambience,
    run(seconds, input) {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        h.advance(STEP);
        ambience.update(STEP, { ...GAME, ...input });
      }
    },
    level: bed => h.player.bed(bed).level,
  };
}

describe('Ambience beds', () => {
  it('has no bed running before there is anything to hear', () => {
    const f = fixture();
    f.run(10, { weather: null });
    for (const bed of ['amb_wind', 'amb_rain_light', 'amb_rain_heavy'] as const) expect(f.h.player.bed(bed).calls).toEqual([]);
  });

  it('sets a calm wind and no rain in sunny weather', () => {
    const f = fixture();
    f.run(1, { weather: 'sunny', viewDistance: 70 });
    expect(f.level('amb_wind')).toBeGreaterThan(cfg.weather.sunny.wind * (1 - cfg.windViewSwing));
    expect(f.level('amb_wind')).toBeLessThan(cfg.weather.sunny.wind * (1 + cfg.windViewSwing));
    expect(f.h.player.bed('amb_rain_light').calls).toEqual([]);
    expect(f.h.player.bed('amb_rain_heavy').calls).toEqual([]);
  });

  it.each(['sunny', 'cloudy', 'light_rain', 'heavy_rain', 'storm', 'heat_wave', 'cold_snap'] as const)('settles on the %s levels, never above 1', weather => {
    const f = fixture();
    f.run(1, { weather, viewDistance: 70 });
    const levels = cfg.weather[weather];
    const swing = 1 + cfg.windViewSwing;
    expect(f.level('amb_wind')).toBeLessThanOrEqual(Math.min(1, levels.wind * swing) + 1e-9);
    expect(f.level('amb_wind')).toBeGreaterThan(0);
    expect(f.level('amb_rain_light')).toBeCloseTo(levels.rainLight, 6);
    expect(f.level('amb_rain_heavy')).toBeCloseTo(levels.rainHeavy, 6);
  });

  it('orders the wind from calm to storm', () => {
    const wind = (weather: WeatherState): number => {
      const f = fixture();
      f.run(1, { weather });
      return f.level('amb_wind');
    };
    expect(wind('heat_wave')).toBeLessThan(wind('sunny'));
    expect(wind('sunny')).toBeLessThan(wind('cloudy'));
    expect(wind('cloudy')).toBeLessThan(wind('heavy_rain'));
    expect(wind('heavy_rain')).toBeLessThan(wind('storm'));
  });

  it('swells the wind a little as the camera pulls back', () => {
    const wind = (viewDistance: number): number => {
      const f = fixture();
      f.run(1, { weather: 'cloudy', viewDistance });
      return f.level('amb_wind');
    };
    expect(wind(10)).toBeCloseTo(cfg.weather.cloudy.wind * (1 - cfg.windViewSwing), 6);
    expect(wind(500)).toBeCloseTo(cfg.weather.cloudy.wind * (1 + cfg.windViewSwing), 6);
    expect(wind(70)).toBeGreaterThan(wind(10));
    expect(wind(70)).toBeLessThan(wind(500));
  });

  it('uses the neutral wind without a listener', () => {
    const f = fixture();
    f.run(1, { weather: 'cloudy', viewDistance: null });
    expect(f.level('amb_wind')).toBeCloseTo(cfg.weather.cloudy.wind, 6);
  });

  it('cross-fades rain over a few seconds when the weather turns', () => {
    const f = fixture();
    f.run(1, { weather: 'light_rain' });
    f.run(1, { weather: 'heavy_rain' });
    const light = f.h.player.bed('amb_rain_light').calls;
    const heavy = f.h.player.bed('amb_rain_heavy').calls;
    expect(light.at(-1)).toEqual({ level: 0, rampS: cfg.rampS });
    expect(heavy.at(-1)).toEqual({ level: cfg.weather.heavy_rain.rainHeavy, rampS: cfg.rampS });
  });

  it('sends a level once per change, not once per frame', () => {
    const f = fixture();
    f.run(120, { weather: 'storm' });
    for (const bed of ['amb_wind', 'amb_rain_light', 'amb_rain_heavy'] as const) expect(f.h.player.bed(bed).calls.length).toBeLessThanOrEqual(1);
  });

  it('eases the weather beds while paused, but not to silence, and restores them', () => {
    const f = fixture();
    f.run(1, { weather: 'heavy_rain' });
    const running = f.level('amb_rain_heavy');
    f.run(1, { weather: 'heavy_rain', paused: true });
    expect(f.level('amb_rain_heavy')).toBeCloseTo(running * cfg.pausedFactor, 6);
    expect(f.level('amb_rain_heavy')).toBeGreaterThan(0);
    f.run(1, { weather: 'heavy_rain', paused: false });
    expect(f.level('amb_rain_heavy')).toBeCloseTo(running, 6);
  });

  it('fades everything but a very quiet wind away behind a menu', () => {
    const f = fixture();
    f.run(1, { weather: 'storm' });
    f.run(1, { weather: 'storm', menuUp: true });
    expect(f.level('amb_wind')).toBe(cfg.menuWindLevel);
    expect(f.level('amb_rain_light')).toBe(0);
    expect(f.level('amb_rain_heavy')).toBe(0);
    expect(f.h.player.bed('amb_wind').calls.at(-1)?.rampS).toBe(cfg.menuRampS);
    f.run(1, { weather: 'storm', menuUp: false });
    expect(f.level('amb_rain_heavy')).toBe(cfg.weather.storm.rainHeavy);
  });

  it('keeps the quiet wind at the main menu, where there is no game', () => {
    const f = fixture();
    f.run(2, { weather: null, menuUp: true });
    expect(f.level('amb_wind')).toBe(cfg.menuWindLevel);
    expect(f.level('amb_rain_heavy')).toBe(0);
  });

  it('fades every bed on clear', () => {
    const f = fixture();
    f.run(1, { weather: 'heavy_rain' });
    f.ambience.clear();
    expect(f.level('amb_wind')).toBe(0);
    expect(f.level('amb_rain_heavy')).toBe(0);
  });
});

describe('Ambience thunder', () => {
  it('follows a flash after a delay that feels like distance, quieter the farther', () => {
    const f = fixture();
    f.run(1, { weather: 'storm' });
    for (let i = 0; i < 200; i++) f.ambience.onLightning();
    const claps = f.h.player.of('thunder');
    expect(claps).toHaveLength(200);
    for (const clap of claps) {
      const delay = clap.opts.delayS ?? NaN;
      expect(delay).toBeGreaterThanOrEqual(cfg.thunder.minDelayS);
      expect(delay).toBeLessThanOrEqual(cfg.thunder.maxDelayS);
      expect(clap.opts.gainDb).toBeCloseTo(cfg.thunder.farthestDb * ((delay - cfg.thunder.minDelayS) / (cfg.thunder.maxDelayS - cfg.thunder.minDelayS)), 6);
    }
    expect(new Set(claps.map(c => (c.opts.delayS ?? 0).toFixed(2))).size).toBeGreaterThan(50);
  });

  it('stays quiet when nobody can see the sky: a menu, or no game', () => {
    const f = fixture();
    f.run(1, { weather: 'storm', menuUp: true });
    f.ambience.onLightning();
    f.run(1, { weather: null });
    f.ambience.onLightning();
    expect(f.h.player.plays).toHaveLength(0);
  });
});

describe('Ambience storm rumbles', () => {
  it('rumbles at long random intervals in a storm only', () => {
    const f = fixture();
    f.run(600, { weather: 'storm' });
    const rumbles = f.h.player.of('thunder');
    expect(rumbles.length).toBeGreaterThanOrEqual(600 / cfg.thunder.rumbleMaxIntervalS - 1);
    expect(rumbles.length).toBeLessThanOrEqual(600 / cfg.thunder.rumbleMinIntervalS);
    for (const rumble of rumbles) {
      expect(rumble.opts.delayS).toBeUndefined();
      expect(rumble.opts.gainDb).toBeGreaterThanOrEqual(cfg.thunder.rumbleMinDb);
      expect(rumble.opts.gainDb).toBeLessThanOrEqual(cfg.thunder.rumbleMaxDb);
    }
    const gaps = rumbles.slice(1).map((r, i) => r.atS - (rumbles[i]?.atS ?? 0));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(cfg.thunder.rumbleMinIntervalS - STEP);
      expect(gap).toBeLessThanOrEqual(cfg.thunder.rumbleMaxIntervalS + STEP);
    }
  });

  it.each(['sunny', 'cloudy', 'light_rain', 'heavy_rain', 'heat_wave', 'cold_snap'] as const)('never rumbles in %s weather', weather => {
    const f = fixture();
    f.run(600, { weather });
    expect(f.h.player.of('thunder')).toHaveLength(0);
  });

  it('is silent while paused or behind a menu, and starts a fresh interval after', () => {
    const f = fixture();
    f.run(300, { weather: 'storm', paused: true });
    f.run(300, { weather: 'storm', menuUp: true });
    expect(f.h.player.of('thunder')).toHaveLength(0);
    f.run(cfg.thunder.rumbleMinIntervalS - 1, { weather: 'storm' });
    expect(f.h.player.of('thunder')).toHaveLength(0);
  });
});
