// BlastSimulator2026 — Player-facing text for a refused permit application (#1924)
// Shared by the console `permit apply` command and the Permits panel.

import type { GameState } from '../state/GameState.js';
import { t } from '../i18n/I18n.js';
import { formatMoney } from './formatMoney.js';
import { gradeDef, nextGradeTargets, type GradeApplyRefusal, type GradeTargetKind } from './MineGrade.js';

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

/** Pure dry-run of applyForGrade's checks: why it would refuse now, or null when it would accept. */
export function permitApplyBlocker(
  state: GameState,
): { refusal: GradeApplyRefusal; unmet: GradeTargetKind[] } | null {
  const g = state.grade;
  if (!g) return { refusal: 'no_ladder', unmet: [] };
  if (g.pending) return { refusal: 'pending', unmet: [] };
  const unmet = nextGradeTargets(state).filter(s => !s.met).map(s => s.kind);
  if (unmet.length > 0) return { refusal: 'unmet_targets', unmet };
  if (state.cash < gradeDef(g.grade + 1).fee) return { refusal: 'insufficient_funds', unmet: [] };
  return null;
}
