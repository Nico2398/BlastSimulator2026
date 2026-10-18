// BlastSimulator2026 — Player-facing text for a refused permit application (#1924)
// Shared by the console `permit apply` command and the Permits panel.

import { t } from '../i18n/I18n.js';
import { formatMoney } from './formatMoney.js';
import type { GradeApplyRefusal, GradeTargetKind } from './MineGrade.js';

/** Localised sentence explaining why an application was refused. */
export function permitRefusalText(
  refusal: GradeApplyRefusal,
  unmet: readonly GradeTargetKind[],
  nextFee: number,
  cash: number,
): string {
  switch (refusal) {
    case 'no_ladder': return t('permit.no_ladder');
    case 'pending': return t('permit.refusal.pending');
    case 'unmet_targets': {
      const targets = unmet.map(kind => t(`permit.kind.${kind}`)).join(', ');
      return t('permit.refusal.unmet_targets', { targets });
    }
    case 'insufficient_funds':
      return t('permit.refusal.insufficient_funds', { fee: formatMoney(nextFee), cash: formatMoney(cash) });
  }
}
