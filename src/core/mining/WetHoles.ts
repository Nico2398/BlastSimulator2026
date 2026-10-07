// BlastSimulator2026 — Wet hole derivation
// Each drill hole carries a water level (GameState.holeWater) advanced per tick from the
// weather and ground wetness. A hole is wet while its stored level is past the wet threshold;
// tubing keeps water out but never masks water already in (#1350).

import type { HoleCharge } from './ChargePlan.js';
import type { GameState } from '../state/GameState.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { waterEffect } from './BlastCalc.js';
import type { DrillHole } from './DrillPlan.js';
import { hasTubing } from './Tubing.js';
import { rainIntensity, type WeatherState } from '../weather/WeatherCycle.js';
import { advanceGroundWetness, advanceHoleWater, isHoleFlooded } from '../weather/WeatherEffects.js';

/** Advance every hole's water one tick from the current weather; `porosityOf` supplies rock porosity per hole (sampled once, when the hole first appears). */
export function tickHoleWater(
  state: GameState,
  weather: WeatherState,
  porosityOf: (hole: DrillHole) => number,
): void {
  const rain = rainIntensity(weather);
  const live = new Set<string>();
  for (const hole of state.drillHoles) {
    live.add(hole.id);
    const hw = state.holeWater[hole.id] ?? { level: 0, porosity: porosityOf(hole) };
    state.holeWater[hole.id] = advanceHoleWater(hw, rain, state.groundWetness, hasTubing(state.tubingState, hole.id));
  }
  for (const id of Object.keys(state.holeWater)) {
    if (!live.has(id)) delete state.holeWater[id];
  }
  state.groundWetness = advanceGroundWetness(state.groundWetness, rain);
}

/** IDs of drill holes whose water level is past the wet threshold. */
export function wetHoles(state: GameState): string[] {
  return state.drillHoles
    .filter(hole => isHoleFlooded(state.holeWater[hole.id]?.level ?? 0))
    .map(hole => hole.id);
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
