import type { GameState, PendingAction } from '../state/GameState.js';

/**
 * Move the lead `dig_ramp_segment` layer of each planned ramp onto the nearest
 * column `canReach` accepts. Returns the number of layers moved.
 */
export function retargetRampLayers(
  state: Pick<GameState, 'plannedRamps' | 'pendingActions'>,
  canReach: (action: PendingAction, x: number, z: number) => boolean,
): number {
  void state; void canReach;
  // TODO: implement
  return 0;
}
