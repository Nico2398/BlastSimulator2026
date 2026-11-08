// BlastSimulator2026 — Explanation texts for the world map and the level-end stats
//
// What a star, a difficulty chip and each level-end stat mean, translated through t();
// every number is read from balance.ts or the level. Callers attach the text with explainable().

import { t } from '../core/i18n/I18n.js';
import { STAR_ECOLOGY_MIN } from '../core/config/balance.js';
import { formatDollars } from '../core/economy/formatMoney.js';
import { getCampaignLevels } from '../core/campaign/Campaign.js';

export type LevelEndStatId =
  | 'profit' | 'days' | 'blasts' | 'volume' | 'max_depth' | 'unique_ores' | 'casualties' | 'best_safety'
  | 'quarters_survived' | 'final_balance' | 'salaries_paid' | 'fines_paid' | 'exposure_at_arrest'
  | 'arrangements_made' | 'corruption_level' | 'final_ecology' | 'best_ecology' | 'final_wellbeing' | 'shift_mode';

/** The star criteria, and whether this star is earned. */
export function starExplain(earned: boolean, target: number): string {
  return t(earned ? 'ui.explain.star_earned' : 'ui.explain.star_missing', {
    target: formatDollars(target),
    ecology: STAR_ECOLOGY_MIN,
  });
}

/** What a level's difficulty tier is and changes. */
export function difficultyExplain(tier: number, target: number): string {
  const max = Math.max(tier, ...getCampaignLevels().map(l => l.difficultyTier));
  return t('ui.explain.difficulty', { tier, max, target: formatDollars(target) });
}

/** What a level-end stat measures. */
export function levelEndStatExplain(id: LevelEndStatId): string {
  return t(`ui.explain.level_end.${id}`);
}
