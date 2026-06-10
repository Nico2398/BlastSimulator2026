// BlastSimulator2026 — Game loop with time acceleration
// Manages tick processing with variable speed (1x, 2x, 4x, 8x) and pause.
// Pure logic: no timers, no DOM. The caller drives the loop.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import { getBuildingDef, getDefSize, type Building, type BuildingType } from '../entities/Building.js';
import type { Random } from '../math/Random.js';
import type { EventContext } from '../events/EventPool.js';
import { tickEventSystem, type FiredEvent } from '../events/EventSystem.js';
import { detectTrafficJam } from '../events/EventEngine.js';
import { checkCollapse, type NeedKey, type Employee } from '../entities/Employee.js';
import { replenishNeed } from '../entities/EmployeeNeeds.js';

// ── Config ──

import { BASE_TICK_MS as _BASE_TICK_MS, VALID_SPEEDS as _VALID_SPEEDS, MAX_NEED_GAUGE, NEED_REST_DURATIONS, NEED_REST_BUILDING_TYPES, NEED_REST_SEARCH_RADIUS, NEED_WARNING_THRESHOLDS, NEED_REST_COSTS, WORK_DURATION_TICKS, SHIFT_SLEEP_DURATION_TICKS } from '../config/balance.js';

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
      emp.hunger  < NEED_WARNING_THRESHOLDS.hunger ||
      emp.fatigue < NEED_WARNING_THRESHOLDS.fatigue;

    if (!needsRest) continue;

    const building = findNearestLivingQuarters(state, emp.x, emp.z);
    if (!building) {
      result.noBuilding.push(emp.id);
      continue;
    }

    const restAction = createRestPendingAction(state, {
      targetX: building.x,
      targetZ: building.z,
      targetEmployeeId: emp.id,
      payload: { buildingId: building.id },
    });

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
    result.routed.push(emp.id);
  }

  return result;
}

export interface CollapseResult {
  /** Employee IDs that collapsed this tick. */
  collapsed: number[];
}

export interface NeedInsertionResult {
  /** Employee/need pairs that had a rest PendingAction inserted. */
  inserted: Array<{ employeeId: number; needKey: NeedKey }>;
  /** Employee/need pairs that were skipped with a reason. */
  skipped: Array<{ employeeId: number; needKey: NeedKey; reason: string }>;
}

/**
 * Check all alive, non-injured employees for collapse thresholds.
 * On collapse, creates a rest PendingAction targeting nearest suitable building.
 */
export function tickCollapse(state: GameState): CollapseResult {
  const result: CollapseResult = { collapsed: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured) continue;

    const collapsedGauge = checkCollapse(emp);
    if (!collapsedGauge) continue;

    result.collapsed.push(emp.id);

    // Determine rest duration
    let restDuration = NEED_REST_DURATIONS[collapsedGauge];

    // Find nearest suitable building
    const buildingType = NEED_REST_BUILDING_TYPES[collapsedGauge];
    const building = findNearestBuildingOfType(state, buildingType, emp.x, emp.z);

    let targetX = emp.x;
    let targetZ = emp.z;
    let buildingId: number | undefined;

    if (building) {
      const distSq = (building.x - emp.x) ** 2 + (building.z - emp.z) ** 2;
      if (distSq <= NEED_REST_SEARCH_RADIUS ** 2) {
        targetX = building.x;
        targetZ = building.z;
        buildingId = building.id;
      } else {
        // Building exists but too far — double rest duration
        restDuration *= 2;
      }
    } else {
      // No building at all — double rest duration
      restDuration *= 2;
    }

    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: { buildingId, collapsedNeed: collapsedGauge, restDuration },
    });

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
  }

  return result;
}

/**
 * Proactively inserts rest PendingActions for employees whose need gauges
 * have fallen below their warning thresholds (NEED_WARNING_THRESHOLDS).
 *
 * Unlike tickNeedRestoration() which handles only idle employees and
 * immediately assigns the action (sets activeActionId), this function handles
 * both idle and busy employees. For busy employees, the rest action is
 * inserted into the pending queue without claiming it.
 *
 * Dead, injured, and collapsing employees are skipped.
 * Employees that already have a rest PendingAction in the queue are skipped.
 */
export function autoInsertNeedTasks(state: GameState): NeedInsertionResult {
  const result: NeedInsertionResult = { inserted: [], skipped: [] };

  for (const emp of state.employees.employees) {
    // Skip dead, injured, or collapsing employees
    if (!emp.alive || emp.injured || emp.collapsing) continue;

    // Determine which gauges are below warning thresholds
    const triggeredGauges: NeedKey[] = [];
    const gauges: Array<{ key: NeedKey; value: number }> = [
      { key: 'hunger', value: emp.hunger },
      { key: 'fatigue', value: emp.fatigue },
      { key: 'breakNeed', value: emp.breakNeed },
    ];
    for (const { key, value } of gauges) {
      if (value < NEED_WARNING_THRESHOLDS[key]) {
        triggeredGauges.push(key);
      }
    }

    // If no gauges are below threshold, skip entirely
    if (triggeredGauges.length === 0) continue;

    // Check if employee already has a rest PendingAction queued
    const hasRestAction = state.pendingActions.some(
      action => action.targetEmployeeId === emp.id && action.type === 'rest',
    );

    if (hasRestAction) {
      // Record all triggered gauges as skipped
      for (const gauge of triggeredGauges) {
        result.skipped.push({ employeeId: emp.id, needKey: gauge, reason: 'rest_action_already_queued' });
      }
      continue;
    }

    // Use the first triggered gauge as the primary one (array is non-empty due to check above)
    const primaryGauge = triggeredGauges[0]!;
    const buildingType = NEED_REST_BUILDING_TYPES[primaryGauge];
    const building = findNearestBuildingOfType(state, buildingType, emp.x, emp.z);

    const targetX = building?.x ?? emp.x;
    const targetZ = building?.z ?? emp.z;

    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: {
        buildingId: building?.id,
        restDuration: NEED_REST_DURATIONS[primaryGauge],
        triggeredBy: triggeredGauges,
      },
    });

    state.pendingActions.push(restAction);

    // Record each triggered gauge as inserted
    for (const gauge of triggeredGauges) {
      result.inserted.push({ employeeId: emp.id, needKey: gauge });
    }
  }

  return result;
}

/**
 * Create a rest PendingAction with boilerplate fields pre-filled.
 * Generates a new ID from state.nextPendingActionId.
 */
function createRestPendingAction(
  state: GameState,
  overrides: Pick<PendingAction, 'targetX' | 'targetZ' | 'targetEmployeeId' | 'payload'>,
): PendingAction {
  return {
    id: state.nextPendingActionId++,
    type: 'rest',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: overrides.targetX,
    targetZ: overrides.targetZ,
    targetY: 0,
    payload: overrides.payload,
    targetEmployeeId: overrides.targetEmployeeId,
  };
}

function findNearestBuildingOfType(
  state: GameState,
  buildingType: BuildingType,
  empX: number,
  empZ: number,
): Building | null {
  let nearest: Building | null = null;
  let bestDistSq = Infinity;
  for (const b of state.buildings.buildings) {
    if (!b.active || b.type !== buildingType) continue;
    const distSq = (b.x - empX) ** 2 + (b.z - empZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      nearest = b;
    }
  }
  return nearest;
}

function findNearestLivingQuarters(
  state: GameState,
  empX: number,
  empZ: number,
): Building | null {
  return findNearestBuildingOfType(state, 'living_quarters', empX, empZ);
}

/**
 * Deduct the per-visit cost from cash for the given need gauge.
 *
 * @returns The per-visit cost constant (the amount that would be deducted ignoring
 *          the cash floor of 0). When cash is insufficient, the actual deduction
 *          is less than this value.
 */
export function deductRestCost(state: GameState, needKey: NeedKey): number {
  const cost = NEED_REST_COSTS[needKey];

  state.cash = Math.max(0, state.cash - cost);
  return cost;
}

// ── Shift cycle (Bunkhouse Tier 2+) ──

export interface ShiftCycleResult {
  /** Employee IDs whose rest period completed this tick. */
  restCompleted: number[];
  /** Employee IDs that transitioned from shift-working to shift-resting this tick. */
  shiftRested: number[];
  /** Whether any employee shift logic was processed this tick. */
  active: boolean;
}

/**
 * Process the shift/rest cycle for employees with bunkhouse tier >= 2.
 * Empties restTicksRemaining on completion and transitions employees
 * between working and resting states.
 *
 * Each employee is processed in a single pass through three sequential phases:
 *   1. Complete rests — decrement restTicksRemaining, replenish fatigue on completion
 *   2. Increment ticksWorked — for active employees not currently resting
 *   3. Force shift rest — when ticksWorked reaches the work-duration threshold
 *
 * @param state - The game state (mutated in place)
 * @param firedEvents - Accumulator for events fired this tick
 * @returns Result summary of shift transitions
 */
export function processShiftCycle(
  state: GameState,
  firedEvents: FiredEvent[],
): ShiftCycleResult {
  // Check for a bunkhouse (living_quarters tier >= 2)
  const hasBunkhouse = state.buildings.buildings.some(
    b => b.type === 'living_quarters' && b.tier >= 2 && b.active,
  );

  if (!hasBunkhouse) {
    return { restCompleted: [], shiftRested: [], active: false };
  }

  const restCompleted: number[] = [];
  const shiftRested: number[] = [];

  // Single pass per employee — phases are independent per-employee so
  // merging from three loops to one produces identical behaviour.
  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured) continue;

    // Phase 1: Decrement rest, replenish fatigue on completion
    completeRestTick(state, emp, restCompleted);

    // Phase 2: Count work ticks for active employees not resting
    incrementWorkTick(state, emp);

    // Phase 3: Force shift rest when work quota is met
    forceShiftRestIfNeeded(state, emp, firedEvents, shiftRested);
  }

  return { restCompleted, shiftRested, active: true };
}

/**
 * Decrement restTicksRemaining for an employee who is currently resting.
 * If rest is complete (reaches ≤ 0), replenish fatigue, clear state, and record completion.
 */
function completeRestTick(
  state: GameState,
  emp: Employee,
  restCompleted: number[],
): void {
  if (emp.restTicksRemaining === null) return;

  emp.restTicksRemaining -= 1;

  if (emp.restTicksRemaining <= 0) {
    // Find nearest active living_quarters for replenishment
    const building = findNearestLivingQuarters(state, emp.x, emp.z);
    if (building) {
      const def = getBuildingDef(building.type, building.tier);
      replenishNeed(emp, 'fatigue', building.tier, def.capacity);
    } else {
      // Fallback — no building found (shouldn't happen since we checked hasBunkhouse)
      emp.fatigue = MAX_NEED_GAUGE;
    }

    deductRestCost(state, 'fatigue');

    if (emp.collapsing) {
      emp.collapsing = false;
    }

    emp.restTicksRemaining = null;
    emp.activeActionId = null;
    emp.ticksWorked = 0;
    restCompleted.push(emp.id);
  }
}

/**
 * Increment ticksWorked for an active (non-idle) employee who is not currently resting
 * and does not already have a pending rest action queued.
 */
function incrementWorkTick(
  state: GameState,
  emp: Employee,
): void {
  if (emp.activeActionId === null) return;
  if (emp.restTicksRemaining !== null) return;

  // Skip if employee already has a pending rest action (voluntary rest)
  const hasRestAction = state.pendingActions.some(
    a => a.type === 'rest' && a.targetEmployeeId === emp.id,
  );
  if (hasRestAction) return;

  emp.ticksWorked += 1;
}

/**
 * If an active employee has worked enough ticks, force a shift rest:
 * find the nearest living_quarters, create a rest PendingAction, and set restTicksRemaining.
 */
function forceShiftRestIfNeeded(
  state: GameState,
  emp: Employee,
  firedEvents: FiredEvent[],
  shiftRested: number[],
): void {
  if (emp.restTicksRemaining !== null) return;
  if (emp.activeActionId === null) return;
  if (emp.ticksWorked < WORK_DURATION_TICKS) return;

  // Find nearest living_quarters for target coordinates
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  let targetX = emp.x;
  let targetZ = emp.z;
  let buildingId: number | undefined;

  if (building) {
    const center = getBuildingCenter(building);
    targetX = center.x;
    targetZ = center.z;
    buildingId = building.id;
  }

  emp.restTicksRemaining = SHIFT_SLEEP_DURATION_TICKS;

  const restAction = createRestPendingAction(state, {
    targetX,
    targetZ,
    targetEmployeeId: emp.id,
    payload: { needType: 'fatigue', triggeredBy: 'shift_cycle', buildingId },
  });

  state.pendingActions.push(restAction);
  emp.activeActionId = restAction.id;
  shiftRested.push(emp.id);
  firedEvents.push({ eventId: 'employee_shift_change', firedAtTick: state.tickCount });
}

/**
 * Compute the centre position of a building based on its definition size.
 */
function getBuildingCenter(building: Building): { x: number; z: number } {
  const def = getBuildingDef(building.type, building.tier);
  const { sizeX, sizeZ } = getDefSize(def);
  return { x: building.x + sizeX / 2, z: building.z + sizeZ / 2 };
}
