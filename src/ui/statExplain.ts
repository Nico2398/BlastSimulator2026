// BlastSimulator2026 — Explanation texts for employee and candidate stats
//
// What each stat does to the game, translated through t(); every number is read
// from balance.ts. Callers attach the text with explainable() / bindExplain().

import { t } from '../core/i18n/I18n.js';
import {
  MORALE_THRESHOLDS,
  NEED_THRESHOLDS,
  PAY_CYCLE_TICKS,
  PROFICIENCY_MULTIPLIERS,
  UNION_MEMBER_SALARY_DISCOUNT_PCT,
  XP_THRESHOLDS,
} from '../core/config/balance.js';

type Level = keyof typeof PROFICIENCY_MULTIPLIERS;

/** What proficiency `level` changes: task duration, and the XP needed for the next level. */
export function skillLevelExplain(level: number): string {
  const lv = Math.max(1, Math.min(5, Math.round(level))) as Level;
  const mult = PROFICIENCY_MULTIPLIERS[lv].toFixed(2);
  if (lv >= 5) return t('ui.explain.skill_level_max', { level: lv, mult });
  return t('ui.explain.skill_level', { level: lv, mult, next: XP_THRESHOLDS[(lv + 1) as 2 | 3 | 4 | 5] });
}

/** What low and high morale do. */
export function moraleExplain(): string {
  return t('ui.explain.morale', { low: MORALE_THRESHOLDS.low, high: MORALE_THRESHOLDS.high });
}

/** What the fatigue gauge does and what its threshold tick (the rest policy) means. */
export function fatigueExplain(): string {
  return t('ui.explain.fatigue', { low: NEED_THRESHOLDS.fatigue.low });
}

/** Which vehicle tiers a licence of `tier` allows. */
export function licenceExplain(tier: number): string {
  return t('ui.explain.licence', { tier });
}

/** The pay cycle a salary is charged on. */
export function salaryExplain(): string {
  return t('ui.explain.salary', { cycle: PAY_CYCLE_TICKS });
}

/** The salary discount and strike exposure of union membership. */
export function unionExplain(): string {
  return t('ui.explain.union', { pct: UNION_MEMBER_SALARY_DISCOUNT_PCT });
}

/** What a bare "h left" counts. */
export function ticksLeftExplain(): string {
  return t('ui.explain.ticks_left');
}
