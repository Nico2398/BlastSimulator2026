/** Inspector content for pending-order selections (#2266): what the order is, and how to cancel it. */
import type { GameState, PendingAction } from '../../../core/state/GameState.js';
import type { InspectorLinks, KindContent } from './InspectorContent.js';

/** True for actions the engine owns (rest, auto-generated debris orders): never player-cancellable. */
export function isEngineOwnedAction(action: PendingAction): boolean {
  void action;
  throw new Error('not implemented');
}

/** The cancel controls for `action` (Cancel, Cancel all N, or the managed-automatically note), shared with the hole inspector. */
export function orderControls(action: PendingAction, state: GameState, links: InspectorLinks): HTMLElement[] {
  void action; void state; void links;
  throw new Error('not implemented');
}

export const orderContent: KindContent = {
  view(entity, state, links) {
    void entity; void state; void links;
    throw new Error('not implemented');
  },
};
