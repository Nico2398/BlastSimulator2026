// BlastSimulator2026 — Need-gauge-driven rest routing (idle employees) and
// collapse handling
//
// tickNeedRestoration auto-routes idle employees below a warning threshold to
// the nearest living_quarters; tickCollapse handles the harder collapse case
// for any alive, non-injured employee regardless of busy/idle state,
// interrupting whatever active action they held. Split out of GameLoop.ts as
// part of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState } from '../state/GameState.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { EventEmitter } from '../state/EventEmitter.js';

export interface NeedRestorationResult {
  /** Employee IDs that were routed to a rest action. */
  routed: number[];
  /** Employee IDs that need rest but no living_quarters building was available. */
  noBuilding: number[];
}

/**
 * Auto-routes idle employees to the nearest active living_quarters building
 * when hunger or fatigue drops below its warning threshold.
 * Busy (activeActionId set), injured, and dead employees are skipped;
 * unreachable employees (no living_quarters available) are recorded in result.noBuilding.
 */
export function tickNeedRestoration(state: GameState): NeedRestorationResult {
  void state;
  // TODO: implement
  throw new Error('not implemented');
}

export interface CollapseResult {
  /** Employee IDs that collapsed this tick. */
  collapsed: number[];
}

/**
 * Check all alive, non-injured employees for collapse thresholds.
 * On collapse, creates a rest PendingAction targeting nearest suitable building.
 */
export function tickCollapse(state: GameState, _firedEvents?: FiredEvent[], _emitter?: EventEmitter): CollapseResult {
  void state; void _firedEvents; void _emitter;
  // TODO: implement
  throw new Error('not implemented');
}
