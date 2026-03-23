// BlastSimulator2026 — Console commands for events, corruption, mafia, and time (Phase 6)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { Random } from '../../core/math/Random.js';
import { getEventById } from '../../core/events/EventPool.js';
import { tickEventSystem } from '../../core/events/EventSystem.js';
import { resolveEvent } from '../../core/events/EventResolver.js';
import type { EventContext } from '../../core/events/EventPool.js';
import {
  attemptCorruption,
  getCorruptionLevel,
  getSuccessRate,
  type CorruptionTarget,
} from '../../core/economy/Corruption.js';
import { addExpense, addIncome } from '../../core/economy/Finance.js';
import { processPayCycle } from '../../core/entities/Employee.js';
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
} from '../../core/events/MafiaActions.js';

function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  return null;
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
    const fired = tickEventSystem(state.events, evCtx, rng);

    // 2. Payroll — processPayCycle increments ticksSincePayday internally
    const paySalary = processPayCycle(state.employees);
    if (paySalary > 0) {
      state.cash -= paySalary;
      addExpense(state.finances, paySalary, 'salaries', 'Payroll', state.tickCount);
    }

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
      hasSafetyEquipment: state.buildings.buildings.some(b => b.type === 'medical_bay'),
      maxRecentVibration: 0,
      employeeCount: state.employees.employees.length,
    };
    updateScores(state.scores, scoreInputs);

    // 8. Level stats snapshot + campaign profit check
    snapshotStats(state.levelStats, state);
    const levelResult = checkLevelComplete(state, state.campaign, emitter);
    if (levelResult.triggered) {
      state.levelEnded = true;
      state.levelEndReason = 'completed';
      lines.push(`[tick ${state.tickCount}] LEVEL COMPLETE! Profit target reached.`);
    }

    // 9. Campaign game-over condition checks (emit events; UI subscribes)
    updateBankruptcy(state, state.bankruptcy, emitter);
    updateEcology(state, state.ecological, emitter);
    updateArrest(state, state.arrest, emitter);
    updateRevolt(state, state.revolt, emitter);

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

      const lines = [`Event resolved: ${result.eventId}`, 'Consequences:'];
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

    default:
      return { success: false, output: 'Usage: event (status|choose|timers)' };
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
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

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
      const speed = parseInt(args[1] ?? '', 10);
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
