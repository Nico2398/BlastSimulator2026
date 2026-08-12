// BlastSimulator2026 — Cost-based per-employee action selection (#549)
// Skeleton only: type signatures + empty bodies. Real cost estimation,
// pathfinding-based resolution, and ranking logic land in the implementer
// phase. Zero imports from GameLoop.ts — avoids a dependency cycle back into
// the tick orchestrator that will call these functions.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';

/**
 * Cheap admissible cost estimate for `employee` performing `action`: octile-
 * heuristic travel ticks (see `octileHeuristic` in `Pathfinding.ts`) plus work
 * ticks (via `computeTaskDuration` inputs). No real pathfinding — used to
 * rank candidates before spending a real `findPath` call on only the most
 * promising ones.
 * TODO: implement.
 */
export function estimateActionCost(_state: GameState, _employee: Employee, _action: PendingAction): number {
  return undefined as unknown as number;
}

/**
 * Real findPath-based cost for `employee` performing `action`, or `null` if
 * the target is unreachable on the current NavGrid.
 * TODO: implement.
 */
export function resolveActionCost(_state: GameState, _employee: Employee, _action: PendingAction): { totalTicks: number } | null {
  return undefined as unknown as { totalTicks: number } | null;
}

/** A candidate action chosen for an employee, with its resolved real cost. */
export interface SelectedAction {
  action: PendingAction;
  totalTicks: number;
}

/**
 * Picks the best action for `employee` out of `candidates`. Ranks by
 * `estimateActionCost`, ties broken by lowest `action.id`, then resolves the
 * real cost (via `resolveActionCost`) only for the top candidates up to
 * `ACTION_SELECTION_MAX_PATH_ATTEMPTS`, returning the first reachable one.
 * Returns `null` when `candidates` is empty or none are reachable.
 * TODO: implement.
 */
export function selectBestActionForEmployee(_state: GameState, _employee: Employee, _candidates: PendingAction[]): SelectedAction | null {
  return undefined as unknown as SelectedAction | null;
}
