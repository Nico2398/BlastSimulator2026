// BlastSimulator2026 — planItinerary (#1088)
// Pure function that plans the ordered legs an employee would travel to
// reach a goal, at two fidelities: 'estimate' (octile heuristic, cheap,
// for action-cost ranking) and 'exact' (real pathfinding, for the
// executor). Nothing consumes this yet — implemented by @implementer.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Goal, Itinerary } from './Itinerary.js';

export type PlanFidelity = 'estimate' | 'exact';

export function planItinerary(
  _state: GameState,
  _employee: Employee,
  _goal: Goal,
  _fidelity: PlanFidelity,
): Itinerary | null {
  // TODO(skeleton): implemented by @implementer
  return null;
}
