// BlastSimulator2026 — Ecological disaster / mine shutdown
// If ecology score stays at 0 for a sustained period, the government shuts
// down the mine and the current level ends.
// Real basis: environmental enforcement orders typically follow repeated violations
// over weeks. We map this to sustained 0-score over N ticks.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';

// ── Config ──

/**
 * Ticks at ecology=0 before government shutdown.
 * At 1 tick/100ms: 150 ticks ≈ ~15s real-time ≈ several game-weeks of destruction.
 */
export const ECOLOGICAL_SHUTDOWN_TICKS = 150;

/** Ticks at 0 before a government warning is issued. */
export const ECOLOGICAL_WARNING_TICKS = 50;

// ── State ──

export interface EcologicalState {
  /** Consecutive ticks at ecology score = 0. */
  ticksAtZero: number;
  /** Whether the government warning has been fired this streak. */
  warningFired: boolean;
  /** Whether the mine has been shut down. */
  shutdown: boolean;
}

export function createEcologicalState(): EcologicalState {
  return { ticksAtZero: 0, warningFired: false, shutdown: false };
}

// ── Tick update ──

/**
 * Call each tick. Returns true if shutdown was just triggered.
 * Emits 'ecology:warning' and 'ecology:shutdown'.
 */
export function updateEcology(
  state: GameState,
  eco: EcologicalState,
  emitter: EventEmitter,
): boolean {
  if (eco.shutdown) return false;

  if (state.scores.ecology <= 0) {
    eco.ticksAtZero++;

    if (!eco.warningFired && eco.ticksAtZero >= ECOLOGICAL_WARNING_TICKS) {
      eco.warningFired = true;
      emitter.emit('ecology:warning', {
        ticksRemaining: ECOLOGICAL_SHUTDOWN_TICKS - eco.ticksAtZero,
      });
    }

    if (eco.ticksAtZero >= ECOLOGICAL_SHUTDOWN_TICKS) {
      eco.shutdown = true;
      emitter.emit('ecology:shutdown', {} as Record<string, never>);
      return true;
    }
  } else {
    // Ecology recovering — reset counter and warning
    eco.ticksAtZero = 0;
    eco.warningFired = false;
  }

  return false;
}
