// BlastSimulator2026 — Tick-based game loop
// Pure function: takes state + dt, mutates state, returns nothing.
// Each tick: advance time → update subsystems (stubs) → increment tick count.

import type { GameState } from './GameState.js';

/**
 * Advance the game by one tick.
 * @param state - mutable game state
 * @param dt - raw delta time in milliseconds (before timeScale)
 */
export function tick(state: GameState, dt: number): void {
  if (state.isPaused) return;

  const scaledDt = dt * state.timeScale;
  state.time += scaledDt;

  // Subsystem updates — stubs, wired in as phases are implemented
  // updateWeather(state, scaledDt);
  // updateEvents(state, scaledDt);
  // updateVehicles(state, scaledDt);
  // updatePhysics(state, scaledDt);  // only during active blast
  // updateScores(state);
  // checkWinLose(state);

  state.tickCount++;
}
