// BlastSimulator2026 — Console command: permit status|apply (#1921)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { applyForGrade, gradeDef, nextGradeTargets, type GradeTargetStatus } from '../../core/economy/MineGrade.js';
import { permitLimitsFor, liveStrikes } from '../../core/economy/PermitLimits.js';
import { requireGame } from './commandUtils.js';

/** Whole numbers as-is, fractions to one decimal. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.floor(n * 10) / 10).toFixed(1);
}

function targetLine(s: GradeTargetStatus): string {
  const text = t(`permit.target.${s.kind}`, { current: fmt(s.current), needed: fmt(s.needed) });
  return `  [${s.met ? 'x' : ' '}] ${text}`;
}

function permitStatus(ctx: GameContext): CommandResult {
  const state = ctx.state!;
  const g = state.grade;
  if (!g) return { success: false, output: t('permit.no_ladder') };

  const current = gradeDef(g.grade);
  const next = gradeDef(g.grade + 1);
  const limits = permitLimitsFor(g.grade);
  const lines = [
    t('permit.status.grade', { grade: g.grade, name: t(current.nameKey, current.nameParams) }),
    t('permit.status.next', { name: t(next.nameKey, next.nameParams), fee: formatMoney(next.fee), ticks: next.processingTicks }),
    t('permit.status.limits', { kg: limits.maxChargeKg, holes: limits.maxHoles, fee: formatMoney(limits.fee) }),
    t('permit.status.strikes', { count: liveStrikes(g.strikeTicks ?? [], state.tickCount).length }),
    ...nextGradeTargets(state).map(targetLine),
  ];
  if (g.pending) {
    const to = gradeDef(g.pending.toGrade);
    lines.push(t('permit.status.pending', { name: t(to.nameKey, to.nameParams), ticks: g.pending.ticksLeft }));
  }
  return { success: true, output: lines.join('\n') };
}

function permitApply(ctx: GameContext): CommandResult {
  const state = ctx.state!;
  if (!state.grade) return { success: false, output: t('permit.no_ladder') };
  const result = applyForGrade(state);
  if (result.ok) {
    const to = gradeDef(result.toGrade);
    return {
      success: true,
      output: t('permit.apply.success', { name: t(to.nameKey, to.nameParams), fee: formatMoney(result.fee), ticks: to.processingTicks }),
    };
  }
  switch (result.refusal) {
    case 'no_ladder': return { success: false, output: t('permit.no_ladder') };
    case 'pending': return { success: false, output: t('permit.refusal.pending') };
    case 'unmet_targets': {
      const targets = (result.unmet ?? []).map(kind => t(`permit.kind.${kind}`)).join(', ');
      return { success: false, output: t('permit.refusal.unmet_targets', { targets }) };
    }
    case 'insufficient_funds': {
      const fee = gradeDef(state.grade.grade + 1).fee;
      return { success: false, output: t('permit.refusal.insufficient_funds', { fee: formatMoney(fee), cash: formatMoney(state.cash) }) };
    }
  }
}

export function permitCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  switch (args[0]) {
    case 'status': return permitStatus(ctx);
    case 'apply': return permitApply(ctx);
    default: return { success: false, output: t('permit.usage') };
  }
}
