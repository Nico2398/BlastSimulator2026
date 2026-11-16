// Quest-gated vehicle tiers on quest sites (#2282); the permit grade never matters.
import type { VehicleTier } from '../entities/Vehicle.js';
import type { GameState } from '../state/GameState.js';
import { t } from '../i18n/I18n.js';
import { isQuestCompleted, questForVehicleTier, type QuestDef } from './Quests.js';

/** Null when allowed (or the site has no quests); else the quest to complete. */
export function vehicleTierGate(state: Pick<GameState, 'quests'>, tier: VehicleTier): QuestDef | null {
  if (!state.quests || tier === 1) return null;
  const quest = questForVehicleTier(tier);
  return quest && !isQuestCompleted(state, quest.id) ? quest : null;
}

/** Dealer refusal text for a gated purchase or upgrade; null when allowed. */
export function vehicleTierRefusal(state: Pick<GameState, 'quests'>, tier: VehicleTier): string | null {
  const quest = vehicleTierGate(state, tier);
  return quest ? t('vehicle.tier_locked', { tier, quest: t(quest.titleKey) }) : null;
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(quest: QuestDef): string {
  return t('ui.fleet.tier_locked', { quest: t(quest.titleKey) });
}
