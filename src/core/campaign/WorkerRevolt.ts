// BlastSimulator2026 — Worker revolt / permanent strike
// If well-being score stays at 0 for a sustained period, workers revolt
// permanently and the current level ends. Campaign progress is preserved.
// Real basis: union history shows general strikes escalate after 4-8 weeks
// of intolerable conditions. We compress to N ticks.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { REVOLT_TICKS as _REVOLT, REVOLT_WARNING_TICKS as _WARNING } from '../config/balance.js';

// ── Config (imported from centralized balance) ──

export const REVOLT_TICKS = _REVOLT;
export const REVOLT_WARNING_TICKS = _WARNING;

// ── State ──

export interface RevoltState {
  /** Consecutive ticks at well-being score = 0. */
  ticksAtZero: number;
  /** Whether the strike warning has been fired this streak. */
  warningFired: boolean;
  /** Whether the permanent revolt has been triggered. */
  revolted: boolean;
}

export function createRevoltState(): RevoltState {
  return { ticksAtZero: 0, warningFired: false, revolted: false };
}

// ── Tick update ──

/**
 * Call each tick. Returns true if revolt was just triggered.
 * Emits 'revolt:warning' and 'revolt:triggered'.
 */
export function updateRevolt(
  state: GameState,
  revolt: RevoltState,
  emitter: EventEmitter,
): boolean {
  if (revolt.revolted) return false;

  if (state.scores.wellBeing <= 0) {
    revolt.ticksAtZero++;

    if (!revolt.warningFired && revolt.ticksAtZero >= REVOLT_WARNING_TICKS) {
      revolt.warningFired = true;
      emitter.emit('revolt:warning', {
        ticksRemaining: REVOLT_TICKS - revolt.ticksAtZero,
      });
    }

    if (revolt.ticksAtZero >= REVOLT_TICKS) {
      revolt.revolted = true;
      emitter.emit('revolt:triggered', {} as Record<string, never>);
      return true;
    }
  } else {
    // Some well-being restored — reset streak and warning
    revolt.ticksAtZero = 0;
    revolt.warningFired = false;
  }

  return false;
}
