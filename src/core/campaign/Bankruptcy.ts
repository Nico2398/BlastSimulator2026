// BlastSimulator2026 — Bankruptcy system
// If cash balance stays below the bankruptcy threshold for a sustained period,
// the mine is seized and the current level fails.
// Real quarrying: operations often fold after ~3 months of negative cash flow.
// We scale: bankruptcy_grace_ticks = 100 ticks of sustained debt.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import {
  BANKRUPTCY_THRESHOLD as _THRESHOLD,
  BANKRUPTCY_GRACE_TICKS as _GRACE,
  BANKRUPTCY_WARNING_TICKS as _WARNING,
} from '../config/balance.js';

// ── Config (imported from centralized balance) ──

export const BANKRUPTCY_THRESHOLD = _THRESHOLD;
export const BANKRUPTCY_GRACE_TICKS = _GRACE;
export const BANKRUPTCY_WARNING_TICKS = _WARNING;

// ── State ──

export interface BankruptcyState {
  /** How many consecutive ticks cash has been below the threshold. */
  ticksBelowThreshold: number;
  /** Whether the low-balance warning has been fired this streak. */
  warningFired: boolean;
  /** Whether bankruptcy has been triggered (level is over). */
  bankrupt: boolean;
}

export function createBankruptcyState(): BankruptcyState {
  return { ticksBelowThreshold: 0, warningFired: false, bankrupt: false };
}

// ── Tick update ──

/**
 * Call each tick. Returns true if bankruptcy was just triggered.
 * Emits 'bankruptcy:warning' at low balance, 'bankruptcy:triggered' on game over.
 */
export function updateBankruptcy(
  state: GameState,
  bankruptcy: BankruptcyState,
  emitter: EventEmitter,
): boolean {
  if (bankruptcy.bankrupt) return false;

  if (state.cash < BANKRUPTCY_THRESHOLD) {
    bankruptcy.ticksBelowThreshold++;

    if (!bankruptcy.warningFired && bankruptcy.ticksBelowThreshold >= BANKRUPTCY_WARNING_TICKS) {
      bankruptcy.warningFired = true;
      emitter.emit('bankruptcy:warning', {
        cash: state.cash,
        ticksRemaining: BANKRUPTCY_GRACE_TICKS - bankruptcy.ticksBelowThreshold,
      });
    }

    if (bankruptcy.ticksBelowThreshold >= BANKRUPTCY_GRACE_TICKS) {
      bankruptcy.bankrupt = true;
      emitter.emit('bankruptcy:triggered', { cash: state.cash });
      return true;
    }
  } else {
    // Cash recovered — reset streak and warning
    bankruptcy.ticksBelowThreshold = 0;
    bankruptcy.warningFired = false;
  }

  return false;
}
