// BlastSimulator2026 — EventEngine: game-state-driven event detection
// Detects conditions that trigger events outside the normal timer system.

import type { Vehicle } from '../entities/Vehicle.js';
import type { EventSystemState, FiredEvent } from './EventSystem.js';
import { TRAFFIC_JAM_MIN_VEHICLES, TRAFFIC_JAM_MIN_TICKS } from '../config/balance.js';

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
  if (unqualifiedActionIds.length === 0) return null;

  const event: FiredEvent = { eventId: 'unqualified_task_error', firedAtTick: tickCount };
  state.pendingEvent = event;
  return event;
}
