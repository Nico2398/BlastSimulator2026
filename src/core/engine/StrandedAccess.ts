// BlastSimulator2026 — Stranded access bookkeeping (#2085)
// Helpers for syncCraterAccess: which ramp work is genuinely live, which stranded debris orders to drop,
// and which planned ramps are stuck so planners route around them.

import type { GameState, PendingAction, RampFootprint } from '../state/GameState.js';
import type { StrandedFloor } from '../mining/CraterAccess.js';

/** True when a dig_ramp_segment order is queued/claimed AND not stamped blocked (target_unreachable etc.). */
export function hasLiveRampWork(_pending: ReadonlyArray<PendingAction>): boolean {
  // TODO: implement
  return false;
}

/**
 * Cancels auto-debris orders stamped debris_out_of_reach inside floors planCraterAccess reported unplannable
 * for >= abandonTicks. Returns removed ids. Never touches holes, patterns or non-debris orders.
 */
export function pruneAbandonedDebris(
  _state: Pick<GameState, 'pendingActions'>,
  _unplannable: ReadonlyArray<StrandedFloor>,
  _nowTick: number,
  _abandonTicks: number,
): number[] {
  // TODO: implement
  return [];
}

/** Footprints of planned ramps whose every remaining segment is blocked; planners avoid these. */
export function blockedRampFootprints(_state: Pick<GameState, 'plannedRamps' | 'pendingActions'>): RampFootprint[] {
  // TODO: implement
  return [];
}
