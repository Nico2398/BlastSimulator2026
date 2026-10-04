// BlastSimulator2026 — Wet hole derivation
// No per-tick water-level state is tracked per hole (see WeatherEffects.ts's
// unused HoleFloodState for that heavier model). Per the redesign spec, "rain
// fills uncovered holes": a hole reads as wet exactly when it's currently
// raining and has no tubing installed — stateless, recomputed on demand.

import type { HoleCharge } from './ChargePlan.js';
import type { GameState } from '../state/GameState.js';
import { isRaining, type WeatherState } from '../weather/WeatherCycle.js';

/** IDs of drill holes currently full of water: raining, and no tubing installed. */
export function wetHoles(state: GameState, weather: WeatherState): string[] {
  if (!isRaining(weather)) return [];
  return state.drillHoles
    .filter(hole => !state.tubingState.installedHoles.has(hole.id))
    .map(hole => hole.id);
}

/** Ids of wet holes as a set, for callers that test membership (previews, execution). */
export function wetHoleIdsFor(state: GameState, weather: WeatherState): Set<string> {
  return new Set(wetHoles(state, weather));
}

/** Wet charged holes in a blast: `wet` = wet ids carrying a charge (sorted); `fizzled` = the subset whose explosive is water-sensitive. */
export interface WetBlastHoles {
  wet: string[];
  fizzled: string[];
}

/** Split a blast's charges into wet holes and the ones whose water-sensitive explosive fizzles. Unknown explosive => not fizzled. */
export function classifyWetChargedHoles(
  _charges: Readonly<Record<string, HoleCharge>>,
  _wetHoleIds: ReadonlySet<string>,
): WetBlastHoles {
  // TODO: implement
  return { wet: [], fizzled: [] };
}
