// BlastSimulator2026 — hole water fixture helpers (#1350)
//
// Wetness is per-hole state now, not "is it raining", so tests that need a wet
// hole put water in it directly instead of faking weather.

import type { GameState } from '../../src/core/state/GameState.js';

/** Put `level` (fraction of depth) of water into the given holes; porosity defaults to a tight rock. */
export function setHoleWater(state: GameState, holeIds: readonly string[], level = 0.9, porosity = 0.03): void {
  for (const id of holeIds) state.holeWater[id] = { level, porosity };
}

/** Make every drilled hole wet. */
export function wetAllHoles(state: GameState, level = 0.9, porosity = 0.03): void {
  setHoleWater(state, state.drillHoles.map(h => h.id), level, porosity);
}
