// Quest-gated vehicle tiers on quest sites (#2282); the permit grade never matters.
import type { VehicleRole, VehicleTier } from '../entities/Vehicle.js';
import type { GameState } from '../state/GameState.js';
import { t } from '../i18n/I18n.js';
import { MINE_GRADES, TRAVEL_VEHICLE_UNLOCK_GRADE } from '../config/balance.js';
import { isQuestCompleted, questForTravelTier, questForVehicleTier, type QuestDef } from './Quests.js';

/** Null when allowed (or the site has no quests); else the quest to complete. */
export function vehicleTierGate(state: Pick<GameState, 'quests'>, tier: VehicleTier): QuestDef | null {
  if (!state.quests || tier === 1) return null;
  const quest = questForVehicleTier(tier);
  return quest && !isQuestCompleted(state, quest.id) ? quest : null;
}

/** The slice of a site the dealer locks read: its quests and (progression sites) its current grade. */
export interface TierGateSite extends Pick<GameState, 'quests'> {
  grade?: { grade: number };
}

/** What keeps a vehicle tier from being bought: a dealer quest, or (the shuttle) the mine grade. */
export type VehicleLock = { kind: 'quest'; quest: QuestDef } | { kind: 'grade'; grade: number };

/** The lock on `tier` of `role` (#2285): work roles by quest tier; the travel role by grade (T1) or its quest (T2). Null when allowed. */
export function vehicleLock(state: TierGateSite, role: VehicleRole, tier: VehicleTier): VehicleLock | null {
  if (role !== 'travel_vehicle') {
    const quest = vehicleTierGate(state, tier);
    return quest ? { kind: 'quest', quest } : null;
  }
  if (tier === 1) {
    return state.grade !== undefined && state.grade.grade < TRAVEL_VEHICLE_UNLOCK_GRADE
      ? { kind: 'grade', grade: TRAVEL_VEHICLE_UNLOCK_GRADE }
      : null;
  }
  if (!state.quests) return null;
  const quest = questForTravelTier(2);
  return quest && !isQuestCompleted(state, quest.id) ? { kind: 'quest', quest } : null;
}

/** Dealer refusal text for a gated purchase or upgrade; null when allowed. `role` defaults to a work role. */
export function vehicleTierRefusal(state: TierGateSite, tier: VehicleTier, role: VehicleRole = 'debris_hauler'): string | null {
  const lock = vehicleLock(state, role, tier);
  if (lock === null) return null;
  if (lock.kind === 'grade') return t('vehicle.travel_grade_locked', { grade: lock.grade, name: t(MINE_GRADES[lock.grade]!.nameKey) });
  return t('vehicle.tier_locked', { quest: t(lock.quest.titleKey) });
}

/** Short lock label for any lock kind: the grade lock names the permit grade, the quest lock the quest. */
export function vehicleLockLabel(lock: VehicleLock): string {
  return lock.kind === 'grade'
    ? t('ui.fleet.grade_locked', { grade: lock.grade, name: t(MINE_GRADES[lock.grade]!.nameKey) })
    : vehicleTierLockLabel(lock.quest);
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(quest: QuestDef): string {
  return t('ui.fleet.tier_locked', { quest: t(quest.titleKey) });
}
