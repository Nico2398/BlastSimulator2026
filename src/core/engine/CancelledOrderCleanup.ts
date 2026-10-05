import type { GameState, PendingAction } from '../state/GameState.js';

/** Release the planned order a cancelled action reserved (#1380). */
export function releasePlannedOrderForCancelledAction(_state: GameState, _action: PendingAction): void {
  // TODO: implement
}
