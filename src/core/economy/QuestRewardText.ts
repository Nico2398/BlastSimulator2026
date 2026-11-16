// BlastSimulator2026 — Quest reward wording (#2283)
// One place words what a quest hands out, so the console, the Progression panel and the toast agree.

import { t } from '../i18n/I18n.js';
import { explosivesOfTier, type ExplosiveTier } from '../world/ExplosiveCatalog.js';
import type { QuestDef, QuestReward } from './Quests.js';

function explosiveNames(tier: ExplosiveTier): string {
  return explosivesOfTier(tier).map(e => t(e.nameKey)).join(', ');
}

/** The reward line shown under a quest. */
export function questRewardLine(reward: QuestReward): string {
  return reward.kind === 'explosive_tier'
    ? t('quest.reward', { tier: reward.tier, explosives: explosiveNames(reward.tier) })
    : t('quest.reward.building_tier', { tier: reward.tier });
}

/** The toast body when a quest completes. */
export function questCompletedBody(def: QuestDef): string {
  const { reward } = def;
  return reward.kind === 'explosive_tier'
    ? t('notification.quest.completed', { title: t(def.titleKey), explosives: explosiveNames(reward.tier) })
    : t('notification.quest.completed_buildings', { title: t(def.titleKey), tier: reward.tier });
}
