// BlastSimulator2026 — Criminal arrest system
// If mafia exposure accumulates to critical level, the player is arrested
// and the current level ends. Campaign progress is preserved.
// Real basis: corruption investigations typically trigger when public exposure
// crosses a media/political threshold — mirrored here as a 0-1 scale.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';

// ── Config ──

/**
 * Exposure threshold that triggers arrest (0-1 scale).
 * Above 0.9 = the whole town knows. Arrest is inevitable.
 */
export const ARREST_EXPOSURE_THRESHOLD = 0.9;

// ── State ──

export interface ArrestState {
  /** Whether an arrest has been triggered. */
  arrested: boolean;
}

export function createArrestState(): ArrestState {
  return { arrested: false };
}

// ── Tick update ──

/**
 * Call each tick. Returns true if arrest was just triggered.
 * Emits 'arrest:triggered' on game over.
 */
export function updateArrest(
  state: GameState,
  arrest: ArrestState,
  emitter: EventEmitter,
): boolean {
  if (arrest.arrested) return false;

  if (state.mafia.exposureRisk >= ARREST_EXPOSURE_THRESHOLD) {
    arrest.arrested = true;
    emitter.emit('arrest:triggered', { exposure: state.mafia.exposureRisk });
    return true;
  }

  return false;
}
