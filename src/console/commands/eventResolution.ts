// BlastSimulator2026 — Console commands for event context building and resolution
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { EventDef } from '../../core/events/EventPool.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { resolveEvent } from '../../core/events/EventResolver.js';
import { clearLastOutcome, noticeTicksLeft, presentEvent } from '../../core/events/EventSystem.js';
import { applyResolutionToState, resolveNotice } from '../../core/events/EventNotices.js';
import { effectChipText } from '../../core/events/EventEffectText.js';
import { modifierSummary } from '../../core/events/ModifierText.js';
import { drawPendingLeavers } from '../../core/events/EventLeavers.js';
import { requireGame } from './commandUtils.js';

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
      const notices = state.events.minorNotices;
      if (!state.events.pendingEvent && notices.length === 0) {
        return { success: true, output: t('eventResolution.none_pending') };
      }
      const lines: string[] = [];
      if (state.events.pendingEvent) {
        const def = getEventById(state.events.pendingEvent.eventId);
        if (!def) return { success: false, output: t('eventResolution.def_not_found') };
        lines.push(`Pending event: ${t(def.titleKey)}`, t(def.descKey), '', 'Options:');
        for (let i = 0; i < def.options.length; i++) {
          lines.push(`  [${i}] ${t(def.options[i]!.labelKey)}`);
        }
        lines.push('', 'Use "event choose <index>" to decide.');
      }
      for (const notice of notices) {
        const def = getEventById(notice.eventId);
        if (!def) continue;
        if (lines.length > 0) lines.push('');
        lines.push(t('eventResolution.notice_header', { title: t(def.titleKey), id: def.id, ticks: noticeTicksLeft(notice, state.tickCount) }), t(def.descKey));
        for (let i = 0; i < def.options.length; i++) {
          lines.push(`  [${i}] ${t(def.options[i]!.labelKey)}`);
        }
        lines.push(t('eventResolution.notice_hint', { id: def.id }));
      }
      return { success: true, output: lines.join('\n') };
    }

    case 'choose': {
      const idx = parseInt(args[1] ?? '', 10);
      if (isNaN(idx)) return { success: false, output: t('eventResolution.choose_usage') };
      const rng = new Random(state.seed + state.tickCount);
      const world = { state, grid: ctx.grid, emitter: ctx.emitter };
      // A named event is a notice; a bare index answers the pending major, else the oldest notice (#2146).
      const noticeId = args[2] ?? (state.events.pendingEvent ? undefined : state.events.minorNotices[0]?.eventId);
      const answersNotice = noticeId !== undefined;
      const result = answersNotice
        ? resolveNotice(state, noticeId, idx, rng, world)
        // resolveEvent already logged the transaction to state.finances; applyResolutionToState mirrors
        // it onto the flat state.cash field that FinancesPanel and serializeGameState read.
        : resolveEvent(state.events, state.finances, state.scores, idx, state.tickCount, rng, world);
      if (!result) return { success: false, output: t('eventResolution.choose_invalid') };
      if (!answersNotice) applyResolutionToState(state, result);

      const lines = [`Event resolved: ${result.eventId}`, t(result.resultKey), 'Consequences:'];
      for (const e of result.effects) {
        lines.push(`  • ${e}`);
      }
      for (const chip of result.effectChips) {
        lines.push(`  • ${effectChipText(chip)}`);
      }
      // Resume the game after resolving a major event (tick pauses on it); a notice never paused it.
      if (!answersNotice) state.isPaused = false;
      return { success: true, output: lines.join('\n') };
    }

    case 'dismiss': {
      if (!state.events.lastOutcome) {
        return { success: false, output: t('eventResolution.dismiss_none') };
      }
      clearLastOutcome(state.events);
      return { success: true, output: t('eventResolution.dismissed') };
    }

    case 'modifiers': {
      const active = state.events.activeModifiers;
      if (active.length === 0) return { success: true, output: t('eventResolution.no_modifiers') };
      const lines = [t('eventResolution.modifiers_header'), ...active.map(m => `  ${modifierSummary(m, state.tickCount)}`)];
      return { success: true, output: lines.join('\n') };
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
      const minor = presentEvent(state.events, def.id, state.tickCount, state.cash).minor === true;
      if (!state.events.firedEventIds.includes(def.id)) {
        state.events.firedEventIds.push(def.id);
      }
      state.events.lastEventTick = state.tickCount;
      state.events.actionCountSinceEvent = 0;
      if (!minor) {
        drawPendingLeavers(state.events, state.employees.employees, new Random(state.seed + state.tickCount));
        state.isPaused = true;
      }
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
