// BlastSimulator2026 — Weather state machine
// Cycles through weather states with probabilistic transitions.
// Uses seeded PRNG for deterministic sequences.

import { Random } from '../math/Random.js';
import { getWeatherClimate } from './WeatherClimates.js';
import { TICKS_PER_DAY, WEATHER_RNG_SEED_OFFSET, WEATHER_HISTORY_MAX } from '../config/balance.js';

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

// ── Weather cycle data ──

export interface WeatherCycleState {
  current: WeatherState;
  ticksRemaining: number;
  history: WeatherState[];
  /** Internal PRNG state of the cycle's own stream, persisted with the save. */
  rngState: number;
  /** When true the cycle holds `current` forever (fixed-weather levels, #1585). */
  pinned?: boolean;
}

/** True when `value` is a weather state name (type guard for untrusted/saved data). */
export function isWeatherState(value: unknown): value is WeatherState {
  return typeof value === 'string' && (ALL_WEATHER_STATES as readonly string[]).includes(value);
}

/** Create initial weather cycle from seed. `pinned` (optional) fixes the weather to that state for the whole game. */
export function createWeatherCycle(seed: number, pinned?: WeatherState, biomeId?: string): WeatherCycleState {
  const rngState = (seed + WEATHER_RNG_SEED_OFFSET) | 0;
  const { durations } = getWeatherClimate(biomeId);
  if (pinned) {
    return { current: pinned, ticksRemaining: durations[pinned][1], history: [pinned], rngState, pinned: true };
  }
  const rng = new Random(rngState);
  const initial: WeatherState = 'sunny';
  const duration = rng.nextInt(durations[initial][0], durations[initial][1]);
  return {
    current: initial,
    ticksRemaining: duration,
    history: [initial],
    rngState,
  };
}

/**
 * Advance the weather cycle by one tick.
 * When ticksRemaining hits 0, transition to next state.
 * Returns updated cycle state (mutates in place for efficiency).
 */
export function advanceWeather(cycle: WeatherCycleState, rng: Random, biomeId?: string): WeatherCycleState {
  cycle.ticksRemaining--;

  if (cycle.ticksRemaining <= 0) {
    const climate = getWeatherClimate(biomeId);
    const next = pickNextState(climate.transitions[cycle.current], rng);
    const range = climate.durations[next];
    cycle.current = next;
    cycle.ticksRemaining = rng.nextInt(range[0], range[1]);
    pushHistory(cycle, next);
  }

  return cycle;
}

/** Force transition to next weather state (for testing/console). */
export function forceAdvance(cycle: WeatherCycleState, rng: Random, biomeId?: string): WeatherCycleState {
  cycle.ticksRemaining = 0;
  return advanceWeather(cycle, rng, biomeId);
}

/** Run `step` on the cycle's own persisted PRNG stream, then store the stream's new state. */
function withCycleRng(cycle: WeatherCycleState, step: (rng: Random) => void): void {
  const rng = Random.fromState(cycle.rngState);
  step(rng);
  cycle.rngState = rng.snapshot();
}

/** Advance the cycle one tick on its own persisted PRNG stream; returns the resulting weather. */
export function tickWeather(cycle: WeatherCycleState, biomeId?: string): WeatherState {
  if (cycle.pinned) return cycle.current;
  withCycleRng(cycle, rng => advanceWeather(cycle, rng, biomeId));
  return cycle.current;
}

/** Force transition to the next weather state on the cycle's own PRNG stream (testing/console). */
export function forceAdvanceInState(cycle: WeatherCycleState, biomeId?: string): WeatherCycleState {
  withCycleRng(cycle, rng => forceAdvance(cycle, rng, biomeId));
  return cycle;
}

/**
 * Force the weather cycle directly to a given state, bypassing the
 * probabilistic transition table. `advance` is randomized by design — a
 * scenario that needs to demonstrate a specific state (or the full cycle in
 * order) has no other deterministic way to reach it (#408).
 */
export function setWeather(cycle: WeatherCycleState, state: WeatherState, biomeId?: string): WeatherCycleState {
  cycle.current = state;
  cycle.ticksRemaining = getWeatherClimate(biomeId).durations[state][1];
  pushHistory(cycle, state);
  return cycle;
}

/**
 * Deterministic lookahead: the weather on each of the next `n` days, ticking a
 * clone of `cycle` with the same primitive the pipeline uses — so entry N-1
 * equals the live `current` after N*TICKS_PER_DAY real ticks. The live cycle
 * (history and rngState included) is untouched.
 *
 * Returns `n` entries for days 1..n (tomorrow through day+n) — today is
 * deliberately excluded. A popover showing "today" alongside this outlook
 * must read `cycle.current` directly rather than treating index 0 of this
 * result as today, so the two can never disagree.
 */
export function forecast(cycle: WeatherCycleState, n = 14, biomeId?: string): WeatherState[] {
  const sim: WeatherCycleState = { ...cycle, history: [] };
  const days: WeatherState[] = [];
  for (let day = 0; day < n; day++) {
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) tickWeather(sim, biomeId);
    days.push(sim.current);
  }
  return days;
}

// ── Helpers ──

/** Append to history, dropping the oldest entries past WEATHER_HISTORY_MAX. */
function pushHistory(cycle: WeatherCycleState, state: WeatherState): void {
  cycle.history.push(state);
  if (cycle.history.length > WEATHER_HISTORY_MAX) {
    cycle.history.splice(0, cycle.history.length - WEATHER_HISTORY_MAX);
  }
}

function pickNextState(options: Array<[WeatherState, number]>, rng: Random): WeatherState {
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
