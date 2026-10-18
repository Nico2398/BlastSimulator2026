// BlastSimulator2026 — Console command: permit status|apply (#1921)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { applyForGrade, gradeDef, nextGradeTargets, formatGradeAmount, type GradeTargetStatus } from '../../core/economy/MineGrade.js';
import { permitRefusalText } from '../../core/economy/permitRefusalText.js';
import { requireGame } from './commandUtils.js';

function targetLine(s: GradeTargetStatus): string {
  const text = t(`permit.target.${s.kind}`, { current: formatGradeAmount(s.current), needed: formatGradeAmount(s.needed) });
  return `  [${s.met ? 'x' : ' '}] ${text}`;
}

function permitStatus(ctx: GameContext): CommandResult {
  const state = ctx.state!;
  const g = state.grade;
  if (!g) return { success: false, output: t('permit.no_ladder') };

  const current = gradeDef(g.grade);
  const next = gradeDef(g.grade + 1);
  const lines = [
    t('permit.status.grade', { grade: g.grade, name: t(current.nameKey, current.nameParams) }),
    t('permit.status.next', { name: t(next.nameKey, next.nameParams), fee: formatMoney(next.fee), ticks: next.processingTicks }),
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
  const nextFee = gradeDef(state.grade.grade + 1).fee;
  return { success: false, output: permitRefusalText(result.refusal, result.unmet ?? [], nextFee, state.cash) };
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
