// BlastSimulator2026 — Per-biome weather climates (#1688)

import { describe, it, expect } from 'vitest';
import { getWeatherClimate } from '../../../src/core/weather/WeatherClimates.js';
import {
  ALL_WEATHER_STATES,
  createWeatherCycle,
  tickWeather,
  type WeatherState,
} from '../../../src/core/weather/WeatherCycle.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';

/** The pre-#1688 global tables: the temperate/fallback climate must equal them exactly. */
const OLD_DURATIONS: Record<WeatherState, [number, number]> = {
  sunny: [8, 20],
  cloudy: [6, 15],
  light_rain: [4, 12],
  heavy_rain: [3, 8],
  storm: [2, 6],
  heat_wave: [6, 16],
  cold_snap: [4, 10],
};
const OLD_TRANSITIONS: Record<WeatherState, Array<[WeatherState, number]>> = {
  sunny:      [['cloudy', 0.4], ['sunny', 0.3], ['heat_wave', 0.15], ['cold_snap', 0.1], ['light_rain', 0.05]],
  cloudy:     [['light_rain', 0.35], ['sunny', 0.30], ['cloudy', 0.20], ['heavy_rain', 0.10], ['cold_snap', 0.05]],
  light_rain: [['cloudy', 0.30], ['heavy_rain', 0.30], ['light_rain', 0.25], ['sunny', 0.15]],
  heavy_rain: [['storm', 0.30], ['light_rain', 0.30], ['heavy_rain', 0.20], ['cloudy', 0.20]],
  storm:      [['heavy_rain', 0.45], ['light_rain', 0.30], ['cloudy', 0.20], ['storm', 0.05]],
  heat_wave:  [['sunny', 0.50], ['cloudy', 0.30], ['heat_wave', 0.15], ['storm', 0.05]],
  cold_snap:  [['cloudy', 0.40], ['sunny', 0.30], ['cold_snap', 0.15], ['light_rain', 0.15]],
};

const WET = new Set<WeatherState>(['light_rain', 'heavy_rain', 'storm']);
const SEEDS = [1, 7, 42, 123, 2026];
const TICKS_PER_SEED = 5000; // 25,000 total

interface Census {
  total: number;
  share: Record<WeatherState, number>;
  wetShare: number;
  medianDrySpell: number;
}

function census(biome: string | undefined): Census {
  const counts = Object.fromEntries(ALL_WEATHER_STATES.map(s => [s, 0])) as Record<WeatherState, number>;
  let total = 0;
  let wet = 0;
  const spells: number[] = [];
  for (const seed of SEEDS) {
    const cycle = createWeatherCycle(seed, undefined, biome);
    let run = 0;
    for (let i = 0; i < TICKS_PER_SEED; i++) {
      const s = tickWeather(cycle, biome);
      counts[s]++;
      total++;
      if (WET.has(s)) {
        wet++;
        if (run > 0) spells.push(run);
        run = 0;
      } else {
        run++;
      }
    }
  }
  spells.sort((a, b) => a - b);
  const share = Object.fromEntries(ALL_WEATHER_STATES.map(s => [s, counts[s] / total])) as Record<WeatherState, number>;
  return { total, share, wetShare: wet / total, medianDrySpell: spells[Math.floor(spells.length / 2)] ?? 0 };
}

describe('getWeatherClimate (#1688)', () => {
  it('temperate fallback for undefined, "desert" and unknown ids equals the pre-change tables', () => {
    for (const id of [undefined, 'desert', 'no_such_biome', '']) {
      const c = getWeatherClimate(id);
      expect(c.transitions).toEqual(OLD_TRANSITIONS);
      expect(c.durations).toEqual(OLD_DURATIONS);
    }
  });

  it('green_foothills uses the temperate (old) tables', () => {
    const c = getWeatherClimate('green_foothills');
    expect(c.transitions).toEqual(OLD_TRANSITIONS);
    expect(c.durations).toEqual(OLD_DURATIONS);
  });

  it('every catalog biome id maps to a climate', () => {
    const biomes = getAllBiomes();
    expect(biomes.length).toBe(6);
    for (const b of biomes) {
      const c = getWeatherClimate(b.id);
      expect(c).toBeDefined();
      expect(Object.keys(c.transitions).sort()).toEqual([...ALL_WEATHER_STATES].sort());
    }
  });

  it('arid biomes share one climate, distinct from temperate', () => {
    const desert = getWeatherClimate('desert_badlands');
    expect(getWeatherClimate('red_canyon')).toEqual(desert);
    expect(getWeatherClimate('volcanic_flats')).toEqual(desert);
    expect(desert).not.toEqual(getWeatherClimate('green_foothills'));
  });

  it('tropical and alpine climates differ from each other and from arid/temperate', () => {
    const all = ['desert_badlands', 'tropical_karst', 'alpine_granite', 'green_foothills'].map(getWeatherClimate);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(all[i]).not.toEqual(all[j]);
    }
  });

  it.each(getAllBiomes().map(b => b.id))('%s profile references only valid states with positive weights and sane durations', (id) => {
    const c = getWeatherClimate(id);
    for (const s of ALL_WEATHER_STATES) {
      const out = c.transitions[s];
      expect(out.length).toBeGreaterThan(0);
      expect(out.reduce((a, [, w]) => a + w, 0)).toBeGreaterThan(0);
      for (const [next, w] of out) {
        expect(ALL_WEATHER_STATES).toContain(next);
        expect(w).toBeGreaterThan(0);
      }
      const [min, max] = c.durations[s];
      expect(min).toBeGreaterThanOrEqual(1);
      expect(max).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('weather census by biome (#1688)', () => {
  const desert = census('desert_badlands');
  const tropical = census('tropical_karst');
  const alpine = census('alpine_granite');
  const temperate = census('green_foothills');

  it('runs at least 25,000 ticks', () => {
    expect(desert.total).toBeGreaterThanOrEqual(25000);
  });

  it('desert wet share < 10%, tropical > 40%', () => {
    expect(desert.wetShare).toBeLessThan(0.10);
    expect(tropical.wetShare).toBeGreaterThan(0.40);
  });

  it('wet share orders tropical > temperate > desert', () => {
    expect(tropical.wetShare).toBeGreaterThan(temperate.wetShare);
    expect(temperate.wetShare).toBeGreaterThan(desert.wetShare);
  });

  it('red_canyon and volcanic_flats are also dry (< 15% wet)', () => {
    expect(census('red_canyon').wetShare).toBeLessThan(0.15);
    expect(census('volcanic_flats').wetShare).toBeLessThan(0.15);
  });

  it('alpine has more cold_snap than desert and temperate', () => {
    expect(alpine.share.cold_snap).toBeGreaterThan(desert.share.cold_snap);
    expect(alpine.share.cold_snap).toBeGreaterThan(temperate.share.cold_snap);
  });

  it('arid has more heat_wave than tropical and alpine', () => {
    expect(desert.share.heat_wave).toBeGreaterThan(tropical.share.heat_wave);
    expect(desert.share.heat_wave).toBeGreaterThan(alpine.share.heat_wave);
  });

  it('tropical has more storm than temperate', () => {
    expect(tropical.share.storm).toBeGreaterThan(temperate.share.storm);
  });

  it('median dry spell in desert is at least 2x tropical', () => {
    expect(desert.medianDrySpell).toBeGreaterThanOrEqual(2 * tropical.medianDrySpell);
  });
});
