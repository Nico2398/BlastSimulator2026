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
  // Neighbour relations (`nuisance`): high = good, so a negative delta worsens them.
  const deltas = [
    ['ecology', fx.ecologyOnce],
    ['nuisance', fx.nuisanceOnce],
    ['wellBeing', fx.wellBeingOnce],
  ] as const;
  for (const [score, delta] of deltas) {
    if (delta !== undefined) state.scores[score] = clampScore(state.scores[score] + delta);
  }
}
