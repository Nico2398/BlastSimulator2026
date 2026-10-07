// BlastSimulator2026 — Wet hole derivation
// No per-tick water-level state is tracked per hole (see WeatherEffects.ts's
// unused HoleFloodState for that heavier model). Per the redesign spec, "rain
// fills uncovered holes": a hole reads as wet exactly when it's currently
// raining and has no tubing installed — stateless, recomputed on demand.

import type { HoleCharge } from './ChargePlan.js';
import type { GameState } from '../state/GameState.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { waterEffect } from './BlastCalc.js';
import type { DrillHole } from './DrillPlan.js';
import type { WeatherState } from '../weather/WeatherCycle.js';

/** Advance every hole's water one tick from the current weather; `porosityOf` supplies rock porosity per hole. */
export function tickHoleWater(
  _state: GameState,
  _weather: WeatherState,
  _porosityOf: (hole: DrillHole) => number,
): void {
  // TODO: implement
}

/** IDs of drill holes whose water level is past the wet threshold. */
export function wetHoles(_state: GameState): string[] {
  // TODO: implement
  return [];
}

/** Ids of wet holes as a set, for callers that test membership (previews, execution). */
export function wetHoleIdsFor(state: GameState): Set<string> {
  return new Set(wetHoles(state));
}

/** Wet charged holes in a blast: `wet` = wet ids carrying a charge (sorted); `fizzled` = the subset whose explosive is water-sensitive. */
export interface WetBlastHoles {
  wet: string[];
  fizzled: string[];
}

/** Split a blast's charges into wet holes and the ones whose water-sensitive explosive fizzles. Unknown explosive => not fizzled. */
export function classifyWetChargedHoles(
  charges: Readonly<Record<string, HoleCharge>>,
  wetHoleIds: ReadonlySet<string>,
): WetBlastHoles {
  const wet = [...wetHoleIds].filter(id => charges[id] !== undefined).sort();
  const fizzled = wet.filter(id => {
    const explosive = getExplosive(charges[id]!.explosiveId);
    return explosive !== undefined && waterEffect(true, explosive.waterSensitive, false) < 1;
  });
  return { wet, fizzled };
}
