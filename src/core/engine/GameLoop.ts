// BlastSimulator2026 — Game loop with time acceleration
// Manages tick processing with variable speed (1x, 2x, 4x, 8x) and pause.
// Pure logic: no timers, no DOM. The caller drives the loop.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { Building } from '../entities/Building.js';
import type { Random } from '../math/Random.js';
import type { EventContext } from '../events/EventPool.js';
import { tickEventSystem, type FiredEvent } from '../events/EventSystem.js';
import { detectTrafficJam } from '../events/EventEngine.js';

// ── Config ──

import { BASE_TICK_MS as _BASE_TICK_MS, VALID_SPEEDS as _VALID_SPEEDS, NEED_RESTORATION_THRESHOLDS } from '../config/balance.js';

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

/** Process one vehicle movement step; advances at most one grid cell per tick, waits if the next cell is occupied. */
export function tickVehicle(state: GameState, vehicle: Vehicle): void {
  if (!canTickVehicle(vehicle)) return;

  const deltaX = vehicle.targetX - vehicle.x;
  const deltaZ = vehicle.targetZ - vehicle.z;

  if (deltaX === 0 && deltaZ === 0) return setVehicleIdle(vehicle);

  let nextX = vehicle.x;
  let nextZ = vehicle.z;
  if (deltaX !== 0) {
    nextX += Math.sign(deltaX);
  } else if (deltaZ !== 0) {
    nextZ += Math.sign(deltaZ);
  }

  const isOccupied = isCellOccupiedByOtherVehicle(state, vehicle, nextX, nextZ);
  if (isOccupied) {
    if (vehicle.state !== 'waiting') {
      vehicle.state = 'waiting';
      vehicle.waitingTicks = 1;
    } else {
      vehicle.waitingTicks = (vehicle.waitingTicks ?? 0) + 1;
    }
    return;
  }

  vehicle.x = nextX;
  vehicle.z = nextZ;
  vehicle.state = 'moving';
  vehicle.waitingTicks = 0;

  if (vehicle.x === vehicle.targetX && vehicle.z === vehicle.targetZ) {
    setVehicleIdle(vehicle);
  }
}

function canTickVehicle(vehicle: Vehicle): boolean {
  // moveVehicle() sets task='moving'; vehicle state may still be 'idle' on the very first tick.
  return vehicle.task === 'moving' &&
    (vehicle.state === 'idle' || vehicle.state === 'moving' || vehicle.state === 'waiting');
}

function setVehicleIdle(vehicle: Vehicle): void {
  vehicle.task = 'idle';
  vehicle.state = 'idle';
  vehicle.waitingTicks = 0;
}

function isCellOccupiedByOtherVehicle(state: GameState, vehicle: Vehicle, x: number, z: number): boolean {
  return state.vehicles.vehicles.some(v => v.id !== vehicle.id && v.x === x && v.z === z);
}

// ── Employee dispatch ──

export interface TickEmployeesResult {
  claimed: number[];     // IDs of PendingActions that were claimed
  unqualified: number[]; // IDs of PendingActions no roster employee can ever do
  waiting: number[];     // IDs of PendingActions where skill exists but all busy
}

/**
 * Match pending actions to idle qualified employees.
 * Mutates state: removes claimed actions from pendingActions and sets activeActionId on employees.
 */
export function tickEmployees(state: GameState): TickEmployeesResult {
  const result: TickEmployeesResult = { claimed: [], unqualified: [], waiting: [] };
  const remaining: PendingAction[] = [];

  for (const action of state.pendingActions) {
    // Base eligibility: alive, not injured, not in training.
    const eligible = state.employees.employees.filter(
      emp => emp.alive && !emp.injured && emp.trainingState === null,
    );

    // Determine the pool of employees who could ever do this action.
    const allWithSkill = action.requiredSkill !== null
      ? eligible.filter(emp => emp.qualifications.some(q => q.category === action.requiredSkill))
      : eligible;

    if (allWithSkill.length === 0) {
      result.unqualified.push(action.id);
      remaining.push(action);
      continue;
    }

    // Find an idle match, optionally restricted to a specific employee.
    const idleMatch = action.targetEmployeeId !== null
      ? allWithSkill.find(emp => emp.id === action.targetEmployeeId && emp.activeActionId === null)
      : allWithSkill.find(emp => emp.activeActionId === null);

    if (!idleMatch) {
      result.waiting.push(action.id);
      remaining.push(action);
      continue;
    }

    idleMatch.activeActionId = action.id;
    result.claimed.push(action.id);
    // action is consumed — not pushed to remaining
  }

  state.pendingActions = remaining;
  return result;
}

// ── Need restoration routing ──

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
  const result: NeedRestorationResult = { routed: [], noBuilding: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured || emp.activeActionId !== null) continue;
    const needsRest =
      emp.hunger  < NEED_RESTORATION_THRESHOLDS.hunger ||
      emp.fatigue < NEED_RESTORATION_THRESHOLDS.fatigue;

    if (!needsRest) continue;

    const building = findNearestLivingQuarters(state, emp.x, emp.z);
    if (!building) {
      result.noBuilding.push(emp.id);
      continue;
    }

    const actionId = state.nextPendingActionId++;
    const restAction: PendingAction = {
      id: actionId,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: building.x,
      targetZ: building.z,
      targetY: 0,
      payload: { buildingId: building.id },
      targetEmployeeId: emp.id,
    };

    state.pendingActions.push(restAction);
    emp.activeActionId = actionId;
    result.routed.push(emp.id);
  }

  return result;
}

function findNearestLivingQuarters(
  state: GameState,
  empX: number,
  empZ: number,
): Building | null {
  let nearest: Building | null = null;
  let bestDistSq = Infinity;
  for (const b of state.buildings.buildings) {
    if (!b.active || b.type !== 'living_quarters') continue;
    const distSq = (b.x - empX) ** 2 + (b.z - empZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      nearest = b;
    }
  }
  return nearest;
}
