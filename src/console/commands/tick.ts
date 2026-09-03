// BlastSimulator2026 — Console tick command: advances the simulation
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { GameState } from '../../core/state/GameState.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { tickEventSystem } from '../../core/events/EventSystem.js';
import { addExpense, addIncome, type ExpenseCategory } from '../../core/economy/Finance.js';
import { processPayCycle, computeAverageMorale } from '../../core/entities/Employee.js';
import { tickTraining } from '../../core/entities/EmployeeTraining.js';
import { tickResearch, getTotalOperatingCost } from '../../core/entities/Building.js';
import { getVehicleCostsPerTick } from '../../core/entities/Vehicle.js';
import { tickNeedGauges, needsMoraleEffect } from '../../core/entities/EmployeeNeeds.js';
import type { FiredEvent } from '../../core/events/EventSystem.js';
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
} from '../../core/engine/GameLoop.js';
import { syncHaulDispatch } from '../../core/economy/HaulDispatch.js';
import { detectUnqualifiedTask, detectTrafficJam } from '../../core/events/EventEngine.js';
import { checkDeadlines, generateContracts } from '../../core/economy/Contract.js';
import { updateScores, clampScore, type ScoreInputs } from '../../core/scores/ScoreManager.js';
import { CONTRACT_REFRESH_INTERVAL } from '../../core/config/balance.js';
import { BASE_TICK_MS } from '../../core/engine/GameLoop.js';
import { isExposed, processSmuggling } from '../../core/events/MafiaActions.js';
import { requireGame } from './commandUtils.js';
import { resolveTaskCompletion } from './tickTaskCompletion.js';
import { checkGameOverConditions } from './tickGameOver.js';
import { buildEventContext, pushEventOptionLines } from './eventResolution.js';

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

export function tickCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  // If there's a pending event, refuse to tick — player must resolve it first
  if (state.events.pendingEvent) {
    return { success: false, output: t('tick.pending_event_refusal') };
  }

  const count = Math.max(1, parseInt(args[0] ?? '1', 10) || 1);
  const lines: string[] = [];
  const rng = new Random(state.seed + state.tickCount);
  const emitter = ctx.emitter;
  let ticksAdvanced = 0;

  for (let i = 0; i < count; i++) {
    state.tickCount++;
    state.time += BASE_TICK_MS;
    ticksAdvanced++;

    // 1. Event system
    const evCtx = buildEventContext(ctx);
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
      lines.push(`[tick ${state.tickCount}] Contract expired! Penalty: $${penalty}`);
    }

    // 4. Auto-refresh available contracts on schedule
    if (state.tickCount % CONTRACT_REFRESH_INTERVAL === 0) {
      generateContracts(state.contracts, rng, state.tickCount);
    }

    // 5. Smuggling income
    const smugResult = processSmuggling(state.mafia, rng);
    if (smugResult.income > 0) {
      state.cash += smugResult.income;
      addIncome(state.finances, smugResult.income, 'contracts', 'Smuggling', state.tickCount);
    }
    if (smugResult.exposed) {
      lines.push(`[tick ${state.tickCount}] SMUGGLING EXPOSED! Investigation incoming.`);
    }

    // 6. Mafia exposure check
    if (state.mafia.exposureRisk > 0.3 && isExposed(state.mafia, rng)) {
      lines.push(`[tick ${state.tickCount}] MAFIA EXPOSURE! Criminal charges may follow.`);
    }

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
    // Emit any needs-related events via console
    for (const fe of firedEvents) {
      lines.push(`[tick ${state.tickCount}] NEED: ${fe.eventId}`);
    }

    // 8c. Training courses — advance and report completions. Without this the
    //     course never ends: the fee is charged and the qualification never
    //     arrives, which made every skill no role is hired with unobtainable.
    for (const done of tickTraining(state.employees, emitter)) {
      const what = done.isNew ? 'qualified in' : 'promoted to level ' + done.level + ' in';
      lines.push(`[tick ${state.tickCount}] ${done.employeeName} ${what} ${done.skill}.`);
    }

    // 8c-2. Research Center queue — advance the head task's progress each tick,
    //       unlocking its target tier when it completes. If the enabling
    //       Research Center was destroyed mid-flight, the task is cancelled
    //       and its cost refunded instead.
    const cancelledResearch = tickResearch(state.buildings);
    if (cancelledResearch) {
      state.cash += cancelledResearch.refund;
      addIncome(state.finances, cancelledResearch.refund, 'refund',
        `Research cancelled: ${cancelledResearch.targetType} T${cancelledResearch.targetTier} (Research Center destroyed)`,
        state.tickCount);
      lines.push(`[tick ${state.tickCount}] Research cancelled: ${cancelledResearch.targetType} tier ${cancelledResearch.targetTier} — Research Center destroyed, $${cancelledResearch.refund} refunded.`);
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
    // tryContinueVehicleGatedAction below.
    const dispatchResult = tickEmployees(state);
    fired = fired ?? detectUnqualifiedTask(dispatchResult.unqualified, state.events, state.tickCount);

    // 8e. Task duration progress + XP/level-up reporting. taskTicksRemaining
    // only counts down once ArrivalGate (8h below) has promoted it from
    // pendingTaskDuration on a prior tick — see tickEmployees (#437).
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp, emitter, ctx.grid ?? undefined);
      if (!progress) continue;
      resolveTaskCompletion(ctx, state, emp, progress, emitter, lines);
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
    for (const empId of movementResult.stuck) {
      const emp = state.employees.employees.find(e => e.id === empId);
      lines.push(`[tick ${state.tickCount}] STUCK: ${emp?.name ?? `employee #${empId}`} can't find a path — waiting.`);
    }
    for (const abandoned of movementResult.abandoned) {
      const emp = state.employees.employees.find(e => e.id === abandoned.employeeId);
      lines.push(`[tick ${state.tickCount}] ACTION ABANDONED: ${emp?.name ?? `employee #${abandoned.employeeId}`} released a stuck claim back to the pool.`);
    }

    // 8h. Arrival gate — must run after employee/vehicle movement above:
    // promotes rest/task/vehicle-boarding intents queued this tick or a prior
    // one into their active timers/effects once the entity has actually
    // arrived, and drives hauling vehicles (move → load → move → unload) end
    // to end (#437).
    const arrivalResult = tickArrivalGate(state, emitter, ctx.grid ?? undefined);
    for (const cancelled of arrivalResult.boardingCancelled) {
      const emp = state.employees.employees.find(e => e.id === cancelled.employeeId);
      lines.push(`[tick ${state.tickCount}] BOARDING CANCELLED: ${emp?.name ?? `employee #${cancelled.employeeId}`} (${cancelled.reason}).`);
    }

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
    checkGameOverConditions(state, emitter, lines);

    // 10. Pending event — auto-pause and report to player
    if (fired) {
      const def = getEventById(fired.eventId);
      if (def) {
        lines.push(`[tick ${state.tickCount}] EVENT: ${t(def.titleKey)}`);
        lines.push(`  ${t(def.descKey)}`);
        pushEventOptionLines(lines, def);
      }
      state.isPaused = true;
      break;
    }

    if (state.isPaused) break;
  }

  if (lines.length === 0) {
    lines.push(t('tick.advanced_no_events', { advanced: ticksAdvanced, tick: state.tickCount }));
  } else if (ticksAdvanced < count) {
    lines.push(t('tick.advanced_partial', { advanced: ticksAdvanced, count }));
  }

  return { success: true, output: lines.join('\n') };
}
