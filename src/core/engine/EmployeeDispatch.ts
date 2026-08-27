// BlastSimulator2026 — Employee dispatch (#549 cost-based)
//
// Matches queued PendingActions to idle employees, ranked by
// estimateActionCost/selectBestActionForEmployee (ActionSelection.ts) instead
// of first-come-first-served. The per-employee claim/promote steps this
// function calls live in EmployeeDispatchSteps.ts. Split out of GameLoop.ts
// as part of #759's file-size split; re-exported there so GameLoop.ts stays
// the single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { EmployeeWorkState } from '../entities/EmployeeNeeds.js';
import type { TickEmployeesResult } from './EmployeeDispatchSteps.js';

/**
 * Match pending actions to idle qualified employees, ranked by cost
 * (travel time + work duration) instead of first-come-first-served (#549).
 * See GameLoop.ts's pre-#759 doc comment for the full three-step
 * per-employee dispatch algorithm this was extracted from.
 */
export function tickEmployees(state: GameState): TickEmployeesResult {
  void state;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Work-state classification for NEED_DRAIN_RATES purposes (#680).
 * See EmployeeWorkState for the three states.
 */
export function employeeWorkState(emp: Employee): EmployeeWorkState {
  void emp;
  // TODO: implement
  throw new Error('not implemented');
}
