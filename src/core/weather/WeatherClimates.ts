// BlastSimulator2026 — Per-biome weather climates (#1688)
// A climate bundles the transition weights and state durations a biome's weather cycle runs on.
//
// Measured with tickWeather over 5 seeds x 6,000 ticks (shares in %) (wet = light_rain + heavy_rain + storm,
// dry spell = consecutive ticks with no wet state, median). See gameplay-game-design "Weather System".
//   climate    wet    heat_wave  cold_snap  storm   median dry spell
//   arid        6.4    16.0       0.9        0.2     43 ticks
//   tropical   45.4     2.7       0.1        4.1     12 ticks
//   temperate  28.3     4.4       3.0        2.0     29 ticks
//   alpine     12.7     0.3      28.8        0.4     47 ticks

import type { WeatherState } from './WeatherCycle.js';
import { WEATHER_FALLBACK_CLIMATE } from '../config/balance.js';

interface WeatherClimate {
  /** Weighted next-state options per state (weights are normalized at runtime). */
  transitions: Record<WeatherState, Array<[WeatherState, number]>>;
  /** Inclusive [min, max] tick duration per state (1 tick = 1 game-hour). */
  durations: Record<WeatherState, [min: number, max: number]>;
}

// Temperate: the original single-climate tables, verbatim.
const TEMPERATE: WeatherClimate = {
  durations: {
    sunny: [8, 20],
    cloudy: [6, 15],
    light_rain: [4, 12],
    heavy_rain: [3, 8],
    storm: [2, 6],
    heat_wave: [6, 16],
    cold_snap: [4, 10],
  },
  transitions: {
    sunny:      [['cloudy', 0.4], ['sunny', 0.3], ['heat_wave', 0.15], ['cold_snap', 0.1], ['light_rain', 0.05]],
    cloudy:     [['light_rain', 0.35], ['sunny', 0.30], ['cloudy', 0.20], ['heavy_rain', 0.10], ['cold_snap', 0.05]],
    light_rain: [['cloudy', 0.30], ['heavy_rain', 0.30], ['light_rain', 0.25], ['sunny', 0.15]],
    heavy_rain: [['storm', 0.30], ['light_rain', 0.30], ['heavy_rain', 0.20], ['cloudy', 0.20]],
    storm:      [['heavy_rain', 0.45], ['light_rain', 0.30], ['cloudy', 0.20], ['storm', 0.05]],
    heat_wave:  [['sunny', 0.50], ['cloudy', 0.30], ['heat_wave', 0.15], ['storm', 0.05]],
    cold_snap:  [['cloudy', 0.40], ['sunny', 0.30], ['cold_snap', 0.15], ['light_rain', 0.15]],
  },
};

// Arid: long sunny spells, frequent heat waves, rare short showers.
const ARID: WeatherClimate = {
  durations: {
    sunny: [14, 32],
    cloudy: [4, 10],
    light_rain: [2, 5],
    heavy_rain: [2, 4],
    storm: [2, 4],
    heat_wave: [8, 20],
    cold_snap: [3, 8],
  },
  transitions: {
    sunny:      [['sunny', 0.28], ['heat_wave', 0.23], ['cloudy', 0.22], ['cold_snap', 0.03], ['light_rain', 0.24]],
    cloudy:     [['sunny', 0.40], ['heat_wave', 0.10], ['cloudy', 0.10], ['light_rain', 0.42], ['cold_snap', 0.05]],
    light_rain: [['cloudy', 0.45], ['sunny', 0.35], ['light_rain', 0.10], ['heavy_rain', 0.10]],
    heavy_rain: [['light_rain', 0.40], ['cloudy', 0.40], ['storm', 0.10], ['heavy_rain', 0.10]],
    storm:      [['heavy_rain', 0.30], ['cloudy', 0.50], ['light_rain', 0.20]],
    heat_wave:  [['sunny', 0.50], ['heat_wave', 0.30], ['cloudy', 0.15], ['storm', 0.05]],
    cold_snap:  [['sunny', 0.50], ['cloudy', 0.40], ['cold_snap', 0.10]],
  },
};

// Tropical: warm, humid, rain most of the time, storms, almost never cold.
const TROPICAL: WeatherClimate = {
  durations: {
    sunny: [6, 14],
    cloudy: [5, 12],
    light_rain: [4, 9],
    heavy_rain: [3, 7],
    storm: [2, 6],
    heat_wave: [4, 10],
    cold_snap: [3, 6],
  },
  transitions: {
    sunny:      [['cloudy', 0.45], ['sunny', 0.20], ['light_rain', 0.15], ['heat_wave', 0.18], ['cold_snap', 0.02]],
    cloudy:     [['light_rain', 0.48], ['heavy_rain', 0.14], ['sunny', 0.20], ['cloudy', 0.18]],
    light_rain: [['heavy_rain', 0.30], ['light_rain', 0.25], ['cloudy', 0.30], ['sunny', 0.15]],
    heavy_rain: [['storm', 0.35], ['light_rain', 0.30], ['heavy_rain', 0.15], ['cloudy', 0.20]],
    storm:      [['heavy_rain', 0.40], ['light_rain', 0.25], ['storm', 0.10], ['cloudy', 0.25]],
    heat_wave:  [['sunny', 0.35], ['cloudy', 0.30], ['storm', 0.20], ['heat_wave', 0.15]],
    cold_snap:  [['cloudy', 0.60], ['light_rain', 0.30], ['sunny', 0.10]],
  },
};

// Alpine: frequent, long cold snaps; heat waves nearly absent; moderate precipitation.
const ALPINE: WeatherClimate = {
  durations: {
    sunny: [6, 16],
    cloudy: [6, 15],
    light_rain: [4, 10],
    heavy_rain: [3, 7],
    storm: [2, 6],
    heat_wave: [4, 8],
    cold_snap: [6, 14],
  },
  transitions: {
    sunny:      [['cloudy', 0.40], ['sunny', 0.25], ['cold_snap', 0.20], ['light_rain', 0.10], ['heat_wave', 0.02]],
    cloudy:     [['cold_snap', 0.30], ['sunny', 0.25], ['cloudy', 0.20], ['light_rain', 0.20], ['heavy_rain', 0.05]],
    light_rain: [['cloudy', 0.40], ['cold_snap', 0.25], ['light_rain', 0.20], ['heavy_rain', 0.10], ['sunny', 0.05]],
    heavy_rain: [['light_rain', 0.35], ['storm', 0.20], ['heavy_rain', 0.15], ['cloudy', 0.30]],
    storm:      [['heavy_rain', 0.35], ['cold_snap', 0.25], ['cloudy', 0.30], ['light_rain', 0.10]],
    heat_wave:  [['sunny', 0.60], ['cloudy', 0.40]],
    cold_snap:  [['cloudy', 0.35], ['cold_snap', 0.35], ['sunny', 0.20], ['light_rain', 0.10]],
  },
};

const CLIMATES: Record<string, WeatherClimate> = {
  arid: ARID,
  tropical: TROPICAL,
  temperate: TEMPERATE,
  alpine: ALPINE,
};

/** BiomeCatalog id -> climate name. */
const BIOME_CLIMATE: Record<string, string> = {
  desert_badlands: 'arid',
  red_canyon: 'arid',
  volcanic_flats: 'arid',
  tropical_karst: 'tropical',
  alpine_granite: 'alpine',
  green_foothills: 'temperate',
};

/** Climate for a biome id; unknown or undefined ids get the fallback (temperate) climate. */
export function getWeatherClimate(biomeId: string | undefined): WeatherClimate {
  const name = (biomeId !== undefined ? BIOME_CLIMATE[biomeId] : undefined) ?? WEATHER_FALLBACK_CLIMATE;
  return CLIMATES[name]!;
}
