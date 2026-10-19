// BlastSimulator2026 — One-time effects when a vanity project completes (#1947)

import { addBoardConfidence } from './Board.js';
import { clampScore } from '../scores/ScoreManager.js';
import type { GameState } from '../state/GameState.js';
import { VANITY_PROJECTS, type VanityType } from '../entities/BuildingVanity.js';

export function applyVanityCompletion(
  state: Pick<GameState, 'board' | 'scores' | 'employees'>,
  type: VanityType,
): void {
  const fx = VANITY_PROJECTS[type];
  addBoardConfidence(state.board, fx.boardConfidence);
  if (fx.moraleOnce !== undefined) {
    for (const e of state.employees.employees) {
      if (e.alive) e.morale = clampScore(e.morale + fx.moraleOnce);
    }
  }
  const scores = state.scores;
  if (fx.ecologyOnce !== undefined) scores.ecology = clampScore(scores.ecology + fx.ecologyOnce);
  // Neighbour relations: high = good, so a negative delta worsens them.
  if (fx.nuisanceOnce !== undefined) scores.nuisance = clampScore(scores.nuisance + fx.nuisanceOnce);
  if (fx.wellBeingOnce !== undefined) scores.wellBeing = clampScore(scores.wellBeing + fx.wellBeingOnce);
}
