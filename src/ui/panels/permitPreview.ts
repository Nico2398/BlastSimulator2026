// BlastSimulator2026 — Permit preview: view model of a plan against the mine's permit (#1925)

import type { GradeState } from '../../core/economy/MineGrade.js';
import { preFireCheck, liveStrikes, inspectionChance, inspectionFine } from '../../core/economy/PermitLimits.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { t } from '../../core/i18n/I18n.js';
import { PERMIT_STRIKES_TO_SUSPEND } from '../../core/config/balance.js';
import { permitStrikesText } from '../../core/economy/permitLimitText.js';

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
  /** Chance an inspector turns up for this plan; 0 when within the permit. */
  inspectionChance: number;
  /** Fine if caught; 0 when within the permit. */
  fine: number;
  /** Chance, fine and strikes against the ban threshold; '' when within the permit. */
  consequenceText: string;
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
  const strikeTicks = grade.strikeTicks ?? [];
  const strikes = liveStrikes(strikeTicks, tick).length;
  const kg = Math.round(check.planKg * 10) / 10;
  const chance = check.over ? inspectionChance(check.overshoot) : 0;
  const fine = check.over ? inspectionFine(check.fee, check.overshoot) : 0;
  const consequenceText = check.over ? consequenceOf(check, strikes) : '';
  return {
    over: check.over,
    kgOver: check.planKg > check.limits.maxChargeKg,
    holesOver: check.planHoles > check.limits.maxHoles,
    kgText: t('permit.preview.kg', { used: kg, limit: check.limits.maxChargeKg }),
    holesText: t('permit.preview.holes', { used: check.planHoles, limit: check.limits.maxHoles }),
    fee: check.fee,
    feeText: t('permit.preview.fee', { fee: formatMoney(check.fee) }),
    strikes,
    strikesText: permitStrikesText(strikeTicks, tick),
    warningText: check.over ? t('permit.preview.warning', { consequence: consequenceText }) : '',
    inspectionChance: chance,
    fine,
    consequenceText,
  };
}

/** Warning for a drill placement whose plan total (existing + added holes) exceeds the permit; null when within it. */
export function gridHoleLimitWarning(
  grade: GradeState | undefined,
  addedHoles: number,
  existingHoles = 0,
  tick = 0,
): string | null {
  if (!grade) return null;
  const total = existingHoles + addedHoles;
  const over = overPermitConsequence(grade, {}, total, tick);
  return over ? t('permit.preview.grid_warning', { holes: total, limit: over.limits.maxHoles, consequence: over.consequence }) : null;
}

/** Warning for a plan charge total (kg) over the permit; null when within it. */
export function chargeKgLimitWarning(grade: GradeState | undefined, totalKg: number, tick = 0): string | null {
  if (!grade) return null;
  const over = overPermitConsequence(grade, { total: { amountKg: totalKg } }, 0, tick);
  return over ? t('permit.preview.kg_warning', { kg: Math.round(totalKg * 10) / 10, limit: over.limits.maxChargeKg, consequence: over.consequence }) : null;
}

/** Limits and consequence text of a plan over the permit; null when within it. */
function overPermitConsequence(
  grade: GradeState,
  charges: Readonly<Record<string, { amountKg: number }>>,
  holeCount: number,
  tick: number,
): { limits: ReturnType<typeof preFireCheck>['limits']; consequence: string } | null {
  const check = preFireCheck(grade.grade, charges, holeCount);
  if (!check.over) return null;
  const strikes = liveStrikes(grade.strikeTicks ?? [], tick).length;
  return { limits: check.limits, consequence: consequenceOf(check, strikes) };
}

/** Inspection chance, fine and strikes against the ban threshold, for an over-permit check. */
function consequenceOf(check: ReturnType<typeof preFireCheck>, strikes: number): string {
  return t('permit.preview.consequence', {
    chance: Math.round(inspectionChance(check.overshoot) * 100),
    fine: formatMoney(inspectionFine(check.fee, check.overshoot)),
    strikes,
    limit: PERMIT_STRIKES_TO_SUSPEND,
  });
}
