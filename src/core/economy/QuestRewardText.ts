// BlastSimulator2026 — Quest reward wording (#2283)
// The toast body of a completed quest, by reward kind.

import { t } from '../i18n/I18n.js';
import { explosivesOfTier, type ExplosiveTier } from '../world/ExplosiveCatalog.js';
import type { QuestDef } from './Quests.js';

function explosiveNames(tier: ExplosiveTier): string {
  return explosivesOfTier(tier).map(e => t(e.nameKey)).join(', ');
}

/** The toast body when a quest completes. */
export function questCompletedBody(def: QuestDef): string {
  const { reward } = def;
  const title = t(def.titleKey);
  switch (reward.kind) {
    case 'explosive_tier': return t('notification.quest.completed', { title, explosives: explosiveNames(reward.tier) });
    case 'vehicle_tier': return t('notification.quest.completed_vehicles', { title, tier: reward.tier });
    case 'building_tier': return t('notification.quest.completed_buildings', { title, tier: reward.tier });
  }
}
