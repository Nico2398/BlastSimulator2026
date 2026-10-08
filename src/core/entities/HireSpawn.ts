// BlastSimulator2026 — Where a new hire appears

import type { GameState } from '../state/GameState.js';
import { NavGrid } from '../nav/NavGrid.js';

/**
 * Spawn cell for a mid-game hire: the grid centre, offset by roster size, snapped to
 * the nearest traversable cell. Shared by the hire command and the employee_joins event effect.
 *
 * Same hazards as the vehicle purchase spawn point, which makes the
 * same call: a blast can clear the grid centre where new hires spawn
 * down to a floorless column (#437 — findPath rejects an impassable
 * start outright, so such a hire can never path anywhere again), wall
 * the nearest traversable tiles off from the rest of the map, or bury
 * the point in a fragment field whose cells still read 'walkable' but
 * that the hire can never step out of (#954: tutorial-playthrough's
 * own manager and driver both landed in a fresh crater's fragment
 * field this way, boxed in, re-claiming and re-failing the same
 * freight_warehouse order for 400+ ticks). findNearestSpawnCell rules
 * out all three — see its own doc for why the anchor it snaps against
 * is derived rather than the literal corner this call site used to
 * assume (#1151).
 */
export function hireSpawnPoint(state: Pick<GameState, 'world' | 'navGrid' | 'employees'>): { x: number; z: number } {
  const rawX = state.world ? state.world.minX + state.world.sizeX / 2 + (state.employees.employees.length % 5) * 2 : 32;
  const rawZ = state.world ? state.world.minZ + state.world.sizeZ / 2 : 32;
  return state.navGrid ? NavGrid.findNearestSpawnCell(state.navGrid, rawX, rawZ) : { x: rawX, z: rawZ };
}
