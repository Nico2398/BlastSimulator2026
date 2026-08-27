// BlastSimulator2026 — Game loop with time acceleration
// Manages tick processing with variable speed (1x, 2x, 4x, 8x) and pause.
// Pure logic: no timers, no DOM. The caller drives the loop.

import type { GameState } from '../state/GameState.js';
import type { Random } from '../math/Random.js';
import type { EventContext } from '../events/EventPool.js';
import { tickEventSystem, type FiredEvent } from '../events/EventSystem.js';
import { detectTrafficJam } from '../events/EventEngine.js';
import { tickVehicle, tickVehicleTaskState, tickEmployeeMovement, type EmployeeMovementResult } from './EntityMovementTick.js';
import { tickArrivalGate, type ArrivalGateResult } from './ArrivalGate.js';
import {
  estimateActionCost, resolveActionCost, selectBestActionForEmployee,
  seedTaskTimerFields, type SelectedAction,
} from './ActionSelection.js';

// ── Config ──

import { BASE_TICK_MS as _BASE_TICK_MS, VALID_SPEEDS as _VALID_SPEEDS } from '../config/balance.js';

// Cost-based per-employee action selection (#549) lives in ActionSelection.ts —
// re-exported here so GameLoop.ts stays the single public surface for
// tick-orchestration callers, same rationale as the movement/arrival-gate
// re-exports above.
export { estimateActionCost, resolveActionCost, selectBestActionForEmployee, seedTaskTimerFields, type SelectedAction };

// Vehicle and employee per-tick movement (NavGrid pathing, stuck-tracking) live
// in EntityMovementTick.ts (#407 refactor) — re-exported here so GameLoop.ts
// stays the single public surface for tick-orchestration callers.
export { tickVehicle, tickVehicleTaskState, tickEmployeeMovement, type EmployeeMovementResult };

// Arrival-gated position-dependent actions (survey, rest/eating, vehicle
// boarding, hauling) live in ArrivalGate.ts (#437) — re-exported here for the
// same reason as the movement functions above.
export { tickArrivalGate, type ArrivalGateResult };

// Employee dispatch (#549 cost-based) lives in EmployeeDispatch.ts, split
// further into EmployeeDispatchSteps.ts for the per-employee claim/promote
// steps (#759's file-size split) — re-exported here for the same reason.
export { tickEmployees, employeeWorkState } from './EmployeeDispatch.js';
export type { TickEmployeesResult } from './EmployeeDispatchSteps.js';

// Need-gauge-driven rest routing (idle employees) and collapse handling live
// in NeedRestoration.ts (#759's file-size split) — re-exported here.
export { tickNeedRestoration, tickCollapse, type NeedRestorationResult, type CollapseResult } from './NeedRestoration.js';

// Proactive need-task insertion lives in NeedTaskInsertion.ts (#759's
// file-size split) — re-exported here.
export { autoInsertNeedTasks, type NeedInsertionResult } from './NeedTaskInsertion.js';

// Rest-action creation and building-lookup helpers live in
// RestActionHelpers.ts (#759's file-size split) — re-exported here.
export { deductRestCost } from './RestActionHelpers.js';

// General rest completion (hunger / breakNeed / Tier-1 fatigue) lives in
// RestCompletion.ts (#759's file-size split) — re-exported here.
export { tickGeneralRestCompletion, type GeneralRestCompletionResult } from './RestCompletion.js';

// Shift cycle (Bunkhouse Tier 2+ / site-policy-driven) lives in
// ShiftCycle.ts (#759's file-size split) — re-exported here.
export { processShiftCycle, type ShiftCycleResult } from './ShiftCycle.js';

// Vehicle-continuity inline promotion (#550/#552) lives in
// VehicleContinuity.ts (#759's file-size split) — re-exported here.
export { tryContinueVehicleGatedAction, completeVehicleGatedActionIfApplicable } from './VehicleContinuity.js';

// Task progress ticking and completion lives in TaskProgress.ts (#759's
// file-size split) — re-exported here.
export { tickTaskProgress, type TaskProgressLevelUp, type TaskProgressResult } from './TaskProgress.js';

/** Milliseconds per base tick at 1x speed. */
export const BASE_TICK_MS = _BASE_TICK_MS;

/** Valid speed multipliers. */
export const VALID_SPEEDS = _VALID_SPEEDS;
export type SpeedMultiplier = (typeof VALID_SPEEDS)[number];

// ── Tick result ──

export interface TickResult {
  /** Number of ticks actually processed. */
  ticksProcessed: number;
  /** Events fired during these ticks. */
  firedEvents: FiredEvent[];
  /** Whether auto-pause was triggered. */
  autoPaused: boolean;
  /** Reason for auto-pause if triggered. */
  autoPauseReason: string | null;
}

// ── Core loop ──

/**
 * Process a frame of game time. Called by the rendering loop or console.
 * At Nx speed, processes N ticks per call.
 * Auto-pauses on events requiring player decision.
 *
 * @param state - The game state (mutated in place)
 * @param buildContext - Function to build EventContext from current state
 * @param rng - Seeded random for determinism
 * @returns TickResult with what happened
 */
export function processFrame(
  state: GameState,
  buildContext: (state: GameState) => EventContext,
  rng: Random,
): TickResult {
  if (state.isPaused) {
    return { ticksProcessed: 0, firedEvents: [], autoPaused: false, autoPauseReason: null };
  }

  const ticksToProcess = state.timeScale;
  const firedEvents: FiredEvent[] = [];
  let autoPaused = false;
  let autoPauseReason: string | null = null;
  let ticksProcessed = 0;

  for (let i = 0; i < ticksToProcess; i++) {
    state.tickCount++;
    state.time += BASE_TICK_MS;
    ticksProcessed++;

    const ctx = buildContext(state);
    const fired = tickEventSystem(state.events, ctx, rng);

    if (fired) {
      firedEvents.push(fired);
      // Auto-pause: event requires player decision
      state.isPaused = true;
      autoPaused = true;
      autoPauseReason = `Event requires decision: ${fired.eventId}`;
      break; // Stop processing further ticks
    }

    // No event from timers — check for traffic jam condition
    const jamEvent = detectTrafficJam(state.vehicles.vehicles, state.events, state.tickCount);
    if (jamEvent) {
      firedEvents.push(jamEvent);
      state.isPaused = true;
      autoPaused = true;
      autoPauseReason = `Event requires decision: ${jamEvent.eventId}`;
      break;
    }
  }

  return { ticksProcessed, firedEvents, autoPaused, autoPauseReason };
}

/**
 * Set game speed. Validates the multiplier.
 * @returns true if speed was set, false if invalid
 */
export function setSpeed(state: GameState, speed: number): boolean {
  if (!VALID_SPEEDS.includes(speed as SpeedMultiplier)) return false;
  state.timeScale = speed;
  return true;
}

/** Pause the game. */
export function pause(state: GameState): void {
  state.isPaused = true;
}

/** Resume the game. */
export function resume(state: GameState): void {
  state.isPaused = false;
}

/** Check if a speed value is valid. */
export function isValidSpeed(speed: number): speed is SpeedMultiplier {
  return VALID_SPEEDS.includes(speed as SpeedMultiplier);
}
