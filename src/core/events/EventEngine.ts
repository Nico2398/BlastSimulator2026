// BlastSimulator2026 — EventEngine: game-state-driven event detection
// Detects conditions that trigger events outside the normal timer system.

import type { Vehicle } from '../entities/Vehicle.js';
import type { EventSystemState, FiredEvent } from './EventSystem.js';
import type { BlastOreReport } from '../mining/BlastOreReport.js';
import {
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
  ORE_REPORT_LUCKY_RATIO,
  ORE_REPORT_BARREN_RATIO,
  ORE_REPORT_ABSURDIUM_FRACTION,
} from '../config/balance.js';

export { TRAFFIC_JAM_MIN_VEHICLES, TRAFFIC_JAM_MIN_TICKS };

/**
 * Detects a traffic jam: ≥TRAFFIC_JAM_MIN_VEHICLES vehicles waiting on the
 * same target cell for ≥TRAFFIC_JAM_MIN_TICKS consecutive ticks.
 * Sets state.pendingEvent and returns the FiredEvent when detected.
 * Returns null if an event is already pending or the condition is not met.
 */
export function detectTrafficJam(
  vehicles: Vehicle[],
  state: EventSystemState,
  tickCount: number,
): FiredEvent | null {
  if (state.pendingEvent) return null;
  if (state.eventFreqMultiplier === 0) return null;

  // Count qualifying vehicles (state=waiting, waitingTicks at threshold) per target cell.
  const waitingByTarget = new Map<string, number>();
  for (const v of vehicles) {
    if (v.state === 'waiting' && v.waitingTicks >= TRAFFIC_JAM_MIN_TICKS) {
      const key = `${v.targetX},${v.targetZ}`;
      waitingByTarget.set(key, (waitingByTarget.get(key) ?? 0) + 1);
    }
  }

  for (const count of waitingByTarget.values()) {
    if (count >= TRAFFIC_JAM_MIN_VEHICLES) {
      const event: FiredEvent = { eventId: 'traffic_jam', firedAtTick: tickCount };
      state.pendingEvent = event;
      return event;
    }
  }

  return null;
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
