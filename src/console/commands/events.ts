// BlastSimulator2026 — Console commands for events, corruption, mafia, and time (Phase 6)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { tickEventSystem, clearLastOutcome } from '../../core/events/EventSystem.js';
import { resolveEvent } from '../../core/events/EventResolver.js';
import type { EventContext } from '../../core/events/EventPool.js';
import {
  attemptCorruption,
  getCorruptionLevel,
  getSuccessRate,
  TARGET_COSTS,
  type CorruptionTarget,
} from '../../core/economy/Corruption.js';
import { addExpense, addIncome, type ExpenseCategory } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { processPayCycle } from '../../core/entities/Employee.js';
import { tickTraining } from '../../core/entities/EmployeeTraining.js';
import { tickResearch, getTotalOperatingCost } from '../../core/entities/Building.js';
import { getVehicleCostsPerTick } from '../../core/entities/Vehicle.js';
import { tickNeedGauges, needsMoraleEffect } from '../../core/entities/EmployeeNeeds.js';
import type { FiredEvent } from '../../core/events/EventSystem.js';
import { tickCollapse, autoInsertNeedTasks, processShiftCycle, tickEmployees, tickGeneralRestCompletion, tickTaskProgress, tickVehicle, tickVehicleTaskState, tickEmployeeMovement, tickArrivalGate } from '../../core/engine/GameLoop.js';
import { detectUnqualifiedTask, detectTrafficJam } from '../../core/events/EventEngine.js';
import { estimateSurveyResult, applySeismicSurveyDamage, type SurveyMethod } from '../../core/mining/SurveyCalc.js';
import { checkDeadlines, generateContracts } from '../../core/economy/Contract.js';
import { updateBankruptcy } from '../../core/campaign/Bankruptcy.js';
import { updateEcology } from '../../core/campaign/EcologicalDisaster.js';
import { updateArrest } from '../../core/campaign/CriminalArrest.js';
import { updateRevolt } from '../../core/campaign/WorkerRevolt.js';
import { checkLevelComplete } from '../../core/campaign/LevelTransition.js';
import { snapshotStats } from '../../core/campaign/SuccessTracker.js';
import { updateScores, type ScoreInputs } from '../../core/scores/ScoreManager.js';
import { CONTRACT_REFRESH_INTERVAL } from '../../core/config/balance.js';
import { BASE_TICK_MS } from '../../core/engine/GameLoop.js';
import {
  arrangeAccident,
  startFraming,
  completeFrame,
  toggleSmuggling,
  processSmuggling,
  isExposed,
  ACCIDENT_COST,
  FRAME_COST,
} from '../../core/events/MafiaActions.js';
import { requireGame } from './commandUtils.js';
import type { GameState } from '../../core/state/GameState.js';

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

/** Build the EventContext from the current GameState. */
function buildEventContext(ctx: GameContext): EventContext {
  const s = ctx.state!;
  return {
    scores: s.scores,
    employeeCount: s.employees.employees.length,
    deathCount: s.damage.deathCount,
    corruptionLevel: s.corruption.level,
    hasBuilding: (type: string) => s.buildings.buildings.some(b => b.type === type),
    hasDrillPlan: s.drillHoles.length > 0,
    tickCount: s.tickCount,
    lawsuitCount: s.corruption.attempts.filter(a => a.target === 'judge').length,
    activeContractCount: s.contracts.active.length,
    weatherId: 'clear', // TODO: wire actual weather when available
  };
}

// ── tick command ──

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
    return { success: false, output: 'Pending event! Resolve it first: "event choose <index>".' };
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
    const avgMorale = state.employees.employees.length > 0
      ? state.employees.employees.reduce((s, e) => s + e.morale, 0) / state.employees.employees.length
      : 50;
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
      const isWorking = emp.activeActionId !== null && emp.restTicksRemaining === null;
      tickNeedGauges(emp, isWorking);
      emp.morale = Math.max(0, Math.min(100, emp.morale + needsMoraleEffect(emp)));
    }
    const firedEvents: FiredEvent[] = [];
    // Complete rests started on a prior tick before creating any new ones —
    // mirrors processShiftCycle's own complete-then-create ordering.
    tickGeneralRestCompletion(state);
    tickCollapse(state, firedEvents, emitter);
    autoInsertNeedTasks(state, firedEvents, emitter);
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

    // 8d. Dispatch remaining pending actions to idle qualified employees.
    // An action requiring a skill nobody on the roster holds is not left to
    // queue silently forever — it raises the same unqualified_task_error event
    // used elsewhere (auto-pause, resolved via "event choose").
    const dispatchResult = tickEmployees(state);
    fired = fired ?? detectUnqualifiedTask(dispatchResult.unqualified, state.events, state.tickCount);

    // 8e. Task duration progress + XP/level-up reporting. taskTicksRemaining
    // only counts down once ArrivalGate (8h below) has promoted it from
    // pendingTaskDuration on a prior tick — see tickEmployees (#437).
    for (const emp of state.employees.employees) {
      if (!emp.alive) continue;
      const progress = tickTaskProgress(state, emp, emitter);
      if (!progress) continue;
      if (progress.completed) {
        lines.push(`[tick ${state.tickCount}] TASK: ${emp.name} completed task.`);

        // A completed 'survey' task resolves here — after the surveyor has
        // actually walked to and worked the site, not the instant it was
        // claimed (#437).
        if (progress.actionType === 'survey' && progress.actionPayload && ctx.grid) {
          const method = progress.actionPayload['method'] as SurveyMethod;
          const centerX = progress.actionPayload['centerX'] as number;
          const centerZ = progress.actionPayload['centerZ'] as number;
          const skillLevel = emp.qualifications.find(q => q.category === 'geology')?.proficiencyLevel ?? 1;
          const surveyResult = estimateSurveyResult(ctx.grid, {
            id: state.nextSurveyId++,
            method,
            centerX,
            centerZ,
            surveyorId: emp.id,
            skillLevel,
            completedTick: state.tickCount,
          }, new Random(state.seed + state.tickCount + emp.id));
          state.surveyResults.push(surveyResult);
          if (method === 'seismic') {
            const seismicAccidents = applySeismicSurveyDamage(state.buildings, centerX, centerZ, state.tickCount);
            state.damage.accidents.push(...seismicAccidents);
          }
          lines.push(`[tick ${state.tickCount}] ${method} survey complete at (${centerX}, ${centerZ}).`);
        }
      }
      if (progress.leveledUp) {
        lines.push(`[tick ${state.tickCount}] LEVELUP: ${emp.name} reached level ${progress.newLevel} in ${progress.skill}.`);
      }
    }

    // 8f. Vehicle movement — advance every vehicle currently task='moving' one
    // step toward its target (moveVehicle/vehicle-move-command only set the
    // target; nothing advanced x/z toward it before this). Hauling vehicles
    // are driven entirely by tickArrivalGate/tickHaulingProgress instead (8h)
    // — ticking them here too would move them twice in the same tick (#437).
    for (const vehicle of state.vehicles.vehicles) {
      if (vehicle.haulingPhase !== null) continue;
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

    // 8h. Arrival gate — must run after employee/vehicle movement above:
    // promotes rest/task/vehicle-boarding intents queued this tick or a prior
    // one into their active timers/effects once the entity has actually
    // arrived, and drives hauling vehicles (move → load → move → unload) end
    // to end (#437).
    const arrivalResult = tickArrivalGate(state, emitter);
    for (const cancelled of arrivalResult.boardingCancelled) {
      const emp = state.employees.employees.find(e => e.id === cancelled.employeeId);
      lines.push(`[tick ${state.tickCount}] BOARDING CANCELLED: ${emp?.name ?? `employee #${cancelled.employeeId}`} (${cancelled.reason}).`);
    }

    // 9. Level stats snapshot + campaign profit check
    snapshotStats(state.levelStats, state);
    const levelResult = checkLevelComplete(state, state.campaign, emitter);
    if (levelResult.triggered) {
      state.levelEnded = true;
      state.levelEndReason = 'completed';
      lines.push(`[tick ${state.tickCount}] LEVEL COMPLETE! Profit target reached.`);
    }

    // 9. Campaign game-over condition checks (emit events; UI subscribes).
    // All 4 always run, unconditionally, to preserve their own streak/warning
    // bookkeeping — only the first one to return true this tick sets
    // levelEndReason, and only if 'completed' didn't already claim it above.
    const bankrupted = updateBankruptcy(state, state.bankruptcy, emitter);
    const ecoShutdown = updateEcology(state, state.ecological, emitter);
    const arrested = updateArrest(state, state.arrest, emitter);
    const revolted = updateRevolt(state, state.revolt, emitter);
    if (!state.levelEnded) {
      if (bankrupted) {
        state.levelEnded = true;
        state.levelEndReason = 'bankruptcy';
        lines.push(`[tick ${state.tickCount}] BANKRUPTCY! The mine is seized.`);
      } else if (ecoShutdown) {
        state.levelEnded = true;
        state.levelEndReason = 'ecological_shutdown';
        lines.push(`[tick ${state.tickCount}] ECOLOGICAL SHUTDOWN! Regulators close the mine.`);
      } else if (arrested) {
        state.levelEnded = true;
        state.levelEndReason = 'arrest';
        lines.push(`[tick ${state.tickCount}] ARRESTED! Criminal charges end your run.`);
      } else if (revolted) {
        state.levelEnded = true;
        state.levelEndReason = 'worker_revolt';
        lines.push(`[tick ${state.tickCount}] WORKER REVOLT! Your workforce walks out for good.`);
      }
    }

    // 10. Pending event — auto-pause and report to player
    if (fired) {
      const def = getEventById(fired.eventId);
      if (def) {
        lines.push(`[tick ${state.tickCount}] EVENT: ${t(def.titleKey)}`);
        lines.push(`  ${t(def.descKey)}`);
        for (let j = 0; j < def.options.length; j++) {
          lines.push(`  [${j}] ${t(def.options[j]!.labelKey)}`);
        }
        lines.push('  → Use "event choose <index>" to decide.');
      }
      state.isPaused = true;
      break;
    }

    if (state.isPaused) break;
  }

  if (lines.length === 0) {
    lines.push(`Advanced ${ticksAdvanced} tick(s). Now at tick ${state.tickCount}. No events fired.`);
  } else if (ticksAdvanced < count) {
    lines.push(`(Advanced ${ticksAdvanced} of ${count} requested ticks)`);
  }

  return { success: true, output: lines.join('\n') };
}

// ── event command ──

export function eventCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  switch (sub) {
    case 'status': {
      if (!state.events.pendingEvent) {
        return { success: true, output: 'No pending event. Use "tick" to advance time.' };
      }
      const def = getEventById(state.events.pendingEvent.eventId);
      if (!def) return { success: false, output: 'Pending event not found in pool.' };
      const lines = [
        `Pending event: ${t(def.titleKey)}`,
        t(def.descKey),
        '',
        'Options:',
      ];
      for (let i = 0; i < def.options.length; i++) {
        lines.push(`  [${i}] ${t(def.options[i]!.labelKey)}`);
      }
      lines.push('', 'Use "event choose <index>" to decide.');
      return { success: true, output: lines.join('\n') };
    }

    case 'choose': {
      const idx = parseInt(args[1] ?? '', 10);
      if (isNaN(idx)) return { success: false, output: 'Usage: event choose <option_index>' };
      const rng = new Random(state.seed + state.tickCount);
      const result = resolveEvent(state.events, state.finances, state.scores, idx, state.tickCount, rng);
      if (!result) return { success: false, output: 'No pending event or invalid option.' };

      // resolveEvent already logged the transaction to state.finances via
      // addIncome/addExpense — mirror it onto the flat state.cash field too,
      // the same dual-write every other cash-moving command in this file
      // does, since FinancesPanel.ts and serializeGameState() both read the
      // flat field, not state.finances.cash.
      state.cash += result.cashChange;

      const lines = [`Event resolved: ${result.eventId}`, t(result.resultKey), 'Consequences:'];
      for (const e of result.effects) {
        lines.push(`  • ${e}`);
      }
      if (result.corruptionChange !== 0) {
        state.corruption.level += result.corruptionChange;
      }
      // Resume the game after resolving the event (tick pauses on event)
      state.isPaused = false;
      return { success: true, output: lines.join('\n') };
    }

    case 'dismiss': {
      if (!state.events.lastOutcome) {
        return { success: false, output: 'No resolved event to dismiss.' };
      }
      clearLastOutcome(state.events);
      return { success: true, output: 'Outcome dismissed.' };
    }

    case 'timers': {
      const lines = ['Event timers:'];
      for (const timer of state.events.timers) {
        lines.push(`  ${timer.category.padEnd(10)} ${timer.remaining}/${timer.baseInterval} ticks`);
      }
      if (state.events.followUpQueue.length > 0) {
        lines.push('', `Follow-up queue: ${state.events.followUpQueue.join(', ')}`);
      }
      return { success: true, output: lines.join('\n') };
    }

    case 'fire': {
      const eventId = args[1];
      if (!eventId) {
        return { success: false, output: 'Usage: event fire <eventId>' };
      }
      const def = getEventById(eventId);
      if (!def) {
        return { success: false, output: `Event "${eventId}" not found in pool.` };
      }
      state.events.pendingEvent = { eventId: def.id, firedAtTick: state.tickCount };
      if (!state.events.firedEventIds.includes(def.id)) {
        state.events.firedEventIds.push(def.id);
      }
      state.events.lastEventTick = state.tickCount;
      state.events.actionCountSinceEvent = 0;
      state.isPaused = true;
      const lines = [
        `EVENT: ${t(def.titleKey)}`,
        `  ${t(def.descKey)}`,
      ];
      for (let j = 0; j < def.options.length; j++) {
        lines.push(`  [${j}] ${t(def.options[j]!.labelKey)}`);
      }
      lines.push('  → Use "event choose <index>" to decide.');
      return { success: true, output: lines.join('\n') };
    }

    default:
      return { success: false, output: 'Usage: event (status|choose|timers|fire)' };
  }
}

// ── corrupt command ──

export function corruptCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  const target = named['target'] as CorruptionTarget | undefined;
  if (!target) {
    // Show corruption status
    const lines = [
      `Corruption level: ${getCorruptionLevel(state.corruption)}`,
      `Success rate: ${(getSuccessRate(state.corruption) * 100).toFixed(0)}%`,
      `Mafia unlocked: ${state.corruption.mafiaUnlocked ? 'YES' : 'No'}`,
      `Attempts: ${state.corruption.attempts.length}`,
    ];
    return { success: true, output: lines.join('\n') };
  }

  const validTargets: CorruptionTarget[] = ['judge', 'union_leader', 'inspector', 'politician', 'witness'];
  if (!validTargets.includes(target)) {
    return { success: false, output: `Invalid target. Valid: ${validTargets.join(', ')}` };
  }

  const cost = named['cost'] ? parseInt(named['cost'], 10) : undefined;
  const resolvedCost = cost ?? TARGET_COSTS[target];
  if (state.cash < resolvedCost) {
    return {
      success: false,
      output: `Insufficient funds: need $${formatMoney(resolvedCost)}, have $${formatMoney(state.cash)}`,
    };
  }
  const rng = new Random(state.seed + state.tickCount);
  const result = attemptCorruption(state.corruption, target, state.tickCount, rng, cost);

  addExpense(state.finances, result.cost, 'corruption', `Bribe: ${target}`, state.tickCount);
  state.cash -= result.cost;

  const lines = [
    result.success ? 'CORRUPTION SUCCESSFUL.' : 'CORRUPTION FAILED — SCANDAL!',
    `Cost: $${result.cost}`,
  ];
  if (result.scandalTriggered) {
    lines.push('A scandal has erupted. Expect consequences.');
  }
  if (result.mafiaJustUnlocked) {
    lines.push('You have attracted the attention of... certain organizations.');
  }

  return { success: true, output: lines.join('\n') };
}

// ── mafia command ──

export function mafiaCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  if (!state.corruption.mafiaUnlocked && sub !== 'status') {
    return { success: false, output: 'Mafia not unlocked. Increase your corruption level first.' };
  }

  const rng = new Random(state.seed + state.tickCount);

  switch (sub) {
    case 'status': {
      const lines = [
        `Mafia unlocked: ${state.corruption.mafiaUnlocked ? 'YES' : 'No'}`,
        `Exposure risk: ${(state.mafia.exposureRisk * 100).toFixed(0)}%`,
        `Smuggling: ${state.mafia.smugglingActive ? `ACTIVE ($${state.mafia.smugglingIncome}/tick)` : 'inactive'}`,
        `Pending frames: ${state.mafia.pendingFrames.length}`,
      ];
      return { success: true, output: lines.join('\n') };
    }

    case 'accident': {
      const empId = parseInt(named['employee'] ?? '', 10);
      if (isNaN(empId)) return { success: false, output: 'Usage: mafia accident employee:<id>' };
      if (state.cash < ACCIDENT_COST) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(ACCIDENT_COST)}, have $${formatMoney(state.cash)}`,
        };
      }
      const result = arrangeAccident(state.mafia, state.employees, state.corruption, empId, rng);
      state.cash -= result.cost;
      addExpense(state.finances, result.cost, 'mafia', 'Arranged accident', state.tickCount);
      return { success: true, output: result.message };
    }

    case 'frame': {
      const empId = parseInt(named['employee'] ?? '', 10);
      if (isNaN(empId)) return { success: false, output: 'Usage: mafia frame employee:<id>' };

      // Check if completing or starting
      const pending = state.mafia.pendingFrames.find(
        f => f.employeeId === empId && state.tickCount >= f.readyTick,
      );
      if (pending) {
        const result = completeFrame(state.mafia, state.employees, empId, state.tickCount, rng);
        return { success: true, output: result.message };
      }

      if (state.cash < FRAME_COST) {
        return {
          success: false,
          output: `Insufficient funds: need $${formatMoney(FRAME_COST)}, have $${formatMoney(state.cash)}`,
        };
      }
      const result = startFraming(state.mafia, state.employees, empId, state.tickCount);
      state.cash -= result.cost;
      addExpense(state.finances, result.cost, 'mafia', 'Frame job', state.tickCount);
      return { success: true, output: result.message };
    }

    case 'smuggle': {
      const result = toggleSmuggling(state.mafia);
      return {
        success: true,
        output: result.active
          ? `Smuggling ACTIVATED. Income: $${result.incomePerTick}/tick. Watch your exposure.`
          : 'Smuggling DEACTIVATED.',
      };
    }

    default:
      return { success: false, output: 'Usage: mafia (status|accident|frame|smuggle) [employee:<id>]' };
  }
}

// ── time command ──

export function timeCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  // `time speed 2` and `time speed:2` are both accepted — the named form is the
  // house style for every other command, and silently reporting status for it
  // made scenarios look like they had changed the speed when they had not.
  const sub = args[0] ?? (named['speed'] !== undefined ? 'speed' : 'status');

  switch (sub) {
    case 'status':
      return {
        success: true,
        output: [
          `Tick: ${state.tickCount}`,
          `Speed: ${state.timeScale}x`,
          `Paused: ${state.isPaused ? 'YES' : 'No'}`,
        ].join('\n'),
      };

    case 'pause':
      state.isPaused = true;
      return { success: true, output: 'Game paused.' };

    case 'resume':
      state.isPaused = false;
      return { success: true, output: `Game resumed at ${state.timeScale}x speed.` };

    case 'speed': {
      const speed = parseInt(args[1] ?? named['speed'] ?? '', 10);
      if (![1, 2, 4, 8].includes(speed)) {
        return { success: false, output: 'Valid speeds: 1, 2, 4, 8' };
      }
      state.timeScale = speed;
      return { success: true, output: `Speed set to ${speed}x.` };
    }

    default:
      return { success: false, output: 'Usage: time (status|pause|resume|speed <1|2|4|8>)' };
  }
}
