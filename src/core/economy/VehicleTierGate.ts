// Quest-gated vehicle tiers on quest sites (#2282); the permit grade never matters.
import type { VehicleRole, VehicleTier } from '../entities/Vehicle.js';
import type { GameState } from '../state/GameState.js';
import { t } from '../i18n/I18n.js';
import { isQuestCompleted, questForVehicleTier, type QuestDef } from './Quests.js';

/** Null when allowed (or the site has no quests); else the quest to complete. */
export function vehicleTierGate(state: Pick<GameState, 'quests'>, tier: VehicleTier): QuestDef | null {
  if (!state.quests || tier === 1) return null;
  const quest = questForVehicleTier(tier);
  return quest && !isQuestCompleted(state, quest.id) ? quest : null;
}

/** What keeps a vehicle tier from being bought: a dealer quest, or (the shuttle) the mine grade. */
export type VehicleLock = { kind: 'quest'; quest: QuestDef } | { kind: 'grade'; grade: number };

/** The lock on `tier` of `role` (#2285): work roles by quest tier; the travel role by grade (T1) or its quest (T2). Null when allowed. */
export function vehicleLock(state: Pick<GameState, 'quests' | 'grade'>, role: VehicleRole, tier: VehicleTier): VehicleLock | null {
  void state; void role; void tier;
  throw new Error('not implemented');
}

/** Dealer refusal text for a gated purchase or upgrade; null when allowed. `role` defaults to a work role. */
export function vehicleTierRefusal(state: Pick<GameState, 'quests' | 'grade'>, tier: VehicleTier, role?: VehicleRole): string | null {
  void state; void tier; void role;
  throw new Error('not implemented');
}

/** Short lock label for any lock kind (grade lock names G2; quest lock is `vehicleTierLockLabel`). */
export function vehicleLockLabel(lock: VehicleLock): string {
  void lock;
  throw new Error('not implemented');
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(quest: QuestDef): string {
  return t('ui.fleet.tier_locked', { quest: t(quest.titleKey) });
}
