// BlastSimulator2026 — Permit preview: view model of a plan against the mine's permit (#1925)

import type { GradeState } from '../../core/economy/MineGrade.js';
import { preFireCheck, liveStrikes } from '../../core/economy/PermitLimits.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { t } from '../../core/i18n/I18n.js';

/** Display-ready comparison of a blast plan with the current permit. */
export interface PermitPreview {
  over: boolean;
  /** Each value is flagged on its own: the plan kg exceeds the limit. */
  kgOver: boolean;
  /** The plan hole count exceeds the limit. */
  holesOver: boolean;
  kgText: string;
  holesText: string;
  fee: number;
  feeText: string;
  strikes: number;
  strikesText: string;
  warningText: string;
}

/** Plan shape needed: hole list and per-hole charges (matches `BlastPlan`). */
interface PermitPreviewPlan {
  holes: readonly unknown[];
  charges: Readonly<Record<string, { amountKg: number }>>;
}

/** Preview of `plan` against the permit of `grade`; null when the mine has no grade. */
export function permitPreview(
  grade: GradeState | undefined,
  plan: PermitPreviewPlan,
  tick: number,
): PermitPreview | null {
  if (!grade) return null;
  const check = preFireCheck(grade.grade, plan.charges, plan.holes.length);
  const strikes = liveStrikes(grade.strikeTicks ?? [], tick).length;
  const kg = Math.round(check.planKg * 10) / 10;
  return {
    over: check.over,
    kgOver: check.planKg > check.limits.maxChargeKg,
    holesOver: check.planHoles > check.limits.maxHoles,
    kgText: t('permit.preview.kg', { used: kg, limit: check.limits.maxChargeKg }),
    holesText: t('permit.preview.holes', { used: check.planHoles, limit: check.limits.maxHoles }),
    fee: check.fee,
    feeText: t('permit.preview.fee', { fee: formatMoney(check.fee) }),
    strikes,
    strikesText: t('permit.status.strikes', { count: strikes }),
    warningText: check.over ? t('permit.preview.warning') : '',
  };
}

/** Warning for a drill grid whose hole count exceeds the permit; null when within it. */
export function gridHoleLimitWarning(grade: GradeState | undefined, holeCount: number): string | null {
  if (!grade) return null;
  const { limits, over } = preFireCheck(grade.grade, {}, holeCount);
  return over ? t('permit.preview.grid_warning', { holes: holeCount, limit: limits.maxHoles }) : null;
}
