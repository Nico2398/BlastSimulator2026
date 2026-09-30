// BlastSimulator2026 — EventEngine: game-state-driven event detection
// Detects conditions that trigger events outside the normal timer system.

import type { BuiltRamp } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { EventSystemState, FiredEvent } from './EventSystem.js';
import type { BlastOreReport } from '../mining/BlastOreReport.js';
import { findTrafficJams } from './TrafficJams.js';
import {
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
  ORE_REPORT_LUCKY_RATIO,
  ORE_REPORT_BARREN_RATIO,
  ORE_REPORT_ABSURDIUM_FRACTION,
} from '../config/balance.js';

export { TRAFFIC_JAM_MIN_VEHICLES, TRAFFIC_JAM_MIN_TICKS };

/**
 * Detects a traffic jam (TrafficJams.ts): stuck agents clustered at a chokepoint
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

  const jam = findTrafficJams(ramps, employees, state.jamSilencedUntil, tickCount)[0];
  if (!jam) return null;

  const event: FiredEvent = { eventId: 'traffic_jam', firedAtTick: tickCount, jam };
  state.pendingEvent = event;
  return event;
}

/**
 * Detects an unqualified task error: fires when at least one pending action
 * has no qualified employee on the roster.
 * Sets state.pendingEvent and returns the FiredEvent when detected.
 * Returns null if an event is already pending or no unqualified actions exist.
 */
export function detectUnqualifiedTask(
  unqualifiedActionIds: number[],
  state: EventSystemState,
  tickCount: number,
): FiredEvent | null {
  if (state.pendingEvent) return null;
  if (state.eventFreqMultiplier === 0) return null;
  if (unqualifiedActionIds.length === 0) return null;

  const event: FiredEvent = { eventId: 'unqualified_task_error', firedAtTick: tickCount };
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
