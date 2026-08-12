// BlastSimulator2026 — Game loop with time acceleration
// Manages tick processing with variable speed (1x, 2x, 4x, 8x) and pause.
// Pure logic: no timers, no DOM. The caller drives the loop.

import type { GameState, PendingAction, ActionType } from '../state/GameState.js';
import { getBuildingDef, findNearestActiveBuildingOfType, type Building, type BuildingType } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';
import type { Random } from '../math/Random.js';
import type { EventContext } from '../events/EventPool.js';
import { tickEventSystem, type FiredEvent } from '../events/EventSystem.js';
import { detectTrafficJam } from '../events/EventEngine.js';
import { checkCollapse, gainXp, type NeedKey, type Employee, type SkillCategory } from '../entities/Employee.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import { replenishNeed, getNeedMultiplier } from '../entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../entities/BuildingWellbeing.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { addExpense } from '../economy/Finance.js';
import { tickVehicle, tickVehicleTaskState, tickEmployeeMovement, type EmployeeMovementResult } from './EntityMovementTick.js';
import { tickArrivalGate, type ArrivalGateResult } from './ArrivalGate.js';

// ── Config ──

import { BASE_TICK_MS as _BASE_TICK_MS, VALID_SPEEDS as _VALID_SPEEDS, NEED_REST_DURATIONS, NEED_REST_NO_BUILDING_CAP, NEED_REST_NO_BUILDING_DURATION_MULTIPLIER, NEED_REST_BUILDING_TYPES, needRestSearchRadius, NEED_WARNING_THRESHOLDS, NEED_REST_COSTS, WORK_DURATION_TICKS, SHIFT_SLEEP_DURATION_TICKS, BASE_TASK_DURATION_TICKS } from '../config/balance.js';

// Vehicle and employee per-tick movement (NavGrid pathing, stuck-tracking) live
// in EntityMovementTick.ts (#407 refactor) — re-exported here so GameLoop.ts
// stays the single public surface for tick-orchestration callers.
export { tickVehicle, tickVehicleTaskState, tickEmployeeMovement, type EmployeeMovementResult };

// Arrival-gated position-dependent actions (survey, rest/eating, vehicle
// boarding, hauling) live in ArrivalGate.ts (#437) — re-exported here for the
// same reason as the movement functions above.
export { tickArrivalGate, type ArrivalGateResult };

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

// ── Employee dispatch ──

export interface TickEmployeesResult {
  claimed: number[];     // IDs of PendingActions that were claimed
  unqualified: number[]; // IDs of PendingActions no roster employee can ever do
  waiting: number[];     // IDs of PendingActions where skill exists but all busy
}

/**
 * Match pending actions to idle qualified employees.
 * Mutates state: removes claimed actions from pendingActions and sets activeActionId on employees.
 *
 * TODO(#547): claim must transition status to 'assigned' + stamp holderId
 * instead of splicing the action out of pendingActions; the ghost must gain
 * `claimed: true` instead of being deleted. tickArrivalGate's promotion to
 * 'in_progress', and rest-action bookkeeping (autoInsertNeedTasks,
 * tickCollapse, completeRestTick) that filters the pool by action id, need
 * updating for records that now outlive the claim.
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

    // Send the employee walking toward the action's location — targetX/targetZ
    // is documented on PendingAction as existing for exactly this purpose
    // ("ghost rendering and employee pathfinding"), previously unused.
    idleMatch.destinationX = action.targetX;
    idleMatch.destinationZ = action.targetZ;

    // This is the actual claim path the tick loop uses (claimPendingAction in
    // TaskDispatch.ts is a separate helper nothing here calls), so it owns
    // clearing the ghost preview too — otherwise the blue marker never
    // disappears once a real employee picks up the work (#406).
    const ghostIdx = state.ghostPreviews.findIndex(g => g.id === action.id);
    if (ghostIdx !== -1) state.ghostPreviews.splice(ghostIdx, 1);

    // tickCollapse/tickNeedRestoration self-claim (see above) and, like this
    // branch, only ever *queue* the rest via pendingRestDuration/
    // pendingRestNeedKey — ArrivalGate.tickArrivalGate promotes it into
    // restTicksRemaining once the employee physically reaches the rest
    // building (#437). autoInsertNeedTasks pushes 'rest' actions unclaimed
    // (busy-employee case), so this is the first point an idle employee
    // actually starts walking to rest. Bunkhouse Tier 2+ shift-cycle rest
    // (forceShiftRestIfNeeded) also self-claims and carries no 'needKey'
    // payload, so resolveRestNeedKey returns null for it and this block is a
    // no-op there.
    if (action.type === 'rest' && idleMatch.restTicksRemaining === null && idleMatch.pendingRestDuration === null) {
      const needKey = resolveRestNeedKey(action.payload);
      if (needKey !== null) {
        const restDuration = typeof action.payload['restDuration'] === 'number'
          ? action.payload['restDuration'] as number
          : NEED_REST_DURATIONS[needKey];
        idleMatch.pendingRestDuration = restDuration;
        idleMatch.pendingRestNeedKey = needKey;
      }
    }

    // Non-rest actions requiring a skill queue their task duration here — the
    // claimed employee is guaranteed (via allWithSkill above) to hold
    // requiredSkill, so proficiency lookup below always succeeds. The
    // countdown itself (taskTicksRemaining) does not start until
    // ArrivalGate.tickArrivalGate confirms the employee has physically
    // reached targetX/targetZ (#437) — a survey used to resolve the instant
    // it was claimed, regardless of how far the surveyor still had to walk.
    // pendingActionType/pendingActionPayload stay set through to completion
    // (tickTaskProgress clears them) so completion handling (e.g. survey
    // resolution) still knows what work just finished.
    if (action.type !== 'rest' && action.requiredSkill !== null) {
      const qual = idleMatch.qualifications.find(q => q.category === action.requiredSkill);
      const level = qual?.proficiencyLevel ?? 1;
      const needMult = getNeedMultiplier(idleMatch);
      const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, state.employees.employees.length);
      // A survey's own durationTicks (SURVEY_DURATION_TICKS[method], set by
      // runSurvey) overrides the generic proficiency-scaled duration, mirroring
      // the 'rest' branch's restDuration override above — otherwise every
      // survey silently took BASE_TASK_DURATION_TICKS instead of its method's
      // own duration.
      idleMatch.pendingTaskDuration = typeof action.payload['durationTicks'] === 'number'
        ? action.payload['durationTicks'] as number
        : computeTaskDuration(BASE_TASK_DURATION_TICKS, level, needMult, lqMult, 1);
      idleMatch.activeTaskSkill = action.requiredSkill;
      idleMatch.pendingActionType = action.type;
      idleMatch.pendingActionPayload = action.payload;
    }
  }

  state.pendingActions = remaining;
  return result;
}

/**
 * Determine which need gauge a 'rest' PendingAction's payload is restoring,
 * or null if the payload doesn't identify one — this is the case for the
 * Bunkhouse Tier 2+ shift-cycle rest created by forceShiftRestIfNeeded, which
 * processShiftCycle/completeRestTick already own end-to-end.
 */
function resolveRestNeedKey(payload: Record<string, unknown>): NeedKey | null {
  const candidate = payload['needKey'];
  return candidate === 'hunger' || candidate === 'fatigue' || candidate === 'breakNeed' ? candidate : null;
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

    // Hunger is checked first, matching the order used above and in autoInsertNeedTasks.
    const needKey: NeedKey = emp.hunger < NEED_WARNING_THRESHOLDS.hunger ? 'hunger' : 'fatigue';
    const restDuration = NEED_REST_DURATIONS[needKey];

    const building = findNearestLivingQuarters(state, emp.x, emp.z);
    if (!building) {
      result.noBuilding.push(emp.id);
      continue;
    }

    const approach = resolveBuildingApproach(state, building, emp.x, emp.z);

    const restAction = createRestPendingAction(state, {
      targetX: approach.x,
      targetZ: approach.z,
      targetEmployeeId: emp.id,
      payload: { buildingId: building.id, needKey, restDuration },
    });

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
    // Immediately claimed (unlike autoInsertNeedTasks) — but the rest timer
    // itself does not start until ArrivalGate.tickArrivalGate confirms the
    // employee has walked to the building (#437).
    emp.pendingRestDuration = restDuration;
    emp.pendingRestNeedKey = needKey;
    emp.destinationX = approach.x;
    emp.destinationZ = approach.z;
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
export function tickCollapse(state: GameState, _firedEvents?: FiredEvent[], _emitter?: EventEmitter): CollapseResult {
  const result: CollapseResult = { collapsed: [] };

  for (const emp of state.employees.employees) {
    if (!emp.alive || emp.injured) continue;

    const collapsedGauge = checkCollapse(emp);
    if (!collapsedGauge) continue;

    result.collapsed.push(emp.id);
    _firedEvents?.push({ eventId: 'employee_collapsed', firedAtTick: state.tickCount });
    _emitter?.emit('employee:collapsed', { employeeId: emp.id, needKey: collapsedGauge });

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
      const searchRadius = needRestSearchRadius(state.world?.sizeX ?? 0);
      if (distSq <= searchRadius ** 2) {
        const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
        targetX = approach.x;
        targetZ = approach.z;
        buildingId = building.id;
      } else {
        // Building exists but too far — the employee rests in place
        restDuration *= NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;
      }
    } else {
      // No building at all — the employee rests in place
      restDuration *= NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;
    }

    // A warning-threshold rest queued by autoInsertNeedTasks while this employee
    // was busy is now superseded: the collapse rest services the same gauge and
    // is claimed immediately. Left in the queue it is claimed the moment the
    // collapse rest ends — a second rest cycle and a second NEED_REST_COSTS
    // charge for one collapse, listed alongside the active one in the roster panel.
    state.pendingActions = state.pendingActions.filter(
      a => !(a.type === 'rest' && a.targetEmployeeId === emp.id),
    );

    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: { buildingId, collapsedNeed: collapsedGauge, needKey: collapsedGauge, restDuration },
    });

    state.pendingActions.push(restAction);
    emp.activeActionId = restAction.id;
    // Immediately claimed — but the rest timer itself does not start until
    // ArrivalGate.tickArrivalGate confirms arrival (mirrors tickNeedRestoration, #437).
    // When resting in place (targetX/Z === emp.x/z, the two no-building branches
    // above) the employee is already "arrived" and the gate resolves next tick.
    emp.pendingRestDuration = restDuration;
    emp.pendingRestNeedKey = collapsedGauge;
    emp.destinationX = targetX;
    emp.destinationZ = targetZ;
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
export function autoInsertNeedTasks(state: GameState, _firedEvents?: FiredEvent[], _emitter?: EventEmitter): NeedInsertionResult {
  const result: NeedInsertionResult = { inserted: [], skipped: [] };

  for (const emp of state.employees.employees) {
    // Skip dead, injured, or collapsing employees
    if (!emp.alive || emp.injured || emp.collapsing) continue;

    // Skip employees already mid-rest — resting, or (#437) still walking to
    // rest with the timer not yet started. Their gauge is still below its
    // warning threshold — the replenishment only lands when the rest
    // completes — so without this check a second rest is queued every cycle,
    // claimed the instant the first one ends, and charged again: one wasted
    // rest and one extra NEED_REST_COSTS payment per dip below the threshold.
    // Rests created by tickCollapse/tickNeedRestoration stay in pendingActions
    // and are caught by the hasRestAction check below; a rest claimed through
    // tickEmployees is consumed from the queue, so only restTicksRemaining/
    // pendingRestDuration still mark it.
    if (emp.restTicksRemaining !== null || emp.pendingRestDuration !== null) continue;

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
        _firedEvents?.push({ eventId: 'need_warning', firedAtTick: state.tickCount });
        _emitter?.emit('employee:need_warning', { employeeId: emp.id, needKey: gauge });
      }
      continue;
    }

    // Use the first triggered gauge as the primary one (array is non-empty due to check above)
    const primaryGauge = triggeredGauges[0]!;
    const buildingType = NEED_REST_BUILDING_TYPES[primaryGauge];
    const building = findNearestBuildingOfType(state, buildingType, emp.x, emp.z);

    const approach = building ? resolveBuildingApproach(state, building, emp.x, emp.z) : null;
    const targetX = approach?.x ?? emp.x;
    const targetZ = approach?.z ?? emp.z;
    // With nowhere to go the employee rests in place, which takes longer and
    // (in completeRestForEmployee) tops the gauge out at NEED_REST_NO_BUILDING_CAP.
    const restDuration = building
      ? NEED_REST_DURATIONS[primaryGauge]
      : NEED_REST_DURATIONS[primaryGauge] * NEED_REST_NO_BUILDING_DURATION_MULTIPLIER;

    const restAction = createRestPendingAction(state, {
      targetX,
      targetZ,
      targetEmployeeId: emp.id,
      payload: {
        buildingId: building?.id,
        restDuration,
        triggeredBy: triggeredGauges,
        // Read by tickEmployees when this action is claimed, to start the
        // rest timer for the employee (see resolveRestNeedKey).
        needKey: primaryGauge,
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
    // TODO(#547): rest actions self-claim immediately at every call site
    // below — 'queued'/null here is a type-compliance default overwritten by
    // the caller once the lifecycle claim path lands, not real logic.
    status: 'queued',
    holderId: null,
  };
}

function findNearestBuildingOfType(
  state: GameState,
  buildingType: BuildingType,
  empX: number,
  empZ: number,
): Building | null {
  return findNearestActiveBuildingOfType(state.buildings, buildingType, empX, empZ);
}

function findNearestLivingQuarters(
  state: GameState,
  empX: number,
  empZ: number,
): Building | null {
  return findNearestBuildingOfType(state, 'living_quarters', empX, empZ);
}

/**
 * Resolve the nearest walkable NavGrid cell on the ring around a building,
 * closest to (empX, empZ). See findBuildingApproachCell's doc for why a
 * building's raw (x, z) can never be targeted directly (#437) — every
 * rest-routing call site below needs this same resolution.
 */
function resolveBuildingApproach(
  state: GameState,
  building: Building,
  empX: number,
  empZ: number,
): { x: number; z: number } {
  return findBuildingApproachCell(state.navGrid, building, getBuildingDef(building.type, building.tier), empX, empZ);
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
  // Clamp to [0, cash]: a player already at or below 0 owes nothing more for
  // this specific visit (rather than being charged the full cost like every
  // other expense in the game), but — unlike the previous `Math.max(0, cash -
  // cost)` formula — never resets pre-existing negative cash back up to 0.
  // That old formula treated "already in debt" the same as "can afford part
  // of this," silently erasing any debt the moment a need-rest cost fired.
  const actualDeduction = Math.max(0, Math.min(state.cash, cost));

  state.cash -= actualDeduction;
  addExpense(state.finances, actualDeduction, 'needs', `Rest: ${needKey}`, state.tickCount);
  return cost;
}

// ── General rest completion (hunger / breakNeed / Tier-1 fatigue) ──

export interface GeneralRestCompletionResult {
  /** Employee/need pairs whose rest completed this tick. */
  completed: Array<{ employeeId: number; needKey: NeedKey }>;
}

/**
 * Shared rest-completion sequence used by both tickGeneralRestCompletion and
 * completeRestTick: replenish the resting need gauge from the nearest active
 * living_quarters (or, with no building in range, up to
 * NEED_REST_NO_BUILDING_CAP only), deduct the visit's NEED_REST_COSTS entry,
 * clear the collapsing flag, and null out
 * restTicksRemaining/activeActionId so the employee returns to normal task
 * dispatch. Callers own any remaining wrap-up specific to their rest source
 * (pendingActions removal + result recording, or ticksWorked reset).
 */
function completeRestForEmployee(state: GameState, emp: Employee, needKey: NeedKey): void {
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  if (building) {
    const def = getBuildingDef(building.type, building.tier);
    replenishNeed(emp, needKey, building.tier, def.capacity);
  } else {
    // No building services this need — the employee rests where they stand.
    // That keeps them on their feet but never fully satisfies them: the gauge
    // rises no higher than NEED_REST_NO_BUILDING_CAP, and the rest itself took
    // NEED_REST_NO_BUILDING_DURATION_MULTIPLIER times as long to get here. A
    // gauge already above the cap is left alone rather than pulled down to it.
    emp[needKey] = Math.max(emp[needKey], NEED_REST_NO_BUILDING_CAP);
  }

  deductRestCost(state, needKey);

  if (emp.collapsing) {
    emp.collapsing = false;
  }

  emp.restTicksRemaining = null;
  emp.restNeedKey = null;
  emp.activeActionId = null;
}

/**
 * Completion path for 'rest' PendingActions created by tickCollapse,
 * tickNeedRestoration, and autoInsertNeedTasks — every hunger and breakNeed
 * rest, plus fatigue rest when no Bunkhouse Tier 2+ living_quarters exists to
 * service it via processShiftCycle. Mirrors completeRestTick's structure:
 * decrement restTicksRemaining, and on completion replenish the resting need
 * gauge, deduct its NEED_REST_COSTS entry, then clear activeActionId/
 * restTicksRemaining so the employee returns to normal task dispatch.
 *
 * Only owns employees whose restNeedKey identifies a resting need (set at
 * rest-start by the three creators above, or by tickEmployees when it claims
 * a queued autoInsertNeedTasks action) — Bunkhouse Tier 2+ shift-cycle rest
 * leaves restNeedKey null and remains owned by processShiftCycle/completeRestTick.
 *
 * Injury does not block completion — an employee who becomes injured mid-rest
 * must still have their rest action finished and cleaned up, or activeActionId
 * would stay set forever.
 */
export function tickGeneralRestCompletion(state: GameState): GeneralRestCompletionResult {
  const completed: Array<{ employeeId: number; needKey: NeedKey }> = [];

  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (emp.restTicksRemaining === null) continue;

    const needKey = emp.restNeedKey;
    if (needKey === null) continue; // owned by processShiftCycle instead

    emp.restTicksRemaining -= 1;
    if (emp.restTicksRemaining > 0) continue;

    const completedActionId = emp.activeActionId;
    completeRestForEmployee(state, emp, needKey);
    // tickCollapse/tickNeedRestoration leave the rest action in pendingActions
    // at creation (they self-claim instead of routing through tickEmployees),
    // so nothing else removes it once the rest completes.
    state.pendingActions = state.pendingActions.filter(a => a.id !== completedActionId);

    completed.push({ employeeId: emp.id, needKey });
  }

  return { completed };
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
  _emitter?: EventEmitter,
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
    forceShiftRestIfNeeded(state, emp, firedEvents, shiftRested, _emitter);
  }

  return { restCompleted, shiftRested, active: true };
}

export interface TaskProgressResult {
  /** True when taskTicksRemaining reached 0 this tick and the task completed. */
  completed: boolean;
  /** True when this tick's XP gain crossed a proficiency level threshold. */
  leveledUp: boolean;
  /** Skill category XP was granted to, or null when the task carries no skill. */
  skill: SkillCategory | null;
  oldLevel?: 1 | 2 | 3 | 4 | 5;
  newLevel?: 1 | 2 | 3 | 4 | 5;
  /** Action type of the task that just completed — only present when `completed` is true. */
  actionType?: ActionType;
  /** Payload of the task that just completed — only present when `completed` is true. */
  actionPayload?: Record<string, unknown>;
}

/**
 * Advance an employee's dispatched task toward completion, granting XP and
 * reporting completion when taskTicksRemaining reaches zero. Mirrors
 * completeRestTick's shape for taskTicksRemaining instead of restTicksRemaining.
 *
 * No-op (returns null) for an employee with no in-progress task
 * (taskTicksRemaining === null) — includes employees currently resting and
 * employees dispatched with no required skill (taskTicksRemaining never seeded
 * for those, see tickEmployees).
 */
export function tickTaskProgress(state: GameState, emp: Employee, emitter?: EventEmitter): TaskProgressResult | null {
  if (emp.taskTicksRemaining === null) return null;

  emp.taskTicksRemaining -= 1;

  const skill = emp.activeTaskSkill;
  let leveledUp = false;
  let levelUpLevels: { oldLevel: 1 | 2 | 3 | 4 | 5; newLevel: 1 | 2 | 3 | 4 | 5 } | null = null;

  if (skill !== null) {
    const qual = emp.qualifications.find(q => q.category === skill);
    const currentLevel = qual?.proficiencyLevel ?? 1;
    const xpPerTick = 1 + Math.floor(currentLevel * 0.5);
    const xpResult = gainXp(state.employees, emp.id, skill, xpPerTick, emitter);
    if (xpResult) {
      leveledUp = xpResult.leveledUp;
      if (xpResult.leveledUp) {
        levelUpLevels = { oldLevel: xpResult.oldLevel, newLevel: xpResult.newLevel };
      }
    }
  }

  let completed = false;
  let completedActionType: ActionType | undefined;
  let completedActionPayload: Record<string, unknown> | undefined;
  if (emp.taskTicksRemaining <= 0) {
    completed = true;
    // pendingActionType/pendingActionPayload were left set by tickEmployees at
    // claim time (#437) specifically so completion handling — e.g. resolving
    // a completed survey — still knows what work this was.
    completedActionType = emp.pendingActionType ?? undefined;
    completedActionPayload = emp.pendingActionPayload ?? undefined;
    emp.activeActionId = null;
    emp.taskTicksRemaining = null;
    delete emp.activeTaskTotalTicks;
    emp.activeTaskSkill = null;
    emp.pendingActionType = null;
    emp.pendingActionPayload = null;
  }

  return {
    completed,
    leveledUp,
    skill,
    ...(levelUpLevels ? { oldLevel: levelUpLevels.oldLevel, newLevel: levelUpLevels.newLevel } : {}),
    ...(completedActionType !== undefined ? { actionType: completedActionType } : {}),
    ...(completedActionPayload !== undefined ? { actionPayload: completedActionPayload } : {}),
  };
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
  // Rests started by tickCollapse/tickNeedRestoration/autoInsertNeedTasks (hunger,
  // breakNeed, or Tier-1 living_quarters fatigue) carry a restNeedKey and are owned
  // by tickGeneralRestCompletion instead — skip them here to avoid double-processing.
  if (emp.restNeedKey !== null) return;

  emp.restTicksRemaining -= 1;

  if (emp.restTicksRemaining <= 0) {
    completeRestForEmployee(state, emp, 'fatigue');
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
  // Walking to a rest whose timer hasn't started yet is not work either
  // (#437) — without this, a claimed-but-not-yet-arrived rest still counted
  // toward the shift-cycle work quota for every tick of the walk.
  if (emp.pendingRestDuration !== null) return;

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
  _emitter?: EventEmitter,
): void {
  if (emp.restTicksRemaining !== null) return;
  // Already walking to a shift rest queued on a prior tick — without this,
  // ticksWorked stays >= WORK_DURATION_TICKS for the whole walk (it's only
  // reset on rest completion) and this would requeue a duplicate rest action
  // every tick until arrival (#437).
  if (emp.pendingRestDuration !== null) return;
  if (emp.activeActionId === null) return;
  if (emp.ticksWorked < WORK_DURATION_TICKS) return;

  // Find nearest living_quarters for target coordinates
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  let targetX = emp.x;
  let targetZ = emp.z;
  let buildingId: number | undefined;

  if (building) {
    const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
    targetX = approach.x;
    targetZ = approach.z;
    buildingId = building.id;
  }

  // The rest timer itself does not start until ArrivalGate.tickArrivalGate
  // confirms the employee has walked to the bunkhouse (#437).
  emp.pendingRestDuration = SHIFT_SLEEP_DURATION_TICKS;

  const restAction = createRestPendingAction(state, {
    targetX,
    targetZ,
    targetEmployeeId: emp.id,
    payload: { needType: 'fatigue', triggeredBy: 'shift_cycle', buildingId },
  });

  state.pendingActions.push(restAction);
  emp.activeActionId = restAction.id;
  emp.destinationX = targetX;
  emp.destinationZ = targetZ;
  shiftRested.push(emp.id);
  firedEvents.push({ eventId: 'employee_shift_change', firedAtTick: state.tickCount });
  _emitter?.emit('employee:shift_change', { employeeId: emp.id });
}
