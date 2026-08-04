// BlastSimulator2026 — Weather state machine
// Cycles through weather states with probabilistic transitions.
// Uses seeded PRNG for deterministic sequences.

import { Random } from '../math/Random.js';
import { TICKS_PER_DAY } from '../config/balance.js';

// ── Weather states ──

export type WeatherState =
  | 'sunny'
  | 'cloudy'
  | 'light_rain'
  | 'heavy_rain'
  | 'storm'
  | 'heat_wave'
  | 'cold_snap';

export const ALL_WEATHER_STATES: readonly WeatherState[] = [
  'sunny', 'cloudy', 'light_rain', 'heavy_rain', 'storm', 'heat_wave', 'cold_snap',
];

// ── Duration ranges (in game ticks) ──
// 1 tick = 1 game-hour (TICKS_PER_DAY = 24, matches the TopBar day/clock).
// Sunny: 8-20 ticks (under a day). Storm: 2-6 ticks (a few hours).

const DURATION_RANGES: Record<WeatherState, [min: number, max: number]> = {
  sunny: [8, 20],
  cloudy: [6, 15],
  light_rain: [4, 12],
  heavy_rain: [3, 8],
  storm: [2, 6],
  heat_wave: [6, 16],
  cold_snap: [4, 10],
};

// ── Transition probabilities ──
// Each state maps to possible next states with weights.
// Weights don't need to sum to 1 — they're normalized at runtime.

const TRANSITIONS: Record<WeatherState, Array<[WeatherState, number]>> = {
  sunny:      [['cloudy', 0.4], ['sunny', 0.3], ['heat_wave', 0.15], ['cold_snap', 0.1], ['light_rain', 0.05]],
  cloudy:     [['light_rain', 0.35], ['sunny', 0.30], ['cloudy', 0.20], ['heavy_rain', 0.10], ['cold_snap', 0.05]],
  light_rain: [['cloudy', 0.30], ['heavy_rain', 0.30], ['light_rain', 0.25], ['sunny', 0.15]],
  heavy_rain: [['storm', 0.30], ['light_rain', 0.30], ['heavy_rain', 0.20], ['cloudy', 0.20]],
  storm:      [['heavy_rain', 0.45], ['light_rain', 0.30], ['cloudy', 0.20], ['storm', 0.05]],
  heat_wave:  [['sunny', 0.50], ['cloudy', 0.30], ['heat_wave', 0.15], ['storm', 0.05]],
  cold_snap:  [['cloudy', 0.40], ['sunny', 0.30], ['cold_snap', 0.15], ['light_rain', 0.15]],
};

// ── Weather cycle data ──

export interface WeatherCycleState {
  current: WeatherState;
  ticksRemaining: number;
  history: WeatherState[];
}

/** Create initial weather cycle from seed. */
export function createWeatherCycle(seed: number): WeatherCycleState {
  const rng = new Random(seed);
  const initial: WeatherState = 'sunny';
  const duration = rng.nextInt(DURATION_RANGES[initial][0], DURATION_RANGES[initial][1]);
  return {
    current: initial,
    ticksRemaining: duration,
    history: [initial],
  };
}

/**
 * Advance the weather cycle by one tick.
 * When ticksRemaining hits 0, transition to next state.
 * Returns updated cycle state (mutates in place for efficiency).
 */
export function advanceWeather(cycle: WeatherCycleState, rng: Random): WeatherCycleState {
  cycle.ticksRemaining--;

  if (cycle.ticksRemaining <= 0) {
    const next = pickNextState(cycle.current, rng);
    const range = DURATION_RANGES[next];
    cycle.current = next;
    cycle.ticksRemaining = rng.nextInt(range[0], range[1]);
    cycle.history.push(next);
  }

  return cycle;
}

/** Force transition to next weather state (for testing/console). */
export function forceAdvance(cycle: WeatherCycleState, rng: Random): WeatherCycleState {
  cycle.ticksRemaining = 0;
  return advanceWeather(cycle, rng);
}

/**
 * Force the weather cycle directly to a given state, bypassing the
 * probabilistic transition table. `advance` is randomized by design — a
 * scenario that needs to demonstrate a specific state (or the full cycle in
 * order) has no other deterministic way to reach it (#408).
 */
export function setWeather(cycle: WeatherCycleState, state: WeatherState): WeatherCycleState {
  cycle.current = state;
  cycle.ticksRemaining = DURATION_RANGES[state][1];
  cycle.history.push(state);
  return cycle;
}

/**
 * Deterministic lookahead: the weather on each of the next `n` days.
 * Simulates forward on a clone of both `cycle` and `rng` — the live cycle
 * and its rng stream are untouched, so calling this doesn't consume any
 * randomness the real game loop would otherwise use.
 *
 * Returns `n` entries for days 1..n (tomorrow through day+n) — today is
 * deliberately excluded. A popover showing "today" alongside this outlook
 * must read `cycle.current` directly rather than treating index 0 of this
 * result as today, so the two can never disagree.
 */
export function forecast(cycle: WeatherCycleState, rng: Random, n = 14): WeatherState[] {
  const simCycle: WeatherCycleState = {
    current: cycle.current,
    ticksRemaining: cycle.ticksRemaining,
    history: [],
  };
  const simRng = rng.clone();
  const days: WeatherState[] = [];
  for (let day = 0; day < n; day++) {
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) advanceWeather(simCycle, simRng);
    days.push(simCycle.current);
  }
  return days;
}

// ── Helpers ──

function pickNextState(current: WeatherState, rng: Random): WeatherState {
  const options = TRANSITIONS[current];
  const totalWeight = options.reduce((s, [, w]) => s + w, 0);
  let roll = rng.nextFloat(0, totalWeight);

  for (const [state, weight] of options) {
    roll -= weight;
    if (roll <= 0) return state;
  }

  // Fallback (should not happen)
  return options[options.length - 1]![0];
}

/** Check if current weather involves rain (for hole flooding). */
export function isRaining(state: WeatherState): boolean {
  return state === 'light_rain' || state === 'heavy_rain' || state === 'storm';
}

/** Rain intensity: 0 = no rain, 1 = max rain. */
export function rainIntensity(state: WeatherState): number {
  switch (state) {
    case 'light_rain': return 0.3;
    case 'heavy_rain': return 0.7;
    case 'storm': return 1.0;
    default: return 0;
  }
}
