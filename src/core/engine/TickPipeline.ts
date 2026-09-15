// BlastSimulator2026 — Tick pipeline orchestration (#1086)
//
// Moves the per-tick orchestration currently split across
// src/console/commands/tick.ts and its helpers into src/core/, so the
// browser render loop and the console can both call one core-owned pipeline
// (dev-architecture) instead of hosting their own ordering. Returns a
// structured TickReport rather than accumulating console-formatted strings —
// callers (console formatter, renderer/UI) render the report however they
// need to.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { Random } from '../math/Random.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { SurveyMethod } from '../mining/SurveyCalc.js';
import type { TaskProgressLevelUp } from './TaskProgress.js';
import type { TrainingCompletion } from '../entities/EmployeeTraining.js';
import type { CancelledResearch } from '../entities/Building.js';
import type { ArrivalGateResult } from './ArrivalGate.js';
import type { Violation } from '../state/WorldInvariants.js';
import type { FiredEvent } from '../events/EventSystem.js';
import type { ExpenseCategory } from '../economy/Finance.js';
import { addExpense, addIncome } from '../economy/Finance.js';
import { tickEventSystem } from '../events/EventSystem.js';
import { buildTickEventContext } from './TickEventContext.js';
import { processPayCycle, computeAverageMorale } from '../entities/Employee.js';
import { tickTraining } from '../entities/EmployeeTraining.js';
import { tickResearch, getTotalOperatingCost } from '../entities/Building.js';
import { getVehicleCostsPerTick } from '../entities/Vehicle.js';
import { tickNeedGauges, needsMoraleEffect } from '../entities/EmployeeNeeds.js';
import {
  tickCollapse,
  autoInsertNeedTasks,
  processShiftCycle,
  tickEmployees,
  tickGeneralRestCompletion,
  tickTaskProgress,
  tickVehicle,
  tickVehicleTaskState,
  tickEmployeeMovement,
  tickArrivalGate,
  completeVehicleGatedActionIfApplicable,
  employeeWorkState,
  BASE_TICK_MS,
} from './GameLoop.js';
import { syncHaulDispatch } from '../economy/HaulDispatch.js';
import { detectUnqualifiedTask, detectTrafficJam } from '../events/EventEngine.js';
import { checkDeadlines, generateContracts } from '../economy/Contract.js';
import { updateScores, clampScore, type ScoreInputs } from '../scores/ScoreManager.js';
import { CONTRACT_REFRESH_INTERVAL } from '../config/balance.js';
import { isExposed, processSmuggling } from '../events/MafiaActions.js';
import { resolveContractPriceMultiplier } from '../campaign/Level.js';
import { assertWorldInvariants } from '../state/WorldInvariants.js';
import { applyTaskCompletion } from './TaskCompletionEffects.js';
import { checkGameOverConditions } from './GameOverConditions.js';

/** One need/traffic-jam event that fired and auto-paused the tick loop. */
export interface FiredEventReport {
  eventId: string;
}

/** What a single employee's just-completed task did to the world, by task type. */
export interface TaskCompletionReport {
  completed: boolean;
  rampSegment?: { rampId: number; segmentIndex: number; voxelsCleared: number; rampFullyDone: boolean };
  groundLevelled?: { voxelsCleared: number };
  survey?: { method: SurveyMethod; centerX: number; centerZ: number };
  drillHole?: { holeId: string; x: number; z: number };
  chargeLoaded?: { holeId: string; explosiveId: string; amountKg: number };
  building?:
    | { outcome: 'built'; type: string; tier: number; buildingId: number; x: number; z: number; footprintLevelled: number }
    | { outcome: 'failed'; type: string; tier: number; x: number; z: number; error: string; refund: number };
  levelUps: TaskProgressLevelUp[];
}

/** Which win/lose condition(s), if any, ended the level this tick. */
export interface GameOverReport {
  levelCompleted: boolean;
  bankrupted: boolean;
  ecoShutdown: boolean;
  arrested: boolean;
  revolted: boolean;
  levelEndReason: GameState['levelEndReason'];
}

/** Structured result of advancing the simulation by one tick. */
export interface TickReport {
  tick: number;
  contractsExpired: Array<{ contractId: number; penalty: number }>;
  smuggling: { income: number; exposed: boolean };
  mafiaExposed: boolean;
  needEvents: FiredEventReport[];
  trainingCompletions: TrainingCompletion[];
  researchCancelled: CancelledResearch | undefined;
  taskCompletions: Array<{ employeeId: number; report: TaskCompletionReport }>;
  stuckEmployees: number[];
  abandonedActions: Array<{ employeeId: number; actionId: number | null }>;
  boardingCancelled: ArrivalGateResult['boardingCancelled'];
  worldInvariantViolations: Violation[];
  firedEvent: FiredEventReport | null;
  gameOver: GameOverReport;
  paused: boolean;
}

export interface RunTickOptions {
  checkInvariants: boolean;
}

/** Deduct a cash cost and log it as a finance expense, if the cost is positive. */
function deductExpense(
  state: GameState,
  cost: number,
  category: ExpenseCategory,
  label: string,
): void {
  if (cost <= 0) return;
  state.cash -= cost;
  addExpense(state.finances, cost, category, label, state.tickCount);
}

/**
 * Advance `state` by exactly one tick, mutating it in place, and report what
 * happened. The single core-owned tick step (dev-architecture) — console and
 * renderer both call this rather than hosting their own ordering. Advances
 * exactly one tick — the repeat-count loop stays in the caller (console
 * `tick.ts`), which decides whether to keep going based on
 * `report.firedEvent`/`report.paused`.
 */
export function runTick(
  state: GameState,
  grid: VoxelGrid | null,
  rng: Random,
  emitter: EventEmitter,
  options: RunTickOptions,
): TickReport {
  state.tickCount++;
  state.time += BASE_TICK_MS;

  // 1. Event system
  const evCtx = buildTickEventContext(state);
  let fired = tickEventSystem(state.events, evCtx, rng);

  // 2. Payroll — processPayCycle increments ticksSincePayday internally
  const paySalary = processPayCycle(state.employees);
  deductExpense(state, paySalary, 'salaries', 'Payroll');

  // 2b. Building and vehicle maintenance — unconditional per-tick upkeep.
  const buildingUpkeep = getTotalOperatingCost(state.buildings);
  deductExpense(state, buildingUpkeep, 'maintenance', 'Building upkeep');
  const vehicleUpkeep = getVehicleCostsPerTick(state.vehicles);
  deductExpense(state, vehicleUpkeep, 'fuel', 'Vehicle maintenance & fuel');

  // 3. Contract deadlines — expire overdue contracts and apply penalties
  const expired = checkDeadlines(state.contracts, state.tickCount);
  for (const { penalty } of expired) {
    state.cash -= penalty;
    addExpense(state.finances, penalty, 'fines', 'Contract penalty', state.tickCount);
  }

  // 4. Auto-refresh available contracts on schedule
  if (state.tickCount % CONTRACT_REFRESH_INTERVAL === 0) {
    generateContracts(state.contracts, rng, state.tickCount, resolveContractPriceMultiplier(state));
  }

  // 5. Smuggling income
  const smugResult = processSmuggling(state.mafia, rng);
  if (smugResult.income > 0) {
    state.cash += smugResult.income;
    addIncome(state.finances, smugResult.income, 'contracts', 'Smuggling', state.tickCount);
  }

  // 6. Mafia exposure check
  const mafiaExposed = state.mafia.exposureRisk > 0.3 && isExposed(state.mafia, rng);

  // 7. Score updates — decay + building/morale/vibration effects
  const avgMorale = computeAverageMorale(state.employees.employees);
  const scoreInputs: ScoreInputs = {
    buildings: state.buildings,
    avgMorale,
    recentAccidents: state.damage.accidents.filter(a => a.tick >= state.tickCount - 10).length,
    hasSafetyEquipment: state.buildings.buildings.some(b => b.type === 'management_office'),
    maxRecentVibration: 0,
    employeeCount: state.employees.employees.length,
  };
  updateScores(state.scores, scoreInputs);

  // 8. Employee needs — drain gauges, update morale, check collapse
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    tickNeedGauges(emp, employeeWorkState(emp));
    emp.morale = clampScore(emp.morale + needsMoraleEffect(emp));
  }
  const firedEvents: FiredEvent[] = [];
  // Complete rests started on a prior tick before creating any new ones —
  // mirrors processShiftCycle's own complete-then-create ordering.
  const restCompletion = tickGeneralRestCompletion(state);
  tickCollapse(state, firedEvents, emitter);
  // #593: an employee whose rest just completed above gets first refusal
  // on resuming their own interrupted work (via tickEmployees, later this
  // tick) before autoInsertNeedTasks can proactively route them right back
  // to the same building — see that function's own doc comment.
  const justCompletedRestEmployeeIds = new Set(restCompletion.completed.map(c => c.employeeId));
  autoInsertNeedTasks(state, firedEvents, emitter, justCompletedRestEmployeeIds);
  processShiftCycle(state, firedEvents, emitter);
  const needEvents: FiredEventReport[] = firedEvents.map(fe => ({ eventId: fe.eventId }));

  // 8c. Training courses — advance and report completions. Without this the
  //     course never ends: the fee is charged and the qualification never
  //     arrives, which made every skill no role is hired with unobtainable.
  const trainingCompletions = tickTraining(state.employees, emitter);

  // 8c-2. Research Center queue — advance the head task's progress each tick,
  //       unlocking its target tier when it completes. If the enabling
  //       Research Center was destroyed mid-flight, the task is cancelled
  //       and its cost refunded instead.
  const researchCancelled = tickResearch(state.buildings);
  if (researchCancelled) {
    state.cash += researchCancelled.refund;
    addIncome(state.finances, researchCancelled.refund, 'refund',
      `Research cancelled: ${researchCancelled.targetType} T${researchCancelled.targetTier} (Research Center destroyed)`,
      state.tickCount);
  }

  // 8c-3. Haul/fragment dispatch (#552): scan on-ground fragments for ones
  // with no existing haul_debris/fragment_debris action yet (any status)
  // and queue one. Idempotent, run before 8d so a fragment that becomes
  // eligible this tick (a blast, or a break that finished on a prior tick)
  // can be claimed the same tick it is queued.
  syncHaulDispatch(state);

  // 8d. Dispatch remaining pending actions to idle qualified employees. An
  // action requiring a skill nobody on the roster holds is not left to
  // queue silently forever — it raises the same unqualified_task_error
  // event used elsewhere (auto-pause, resolved via "event choose").
  //
  // Runs BEFORE 8e's completion pass below, matching main's original
  // order — an earlier fix (#550) swapped these two globally so a
  // vehicle-gated driver freed by 8e could be redispatched the same tick,
  // but that reordering shifted every employee's task-completion timing by
  // up to one tick, on-foot or vehicle-gated alike, and broke survey/task
  // timing across several scenarios that have nothing to do with vehicles.
  // The vehicle-continuity case that motivated it is instead handled
  // inline, scoped to vehicle-gated actions only — see
  // completeVehicleGatedActionIfApplicable below.
  const dispatchResult = tickEmployees(state);
  fired = fired ?? detectUnqualifiedTask(dispatchResult.unqualified, state.events, state.tickCount);

  // 8e. Task duration progress + XP/level-up reporting. taskTicksRemaining
  // only counts down once ArrivalGate (8h below) has promoted it from
  // pendingTaskDuration on a prior tick — see tickEmployees (#437).
  const taskCompletions: TickReport['taskCompletions'] = [];
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    const progress = tickTaskProgress(state, emp, emitter, grid ?? undefined);
    if (!progress) continue;
    const completionReport = applyTaskCompletion(state, grid, emp, progress, emitter);
    taskCompletions.push({ employeeId: emp.id, report: completionReport });
  }

  // 8f. Vehicle movement — advance every vehicle currently task='moving' one
  // step toward its target (moveVehicle/vehicle-move-command only set the
  // target; nothing advanced x/z toward it before this). Hauling vehicles
  // are driven entirely by tickArrivalGate/tickHaulingProgress instead (8h)
  // — ticking them here too would move them twice in the same tick (#437).
  for (const vehicle of state.vehicles.vehicles) {
    // Vehicle-gated actions (#550) are driven exclusively by
    // ArrivalGate.tickArrivalGate's own vehicle-drive loop (8h below) —
    // ticking them here too would move them twice in the same tick, same
    // rationale as the haulingPhase skip.
    if (vehicle.haulingPhase !== null || vehicle.reservedForActionId !== null) continue;
    tickVehicle(state, vehicle, emitter);
    tickVehicleTaskState(vehicle);
  }

  // 8f-2. Traffic jam detection — mirrors GameLoop.processFrame's own
  // post-vehicle-tick check (src/core/engine/GameLoop.ts), reachable here so
  // console/scenario "tick" steps can fire TrafficJamEvent too (#411).
  fired = fired ?? detectTrafficJam(state.vehicles.vehicles, state.events, state.tickCount);

  // 8g. Employee movement — walk employees with a destination (set by
  // tickEmployees/tickCollapse/tickNeedRestoration/forceShiftRestIfNeeded
  // above) one tick's worth of movement along a NavGrid path.
  const movementResult = tickEmployeeMovement(state, emitter);
  const stuckEmployees = movementResult.stuck;
  const abandonedActions = movementResult.abandoned;

  // 8h. Arrival gate — must run after employee/vehicle movement above:
  // promotes rest/task/vehicle-boarding intents queued this tick or a prior
  // one into their active timers/effects once the entity has actually
  // arrived, and drives hauling vehicles (move → load → move → unload) end
  // to end (#437).
  const arrivalResult = tickArrivalGate(state, emitter, grid ?? undefined);

  // 8i. Vehicle-gated haul/fragment completions (#552): tickArrivalGate's
  // own haul/break drive loop reports every action whose full deliver/break
  // cycle finished this tick — finish it through the same completion path
  // as every other action (continuity-promote a same-role follow-up, else
  // release/dismount) so the PendingAction/ghost clear and the employee
  // keeps working instead of idling.
  for (const completedVehicle of arrivalResult.completedVehicleActions) {
    const emp = state.employees.employees.find(e => e.id === completedVehicle.employeeId);
    if (emp) completeVehicleGatedActionIfApplicable(state, emp, completedVehicle.actionId);
  }

  // 9. Win/lose condition checks (level complete, bankruptcy, ecological
  // shutdown, arrest, worker revolt).
  const gameOver = checkGameOverConditions(state, emitter);

  // 9b. World invariant check (#1084) — dev/test builds only, warn-only.
  // Reports internal-consistency violations (dangling driver refs,
  // position mismatches, etc.) that should never occur if the
  // mount/itinerary/task machinery upstream is correct; never throws.
  const worldInvariantViolations = options.checkInvariants ? assertWorldInvariants(state) : [];

  // 10. Pending event — auto-pause and report to player
  let firedEvent: FiredEventReport | null = null;
  if (fired) {
    firedEvent = { eventId: fired.eventId };
    state.isPaused = true;
  }

  return {
    tick: state.tickCount,
    contractsExpired: expired,
    smuggling: smugResult,
    mafiaExposed,
    needEvents,
    trainingCompletions,
    researchCancelled,
    taskCompletions,
    stuckEmployees,
    abandonedActions,
    boardingCancelled: arrivalResult.boardingCancelled,
    worldInvariantViolations,
    firedEvent,
    gameOver,
    paused: state.isPaused,
  };
}
