// BlastSimulator2026 — Console tick command: advances the simulation
// Split from events.ts (#695). The tick orchestration itself now lives in
// src/core/engine/TickPipeline.ts's runTick (#1086) — this command keeps
// the pending-event refusal, the repeat-count loop, and formats the
// returned TickReport into the same console lines as before.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { runTick, type TickReport, type RunTickOptions, type FiredEventReport } from '../../core/engine/TickPipeline.js';
import { openMovementTrails } from '../../core/engine/Locomotion.js';
import { requireGame } from './commandUtils.js';
import { pushEventOptionLines } from './eventResolution.js';
import { formatTaskCompletion } from './tickTaskCompletion.js';
import { formatGameOver } from './tickGameOver.js';

export function tickCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  // If there's a pending event, refuse to tick — player must resolve it first
  if (state.events.pendingEvent) {
    return { success: false, output: t('tick.pending_event_refusal') };
  }

  const count = Math.max(1, parseInt(args[0] ?? '1', 10) || 1);
  const lines: string[] = [];
  const rng = new Random(state.seed + state.tickCount);
  const emitter = ctx.emitter;
  let ticksAdvanced = 0;

  const viteEnv = (import.meta as { env?: { PROD?: boolean } }).env;
  const isProd = viteEnv?.PROD === true;
  const options: RunTickOptions = { checkInvariants: !isProd };

  // One batch = one result the renderer draws: its walk trails cover exactly this command's ticks (#1199).
  openMovementTrails(state);

  for (let i = 0; i < count; i++) {
    const report: TickReport = runTick(state, ctx.grid ?? null, rng, emitter, options);
    ticksAdvanced++;

    for (const { penalty } of report.contractsExpired) {
      lines.push(`[tick ${state.tickCount}] Contract expired! Penalty: $${penalty}`);
    }

    if (report.smuggling.exposed) {
      lines.push(`[tick ${state.tickCount}] SMUGGLING EXPOSED! Investigation incoming.`);
    }

    if (report.mafiaExposed) {
      lines.push(`[tick ${state.tickCount}] MAFIA EXPOSURE! Criminal charges may follow.`);
    }

    for (const fe of report.needEvents) {
      lines.push(`[tick ${state.tickCount}] NEED: ${fe.eventId}`);
    }

    for (const done of report.trainingCompletions) {
      const what = done.isNew ? 'qualified in' : 'promoted to level ' + done.level + ' in';
      lines.push(`[tick ${state.tickCount}] ${done.employeeName} ${what} ${done.skill}.`);
    }

    for (const cancelled of report.trainingCancellations ?? []) {
      lines.push(`[tick ${state.tickCount}] ${cancelled.employeeName}'s ${cancelled.skill} course was cancelled — school #${cancelled.buildingId} was destroyed. $${cancelled.refund} refunded.`);
    }

    if (report.researchCancelled) {
      lines.push(`[tick ${state.tickCount}] Research cancelled: ${report.researchCancelled.targetType} tier ${report.researchCancelled.targetTier} — Research Center destroyed, $${report.researchCancelled.refund} refunded.`);
    }

    for (const { employeeId, report: completionReport } of report.taskCompletions) {
      const emp = state.employees.employees.find(e => e.id === employeeId);
      if (!emp) continue;
      formatTaskCompletion(state.tickCount, emp.name, completionReport, lines);
    }

    for (const empId of report.stuckEmployees) {
      const emp = state.employees.employees.find(e => e.id === empId);
      lines.push(`[tick ${state.tickCount}] STUCK: ${emp?.name ?? `employee #${empId}`} can't find a path — waiting.`);
    }
    for (const abandoned of report.abandonedActions) {
      const emp = state.employees.employees.find(e => e.id === abandoned.employeeId);
      lines.push(`[tick ${state.tickCount}] ACTION ABANDONED: ${emp?.name ?? `employee #${abandoned.employeeId}`} released a stuck claim back to the pool.`);
    }

    for (const cancelled of report.boardingCancelled) {
      const emp = state.employees.employees.find(e => e.id === cancelled.employeeId);
      lines.push(`[tick ${state.tickCount}] BOARDING CANCELLED: ${emp?.name ?? `employee #${cancelled.employeeId}`} (${cancelled.reason}).`);
    }

    for (const violation of report.worldInvariantViolations) {
      lines.push(`[tick ${state.tickCount}] WORLD INVARIANT VIOLATION: ${violation.kind} ${JSON.stringify(violation)}`);
    }

    formatGameOver(state.tickCount, report.gameOver, lines);

    const firedEvent: FiredEventReport | null = report.firedEvent;
    if (firedEvent) {
      const def = getEventById(firedEvent.eventId);
      if (def) {
        lines.push(`[tick ${state.tickCount}] EVENT: ${t(def.titleKey)}`);
        lines.push(`  ${t(def.descKey)}`);
        pushEventOptionLines(lines, def);
      }
      break;
    }

    if (report.paused) break;
  }

  if (lines.length === 0) {
    lines.push(t('tick.advanced_no_events', { advanced: ticksAdvanced, tick: state.tickCount }));
  } else if (ticksAdvanced < count) {
    lines.push(t('tick.advanced_partial', { advanced: ticksAdvanced, count }));
  }

  return { success: true, output: lines.join('\n') };
}
