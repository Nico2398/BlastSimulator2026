// BlastSimulator2026 — EventEngine: game-state-driven event detection
// Detects conditions that trigger events outside the normal timer system.

import type { BuiltRamp } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { EventSystemState, FiredEvent } from './EventSystem.js';
import type { BlastOreReport } from '../mining/BlastOreReport.js';
import { findTrafficJams } from './TrafficJams.js';
import {
  TRAFFIC_JAM_MIN_TICKS,
  ORE_REPORT_LUCKY_RATIO,
  ORE_REPORT_BARREN_RATIO,
  ORE_REPORT_ABSURDIUM_FRACTION,
} from '../config/balance.js';

export { TRAFFIC_JAM_MIN_TICKS };

/**
 * Detects a traffic jam (TrafficJams.ts): stuck agents clustered at a ramp chokepoint
 * that the player has not recently answered. Sets state.pendingEvent (carrying
 * the jam) and returns the FiredEvent when detected. Returns null if an event
 * is already pending or no unsilenced jam exists.
 */
export function detectTrafficJam(
  ramps: readonly BuiltRamp[],
  employees: readonly Employee[],
  state: EventSystemState,
  tickCount: number,
): FiredEvent | null {
  if (state.pendingEvent) return null;
  if (state.eventFreqMultiplier === 0) return null;

  // Passage jams (no ramp) stay visible as marker/pip/banner but raise no event:
  // there is no ramp to widen, so the event's options would not map.
  const jam = findTrafficJams(ramps, employees, state.jamSilencedUntil, tickCount)
    .find((j) => j.rampId !== null);
  if (!jam) return null;

  const event: FiredEvent = { eventId: 'traffic_jam', firedAtTick: tickCount, jam };
  state.pendingEvent = event;
  return event;
}

/**
 * Detects an unqualified task error: fires when a pending action nobody on the
 * roster is qualified for has not yet been raised (#1380).
 * `state.raisedUnqualifiedActionIds` remembers the ids already put to the
 * player; it is pruned to the ids still blocked, so answering the event (or the
 * work leaving the queue) never re-raises it, while a newly blocked action does.
 * Sets state.pendingEvent (carrying every currently blocked id) and returns the
 * FiredEvent when it fires. Returns null if an event is already pending or no
 * unraised unqualified action exists.
 */
export function detectUnqualifiedTask(
  unqualifiedActionIds: number[],
  state: EventSystemState,
  tickCount: number,
): FiredEvent | null {
  const current = new Set(unqualifiedActionIds);
  const raised = (state.raisedUnqualifiedActionIds ?? []).filter(id => current.has(id));
  state.raisedUnqualifiedActionIds = raised;

  if (state.pendingEvent) return null;
  if (state.eventFreqMultiplier === 0) return null;
  if (!unqualifiedActionIds.some(id => !raised.includes(id))) return null;

  state.raisedUnqualifiedActionIds = [...current];
  const event: FiredEvent = {
    eventId: 'unqualified_task_error',
    firedAtTick: tickCount,
    unqualifiedActionIds: [...current],
  };
  state.pendingEvent = event;
  return event;
}

/**
 * Detects ore report events after a blast.
 * Checks conditions in priority order:
 *   1. Legendary Vein — treranium found
 *   2. Absurdium Jackpot — absurdium fraction > threshold
 *   3. Lucky Strike — yield ratio > lucky threshold
 *   4. Barren Blast — yield ratio < barren threshold
 * Only the highest-priority matching event fires.
 * Returns null if an event is already pending or no condition is met.
 */
export function detectOreReport(
  report: BlastOreReport,
  state: EventSystemState,
  tickCount: number,
): FiredEvent | null {
  if (state.pendingEvent) return null;
  if (state.eventFreqMultiplier === 0) return null;

  let eventId: string | null = null;

  // Priority 1: Legendary Vein (rarest, most exciting)
  if (report.hasTreranium) {
    eventId = 'legendary_vein';
  }
  // Priority 2: Absurdium Jackpot
  else if (report.absurdiumFraction >= ORE_REPORT_ABSURDIUM_FRACTION) {
    eventId = 'absurdium_jackpot';
  }
  // Priority 3: Lucky Strike (got more ore than survey estimated)
  else if (report.yieldRatio > ORE_REPORT_LUCKY_RATIO) {
    eventId = 'lucky_strike';
  }
  // Priority 4: Barren Blast (got much less ore than survey estimated)
  else if (report.yieldRatio < ORE_REPORT_BARREN_RATIO) {
    eventId = 'barren_blast';
  }

  if (eventId) {
    const event: FiredEvent = { eventId, firedAtTick: tickCount };
    state.pendingEvent = event;
    return event;
  }

  return null;
}
