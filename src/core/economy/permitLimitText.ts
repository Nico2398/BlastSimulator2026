// BlastSimulator2026 — Permit limit and strike wording shared by console and permit panel (#1924)

import { t } from '../i18n/I18n.js';
import { formatMoney } from './formatMoney.js';
import { permitLimitsFor, liveStrikes } from './PermitLimits.js';

interface PermitLimitTexts {
  limits: string;
  strikes: string;
}

/** Localised "per blast" limits line and live-strike line of the permit `grade`. */
export function permitLimitTexts(grade: number, strikeTicks: readonly number[], tick: number): PermitLimitTexts {
  const limits = permitLimitsFor(grade);
  return {
    limits: t('permit.status.limits', { kg: limits.maxChargeKg, holes: limits.maxHoles, fee: formatMoney(limits.fee) }),
    strikes: t('permit.status.strikes', { count: liveStrikes(strikeTicks, tick).length }),
  };
}
