// BlastSimulator2026 — Survey system
// Reveals voxel data at a surface position. Fog of war until surveyed.

import type { GameState } from '../state/GameState.js';

/** Cost to survey one column position. */
const SURVEY_COST = 100;

export interface SurveyResult {
  success: boolean;
  message: string;
  alreadySurveyed: boolean;
}

/** Check if a position has been surveyed. */
export function isSurveyed(state: GameState, x: number, z: number): boolean {
  return state.surveyedPositions.has(`${x},${z}`);
}

/**
 * Perform a survey at (x, z). Marks the column as revealed and deducts cost.
 * Re-surveying an already surveyed position is a no-op (no extra cost).
 */
export function performSurvey(state: GameState, x: number, z: number): SurveyResult {
  const key = `${x},${z}`;

  if (state.surveyedPositions.has(key)) {
    return { success: true, message: 'Already surveyed.', alreadySurveyed: true };
  }

  if (state.cash < SURVEY_COST) {
    return { success: false, message: `Not enough cash. Need $${SURVEY_COST}, have $${state.cash}.`, alreadySurveyed: false };
  }

  state.cash -= SURVEY_COST;
  state.surveyedPositions.add(key);
  return { success: true, message: `Surveyed (${x},${z}). Cost: $${SURVEY_COST}.`, alreadySurveyed: false };
}

export { SURVEY_COST };
