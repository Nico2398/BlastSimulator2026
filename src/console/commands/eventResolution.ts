// BlastSimulator2026 — Console commands for event context building and resolution
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { EventDef, EventContext } from '../../core/events/EventPool.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { resolveEvent } from '../../core/events/EventResolver.js';
import { clearLastOutcome } from '../../core/events/EventSystem.js';
import { getLivingEmployees } from '../../core/entities/Employee.js';
import { requireGame } from './commandUtils.js';

/** Build the EventContext from the current GameState. */
export function buildEventContext(ctx: GameContext): EventContext {
  const s = ctx.state!;
  return {
    scores: s.scores,
    employeeCount: getLivingEmployees(s.employees.employees).length,
    deathCount: s.damage.deathCount,
    corruptionLevel: s.corruption.level,
    hasBuilding: (type: string) => s.buildings.buildings.some(b => b.type === type),
    hasDrillPlan: s.drillHoles.length > 0,
    tickCount: s.tickCount,
    lawsuitCount: s.corruption.attempts.filter(a => a.target === 'judge').length,
    activeContractCount: s.contracts.active.length,
    weatherId: 'clear', // TODO: wire actual weather when available
  };
}

/**
 * Appends the numbered option list and the "how to decide" hint shared by
 * every place a pending event gets reported to the player (auto-fired mid-tick
 * and the "event fire" debug command) — mutates `lines` in place.
 */
export function pushEventOptionLines(lines: string[], def: EventDef): void {
  for (let j = 0; j < def.options.length; j++) {
    lines.push(`  [${j}] ${t(def.options[j]!.labelKey)}`);
  }
  lines.push('  → Use "event choose <index>" to decide.');
}

export function eventCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  switch (sub) {
    case 'status': {
      if (!state.events.pendingEvent) {
        return { success: true, output: t('eventResolution.none_pending') };
      }
      const def = getEventById(state.events.pendingEvent.eventId);
      if (!def) return { success: false, output: t('eventResolution.def_not_found') };
      const lines = [
        `Pending event: ${t(def.titleKey)}`,
        t(def.descKey),
        '',
        'Options:',
      ];
      for (let i = 0; i < def.options.length; i++) {
        lines.push(`  [${i}] ${t(def.options[i]!.labelKey)}`);
      }
      lines.push('', 'Use "event choose <index>" to decide.');
      return { success: true, output: lines.join('\n') };
    }

    case 'choose': {
      const idx = parseInt(args[1] ?? '', 10);
      if (isNaN(idx)) return { success: false, output: t('eventResolution.choose_usage') };
      const rng = new Random(state.seed + state.tickCount);
      const result = resolveEvent(state.events, state.finances, state.scores, idx, state.tickCount, rng);
      if (!result) return { success: false, output: t('eventResolution.choose_invalid') };

      // resolveEvent already logged the transaction to state.finances via
      // addIncome/addExpense — mirror it onto the flat state.cash field too,
      // the same dual-write every other cash-moving command in this file
      // does, since FinancesPanel.ts and serializeGameState() both read the
      // flat field, not state.finances.cash.
      state.cash += result.cashChange;

      const lines = [`Event resolved: ${result.eventId}`, t(result.resultKey), 'Consequences:'];
      for (const e of result.effects) {
        lines.push(`  • ${e}`);
      }
      if (result.corruptionChange !== 0) {
        state.corruption.level += result.corruptionChange;
      }
      // Resume the game after resolving the event (tick pauses on event)
      state.isPaused = false;
      return { success: true, output: lines.join('\n') };
    }

    case 'dismiss': {
      if (!state.events.lastOutcome) {
        return { success: false, output: t('eventResolution.dismiss_none') };
      }
      clearLastOutcome(state.events);
      return { success: true, output: t('eventResolution.dismissed') };
    }

    case 'timers': {
      const lines = ['Event timers:'];
      for (const timer of state.events.timers) {
        lines.push(`  ${timer.category.padEnd(10)} ${timer.remaining}/${timer.baseInterval} ticks`);
      }
      if (state.events.followUpQueue.length > 0) {
        lines.push('', `Follow-up queue: ${state.events.followUpQueue.join(', ')}`);
      }
      return { success: true, output: lines.join('\n') };
    }

    case 'fire': {
      const eventId = args[1];
      if (!eventId) {
        return { success: false, output: t('eventResolution.fire_usage') };
      }
      const def = getEventById(eventId);
      if (!def) {
        return { success: false, output: t('eventResolution.fire_not_found', { eventId }) };
      }
      state.events.pendingEvent = { eventId: def.id, firedAtTick: state.tickCount };
      if (!state.events.firedEventIds.includes(def.id)) {
        state.events.firedEventIds.push(def.id);
      }
      state.events.lastEventTick = state.tickCount;
      state.events.actionCountSinceEvent = 0;
      state.isPaused = true;
      const lines = [
        `EVENT: ${t(def.titleKey)}`,
        `  ${t(def.descKey)}`,
      ];
      pushEventOptionLines(lines, def);
      return { success: true, output: lines.join('\n') };
    }

    default:
      return { success: false, output: t('eventResolution.usage') };
  }
}
