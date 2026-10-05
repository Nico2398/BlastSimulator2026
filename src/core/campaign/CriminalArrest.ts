// BlastSimulator2026 — Criminal arrest system
// If mafia exposure accumulates to critical level, the player is arrested
// and the current level ends. Campaign progress is preserved.
// Real basis: corruption investigations typically trigger when public exposure
// crosses a media/political threshold — mirrored here as a 0-1 scale.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { ARREST_EXPOSURE_THRESHOLD as _THRESHOLD, ARREST_WARNING_EXPOSURE as _WARNING } from '../config/balance.js';

// ── Config (imported from centralized balance) ──

export const ARREST_EXPOSURE_THRESHOLD = _THRESHOLD;
export const ARREST_WARNING_EXPOSURE = _WARNING;

// ── State ──

export interface ArrestState {
  /** Whether an arrest has been triggered. */
  arrested: boolean;
  /** Whether the exposure warning has been fired. */
  warningFired: boolean;
}

export function createArrestState(): ArrestState {
  return { arrested: false, warningFired: false };
}

// ── Tick update ──

/**
 * Call each tick. Returns true if arrest was just triggered.
 * Emits 'arrest:triggered' on game over. Below the arrest threshold, emits
 * 'arrest:warning' once when exposure reaches ARREST_WARNING_EXPOSURE; the
 * latch re-arms when exposure falls back under it. A jump straight past the
 * arrest threshold arrests without a warning.
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

  const exposure = state.mafia.exposureRisk;
  if (exposure < ARREST_WARNING_EXPOSURE) {
    arrest.warningFired = false;
  } else if (!arrest.warningFired) {
    arrest.warningFired = true;
    emitter.emit('arrest:warning', { exposure });
  }

  return false;
}
