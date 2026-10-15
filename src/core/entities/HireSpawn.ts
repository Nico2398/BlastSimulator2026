// BlastSimulator2026 — Where a new hire appears

import type { GameState } from '../state/GameState.js';
import { rallySpawnCell } from '../state/RallyPoint.js';

/**
 * Spawn cell for a mid-game hire: the free navigable cell nearest the site's
 * rally point (`rallySpawnCell`). Shared by the hire command and the
 * employee_joins event effect, and the same search a vehicle purchase makes.
 *
 * The search starts from `NavGrid.findNearestSpawnCell`, which rules out the
 * hazards a blast leaves behind: a floorless column (#437 — findPath rejects
 * an impassable start outright), a pocket walled off from the rest of the
 * map, and a fragment field whose cells still read 'walkable' but that the
 * hire can never step out of (#954). Every cell it then walks to is
 * climb-connected to that start, and none is shared with another agent.
 */
export function hireSpawnPoint(
  state: Pick<GameState, 'world' | 'navGrid' | 'employees' | 'vehicles' | 'rallyPoint'>,
): { x: number; z: number } {
  return rallySpawnCell(state, 'employee');
}
