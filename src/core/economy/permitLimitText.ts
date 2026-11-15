// BlastSimulator2026 — Permit limit and strike wording shared by console and permit panel (#1924)

import { t } from '../i18n/I18n.js';
import { formatMoney } from './formatMoney.js';
import { permitLimitsForRung, liveStrikes } from './PermitLimits.js';
import { tierDef } from './MineGrade.js';

interface PermitLimitTexts {
  limits: string;
  strikes: string;
}

/** Localised one-line perk of tier `tier` of a named grade; the no-perk line when it grants none. */
export function tierPerkText(grade: number, tier: number): string {
  const perk = tierDef(grade, tier)?.perk;
  return perk ? t(`ui.permit.perk.${perk.kind}`, { value: perk.value }) : t('ui.permit.perk.none');
}

/** Localised live-strike line for the strike ticks at `tick`. */
export function permitStrikesText(strikeTicks: readonly number[], tick: number): string {
  return t('permit.status.strikes', { count: liveStrikes(strikeTicks, tick).length });
}

/** Localised "per blast" limits line and live-strike line of the permit at ladder step `rung` (`gradeRung`). */
export function permitLimitTexts(rung: number, strikeTicks: readonly number[], tick: number): PermitLimitTexts {
  const limits = permitLimitsForRung(rung);
  return {
    limits: t('permit.status.limits', { kg: limits.maxChargeKg, area: limits.maxAreaM2, fee: formatMoney(limits.fee) }),
    strikes: permitStrikesText(strikeTicks, tick),
  };
}
