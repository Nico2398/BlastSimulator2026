// Quest-gated vehicle tiers on quest sites (#2282); the permit grade never matters.
import type { VehicleTier } from '../entities/Vehicle.js';
import type { GameState } from '../state/GameState.js';
import type { QuestDef } from './Quests.js';

/** Null when allowed (or the site has no quests); else the quest to complete. */
export function vehicleTierGate(_state: Pick<GameState, 'quests'>, _tier: VehicleTier): QuestDef | null {
  throw new Error('not implemented');
}

/** Dealer refusal text for a gated purchase or upgrade; null when allowed. */
export function vehicleTierRefusal(_state: Pick<GameState, 'quests'>, _tier: VehicleTier): string | null {
  throw new Error('not implemented');
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(_quest: QuestDef): string {
  throw new Error('not implemented');
}
