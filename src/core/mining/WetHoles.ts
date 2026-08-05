// BlastSimulator2026 — Wet hole derivation
// No per-tick water-level state is tracked per hole (see WeatherEffects.ts's
// unused HoleFloodState for that heavier model). Per the redesign spec, "rain
// fills uncovered holes": a hole reads as wet exactly when it's currently
// raining and has no tubing installed — stateless, recomputed on demand.

import type { GameState } from '../state/GameState.js';
import { isRaining, type WeatherState } from '../weather/WeatherCycle.js';

/** IDs of drill holes currently full of water: raining, and no tubing installed. */
export function wetHoles(state: GameState, weather: WeatherState): string[] {
  if (!isRaining(weather)) return [];
  return state.drillHoles
    .filter(hole => !state.tubingState.installedHoles.has(hole.id))
    .map(hole => hole.id);
}
