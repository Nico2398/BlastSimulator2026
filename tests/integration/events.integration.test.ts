// BlastSimulator2026 — Integration tests: Event system (Phase 6)
// Covers timer-based events, traffic jam detection, unqualified task detection,
// event lifecycle (pending, clear, follow-up), and time/pause console commands.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { tickCommand, eventCommand, timeCommand } from '../../src/console/commands/events.js';
import { corruptCommand } from '../../src/console/commands/corruption.js';
import { mafiaCommand } from '../../src/console/commands/mafia.js';
import { bribeFailureFine } from '../../src/core/economy/Corruption.js';
import { getEventById } from '../../src/core/events/EventPool.js';
import {
  createEventSystemState,
  tickEventSystem,
  clearPendingEvent,
  queueFollowUp,
  incrementActionCount,
} from '../../src/core/events/EventSystem.js';
import {
  detectTrafficJam,
  detectUnqualifiedTask,
} from '../../src/core/events/EventEngine.js';
import { Random } from '../../src/core/math/Random.js';
import { t } from '../../src/core/i18n/I18n.js';
import { setupEvents } from '../../src/core/events/index.js';
import { clearEvents } from '../../src/core/events/EventPool.js';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import { killEmployee } from '../../src/core/entities/Employee.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { UNQUALIFIED_CONTRACTOR_FEE, SURVEY_COSTS } from '../../src/core/config/balance.js';
import { planTraining } from '../../src/core/entities/EmployeeTraining.js';
import { parseCommand } from '../../src/console/ConsoleRunner.js';
import { makeCampaignCtx } from './full-level/helpers.js';
import {
  MIN_EVENT_INTERVAL_TICKS,
  MIN_EVENT_INTERVAL_ACTIONS,
  BANKRUPTCY_GRACE_TICKS,
  ECOLOGICAL_SHUTDOWN_TICKS,
  ARREST_EXPOSURE_THRESHOLD,
  REVOLT_TICKS,
  SCORE_DECAY_RATE,
  TRAFFIC_JAM_MIN_TICKS,
  FOLLOWUP_DELAY_TICKS,
  MAFIA_UNLOCK_THRESHOLD,
  BRIBERY_FAILURE_CORRUPTION_DELTA,
  INVESTIGATION_EXPOSURE_JUMP,
  INVESTIGATION_FOLLOWUP_EVENT_ID,
  ACCIDENT_EXPOSURE,
  ACCIDENT_FAILURE_EXPOSURE_EXTRA,
} from '../../src/core/config/balance.js';
import type { BuiltRamp } from '../../src/core/state/GameState.js';
import { rampFootprint } from '../../src/core/mining/RampWidening.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import { createEmployeeState, hireEmployee } from '../../src/core/entities/Employee.js';
import { makeGameContext } from '../helpers/gameContext.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
}

/** Minimal EventContext for core-API calls that don't need a full GameState. */
function makeEventCtx(overrides: Partial<{
  wellBeing: number;
  safety: number;
  ecology: number;
  nuisance: number;
  decayRate: number;
  employeeCount: number;
  deathCount: number;
  corruptionLevel: number;
  tickCount: number;
  lawsuitCount: number;
  activeContractCount: number;
}> = {}) {
  return {
    scores: {
      wellBeing: overrides.wellBeing ?? 50,
      safety: overrides.safety ?? 50,
      ecology: overrides.ecology ?? 50,
      nuisance: overrides.nuisance ?? 50,
      decayRate: overrides.decayRate ?? SCORE_DECAY_RATE,
    },
    employeeCount: overrides.employeeCount ?? 0,
    deathCount: overrides.deathCount ?? 0,
    corruptionLevel: overrides.corruptionLevel ?? 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: overrides.tickCount ?? 0,
    lawsuitCount: overrides.lawsuitCount ?? 0,
    activeContractCount: overrides.activeContractCount ?? 0,
    weatherId: 'sunny' as const,
    hasBlasted: false,
  };
}

/** A stuck agent (on foot) at (x, z) with an itinerary and `waitingTicks` ticks waited (#1208). */
let _nextVehicleId = 1;
function makeWaitingAgent(x: number, z: number, waitingTicks: number): Employee {
  const id = _nextVehicleId++;
  const employees = createEmployeeState();
  const { employee } = hireEmployee(employees, 'driller', new Random(id), x, z);
  employee.id = id;
  employee.x = x;
  employee.z = z;
  employee.vehicleWaitingTicks = waitingTicks;
  employee.itinerary = {
    legs: [{ mode: 'foot', destX: 40, destZ: 40, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
    goal: { kind: 'reposition', x: 40, z: 40 },
    workTicks: 0,
    estTotalTicks: 5,
  } as unknown as Employee['itinerary'];
  return employee;
}

// ── Event system ─────────────────────────────────────────────────────────────

describe('Event system', () => {
  let ctx: GameContext;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCtx();
    _nextVehicleId = 100;
  });

  // ── 1. tick advances tickCount ────────────────────────────────────────────

  it('tick advances tickCount', () => {
    const initial = ctx.state!.tickCount;

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.tickCount).toBe(initial + 1);
  });

  it('tick advances tickCount by multiple when N > 1', () => {
    const initial = ctx.state!.tickCount;

    const result = tickCommand(ctx, ['5'], {});

    expect(result.success).toBe(true);
    // With no events registered, all 5 ticks should advance
    expect(ctx.state!.tickCount).toBe(initial + 5);
  });

  // ── 2. tick without pending event returns success with no event info ──────

  it('tick without pending event returns success with no event info', () => {
    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('No events fired');
  });

  it('multiple ticks without events reports count correctly', () => {
    const result = tickCommand(ctx, ['3'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Advanced 3 tick(s)');
    expect(result.output).toContain('No events fired');
  });

  // ── 3. event status shows no pending event when none fired ────────────────

  it('event status shows no pending event when none fired', () => {
    const result = eventCommand(ctx, ['status'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('No pending event');
  });

  it('event status shows pending event details after an event fires', () => {
    // Manually set a pending event on the state
    ctx.state!.events.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: 10 };

    const result = eventCommand(ctx, ['status'], {});

    expect(result.success).toBe(true);
    // Should mention the event title (i18n-resolved)
    expect(result.output).toContain('Pending event');
    expect(result.output).toContain('Coffee Uprising');
    // Should list option indices
    expect(result.output).toContain('[0]');
    expect(result.output).toContain('[1]');
    expect(result.output).toContain('[2]');
  });

  // ── 3b. event choose output includes the resolved outcome sentence (#421) ──

  it('event choose output includes the resolved outcome sentence between "Event resolved:" and "Consequences:"', () => {
    ctx.state!.events.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: ctx.state!.tickCount };

    const result = eventCommand(ctx, ['choose', '0'], {});

    expect(result.success).toBe(true);
    // Option 0 of union_coffee_uprising has no probability field — the plain
    // (non-_alt) key always applies.
    const expectedSentence = t('event.union_coffee_uprising.res0');
    expect(result.output).toContain(expectedSentence);

    const lines = result.output.split('\n');
    const resolvedIdx = lines.indexOf('Event resolved: union_coffee_uprising');
    const consequencesIdx = lines.indexOf('Consequences:');
    const sentenceIdx = lines.indexOf(expectedSentence);
    expect(resolvedIdx).toBe(0);
    expect(consequencesIdx).toBeGreaterThan(resolvedIdx);
    expect(sentenceIdx).toBeGreaterThan(resolvedIdx);
    expect(sentenceIdx).toBeLessThan(consequencesIdx);
  });

  it('event choose applies cashDelta to the flat state.cash field, not just state.finances.cash', () => {
    ctx.state!.events.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: ctx.state!.tickCount };
    const cashBefore = ctx.state!.cash;

    const result = eventCommand(ctx, ['choose', '0'], {});

    // Option 0 of union_coffee_uprising is cashDelta: -8000 with no
    // probability field, so the plain (non-alt) consequence always applies.
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(cashBefore - 8000);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);
  });

  // ── 3b-ii. event choose routes corruptionDelta through applyCorruptionDelta (#1406) ──

  it('event choose with a positive corruptionDelta reaching the threshold unlocks mafia', () => {
    // union_profit_sharing option 1: corruptionDelta +5, no cash cost (#1407: threshold is 20, start 5 below).
    ctx.state!.corruption.level = MAFIA_UNLOCK_THRESHOLD - 5;
    ctx.state!.events.pendingEvent = { eventId: 'union_profit_sharing', firedAtTick: ctx.state!.tickCount };
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(false);

    const result = eventCommand(ctx, ['choose', '1'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.corruption.level).toBeGreaterThanOrEqual(MAFIA_UNLOCK_THRESHOLD);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);
  });

  it('event choose with an option carrying no corruptionDelta leaves corruption untouched', () => {
    // union_profit_sharing option 0 has no corruptionDelta.
    ctx.state!.events.pendingEvent = { eventId: 'union_profit_sharing', firedAtTick: ctx.state!.tickCount };

    eventCommand(ctx, ['choose', '0'], {});

    expect(ctx.state!.corruption.level).toBe(0);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(false);
  });

  it('event choose with a clean-up option (corruptionDelta -25) at low level leaves level at 0', () => {
    // politics_whistleblower option 2 (full_reform): corruptionDelta -25.
    ctx.state!.corruption.level = 2;
    ctx.state!.events.pendingEvent = { eventId: 'politics_whistleblower', firedAtTick: ctx.state!.tickCount };

    const result = eventCommand(ctx, ['choose', '2'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.corruption.level).toBe(0);
  });

  it('mafiaUnlocked stays latched after a later clean-up choose', () => {
    ctx.state!.corruption.level = MAFIA_UNLOCK_THRESHOLD - 5;
    ctx.state!.events.pendingEvent = { eventId: 'union_profit_sharing', firedAtTick: ctx.state!.tickCount };
    eventCommand(ctx, ['choose', '1'], {});
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);

    ctx.state!.events.pendingEvent = { eventId: 'politics_whistleblower', firedAtTick: ctx.state!.tickCount };
    eventCommand(ctx, ['choose', '2'], {});

    expect(ctx.state!.corruption.level).toBe(0);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);
  });

  // ── 3c. event dismiss clears lastOutcome (P8) ──────────────────────────────

  it('event dismiss fails when there is no resolved outcome to dismiss', () => {
    const result = eventCommand(ctx, ['dismiss'], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('No resolved event to dismiss.');
  });

  it('event dismiss clears lastOutcome after a choose', () => {
    ctx.state!.events.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: ctx.state!.tickCount };
    eventCommand(ctx, ['choose', '0'], {});
    expect(ctx.state!.events.lastOutcome).not.toBeNull();

    const result = eventCommand(ctx, ['dismiss'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('Outcome dismissed.');
    expect(ctx.state!.events.lastOutcome).toBeNull();
  });

  // ── 4. tickEventSystem advances timers ─────────────────────────────────────

  it('tickEventSystem decrements timer remaining ticks', () => {
    const eventState = createEventSystemState();
    const evCtx = makeEventCtx();
    const rng = new Random(42);

    const unionTimer = eventState.timers.find(t => t.category === 'union')!;
    const politicsTimer = eventState.timers.find(t => t.category === 'politics')!;
    const initialUnion = unionTimer.remaining;
    const initialPolitics = politicsTimer.remaining;

    tickEventSystem(eventState, evCtx, rng);

    // Both timers should have decremented by 1
    expect(unionTimer.remaining).toBe(initialUnion - 1);
    expect(politicsTimer.remaining).toBe(initialPolitics - 1);
  });

  it('tickEventSystem does not fire when pendingEvent is set', () => {
    const eventState = createEventSystemState();
    eventState.pendingEvent = { eventId: 'existing', firedAtTick: 5 };

    const evCtx = makeEventCtx();
    const result = tickEventSystem(eventState, evCtx, new Random(42));

    // Should NOT fire a new event while one is pending
    expect(result).toBeNull();
    // pendingEvent should still be the original
    expect(eventState.pendingEvent!.eventId).toBe('existing');
  });

  it('tickEventSystem processes follow-up queue before timers', () => {
    const eventState = createEventSystemState();
    queueFollowUp(eventState, 'union_strike_aftermath');

    // pendingEvent should be null initially
    expect(eventState.pendingEvent).toBeNull();

    const evCtx = makeEventCtx();
    let result = null;
    for (let i = 0; i < FOLLOWUP_DELAY_TICKS && !result; i++) {
      result = tickEventSystem(eventState, evCtx, new Random(42));
    }

    // Should pick up the follow-up event
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('union_strike_aftermath');
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('union_strike_aftermath');
  });

  // ── 5. detectTrafficJam (#1208: chokepoint / position based) ──────────────

  const rampDef = { originX: 20, originZ: 10, direction: 'south' as const, length: 10, width: 3 as const, targetDepth: 5 };
  const ramp: BuiltRamp = { id: 1, def: rampDef, width: 3, footprint: rampFootprint(rampDef, 3) };

  it('detectTrafficJam returns null with no ramps and no employees', () => {
    const eventState = createEventSystemState();
    expect(detectTrafficJam([], [], eventState, 100)).toBeNull();
  });

  it('detectTrafficJam returns null with only 1 stuck agent on a ramp', () => {
    const eventState = createEventSystemState();
    expect(detectTrafficJam([ramp], [makeWaitingAgent(20.5, 14.5, 15)], eventState, 100)).toBeNull();
  });

  it('detectTrafficJam returns null with 2 stuck agents (below threshold of 3)', () => {
    const eventState = createEventSystemState();
    const agents = [makeWaitingAgent(20.5, 14.5, 12), makeWaitingAgent(20.5, 15.5, 15)];
    expect(detectTrafficJam([ramp], agents, eventState, 100)).toBeNull();
  });

  it('detectTrafficJam ignores agents below waiting-ticks threshold', () => {
    const eventState = createEventSystemState();
    const agents = [14.5, 15.5, 16.5].map(z => makeWaitingAgent(20.5, z, TRAFFIC_JAM_MIN_TICKS - 1));
    expect(detectTrafficJam([ramp], agents, eventState, 100)).toBeNull();
  });

  it('detectTrafficJam splits 2+2 agents across two ramps into no jam', () => {
    const eventState = createEventSystemState();
    const def2 = { ...rampDef, originX: 50 };
    const ramp2: BuiltRamp = { id: 2, def: def2, width: 3, footprint: rampFootprint(def2, 3) };
    const agents = [
      makeWaitingAgent(20.5, 14.5, 12), makeWaitingAgent(20.5, 15.5, 12),
      makeWaitingAgent(50.5, 14.5, 12), makeWaitingAgent(50.5, 15.5, 12),
    ];
    expect(detectTrafficJam([ramp, ramp2], agents, eventState, 100)).toBeNull();
  });

  it('detectTrafficJam fires when 3+ agents queue on a ramp long enough', () => {
    const eventState = createEventSystemState();
    const agents = [14.5, 15.5, 16.5].map((z, i) => makeWaitingAgent(20.5, z, 10 + i));
    const result = detectTrafficJam([ramp], agents, eventState, 42);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
    expect(result!.firedAtTick).toBe(42);
    expect(result!.jam?.key).toBe('ramp:1');
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('traffic_jam');
  });

  it('detectTrafficJam returns null when an event is already pending', () => {
    const eventState = createEventSystemState();
    eventState.pendingEvent = { eventId: 'existing_event', firedAtTick: 90 };
    const agents = [14.5, 15.5, 16.5].map(z => makeWaitingAgent(20.5, z, 10));
    expect(detectTrafficJam([ramp], agents, eventState, 100)).toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('existing_event');
  });

  // ── 6. detectUnqualifiedTask fires when unqualified action exists ─────────

  it('detectUnqualifiedTask returns null with empty action list', () => {
    const eventState = createEventSystemState();
    const result = detectUnqualifiedTask([], eventState, 100);
    expect(result).toBeNull();
  });

  it('detectUnqualifiedTask fires when unqualified action exists', () => {
    const eventState = createEventSystemState();
    const result = detectUnqualifiedTask([101, 102], eventState, 200);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('unqualified_task_error');
    expect(result!.firedAtTick).toBe(200);
    // Should also set state.pendingEvent
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('unqualified_task_error');
    expect(eventState.pendingEvent!.firedAtTick).toBe(200);
  });

  it('detectUnqualifiedTask returns null when event already pending', () => {
    const eventState = createEventSystemState();
    eventState.pendingEvent = { eventId: 'another_event', firedAtTick: 50 };

    const result = detectUnqualifiedTask([201], eventState, 300);

    expect(result).toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('another_event');
  });

  // ── 7. clearPendingEvent clears the current event ─────────────────────────

  it('clearPendingEvent clears the current event', () => {
    const eventState = createEventSystemState();
    eventState.pendingEvent = { eventId: 'test_event', firedAtTick: 50 };

    expect(eventState.pendingEvent).not.toBeNull();

    clearPendingEvent(eventState);

    expect(eventState.pendingEvent).toBeNull();
  });

  it('clearPendingEvent on already-clear state is a no-op', () => {
    const eventState = createEventSystemState();
    expect(eventState.pendingEvent).toBeNull();

    clearPendingEvent(eventState);

    expect(eventState.pendingEvent).toBeNull();
  });

  // ── 8. queueFollowUp adds to follow-up queue ───────────────────────────────

  it('queueFollowUp adds to follow-up queue', () => {
    const eventState = createEventSystemState();
    expect(eventState.followUpQueue).toHaveLength(0);

    queueFollowUp(eventState, 'followup_1');

    expect(eventState.followUpQueue).toHaveLength(1);
    expect(eventState.followUpQueue[0]).toBe('followup_1');
  });

  it('queueFollowUp supports multiple entries in order', () => {
    const eventState = createEventSystemState();

    queueFollowUp(eventState, 'first_followup');
    queueFollowUp(eventState, 'second_followup');
    queueFollowUp(eventState, 'third_followup');

    expect(eventState.followUpQueue).toHaveLength(3);
    expect(eventState.followUpQueue[0]).toBe('first_followup');
    expect(eventState.followUpQueue[1]).toBe('second_followup');
    expect(eventState.followUpQueue[2]).toBe('third_followup');
  });

  it('followUpQueue drains when tickEventSystem processes them', () => {
    const eventState = createEventSystemState();
    queueFollowUp(eventState, 'union_strike_aftermath');
    queueFollowUp(eventState, 'politics_mayor_wins');
    expect(eventState.followUpQueue).toHaveLength(2);

    const evCtx = makeEventCtx();
    for (let i = 0; i < FOLLOWUP_DELAY_TICKS; i++) tickEventSystem(eventState, evCtx, new Random(42));

    // First follow-up should have been consumed; second stays in queue
    expect(eventState.followUpQueue).toHaveLength(1);
    expect(eventState.followUpQueue[0]).toBe('politics_mayor_wins');
  });

  // ── 9. time command shows speed and pause state ────────────────────────────

  it('time command status shows speed and pause state', () => {
    const result = timeCommand(ctx, ['status'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Speed:');
    expect(result.output).toContain('Paused:');
    expect(result.output).toContain('1x'); // default speed
    expect(result.output).toContain('No'); // default: not paused
  });

  it('time command defaults to status when no subcommand given', () => {
    const result = timeCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Speed:');
    expect(result.output).toContain('Paused:');
  });

  it('time speed:N sets the speed like the positional form', () => {
    // Scenario files use the named form; it used to fall through to `status`,
    // reporting success while leaving the speed untouched.
    const result = timeCommand(ctx, [], { speed: '4' });

    expect(result.success).toBe(true);
    expect(ctx.state!.timeScale).toBe(4);
  });

  it('time speed:N rejects an invalid speed instead of silently reporting status', () => {
    const result = timeCommand(ctx, [], { speed: '3' });

    expect(result.success).toBe(false);
    expect(ctx.state!.timeScale).toBe(1);
  });

  it('time speed 2 still works positionally', () => {
    const result = timeCommand(ctx, ['speed', '2'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.timeScale).toBe(2);
  });

  it('time status shows Tick count', () => {
    // Advance a tick first so tickCount > 0
    tickCommand(ctx, ['1'], {});

    const result = timeCommand(ctx, ['status'], {});
    expect(result.output).toContain('Tick: 1');
  });

  // ── 10. time pause/resume toggles isPaused ─────────────────────────────────

  it('time pause sets isPaused to true', () => {
    ctx.state!.isPaused = false;

    const result = timeCommand(ctx, ['pause'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('paused');
    expect(ctx.state!.isPaused).toBe(true);
  });

  it('time resume sets isPaused to false', () => {
    ctx.state!.isPaused = true;

    const result = timeCommand(ctx, ['resume'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('resumed');
    expect(ctx.state!.isPaused).toBe(false);
  });

  it('pause then resume toggles isPaused correctly', () => {
    ctx.state!.isPaused = false;

    timeCommand(ctx, ['pause'], {});
    expect(ctx.state!.isPaused).toBe(true);

    timeCommand(ctx, ['resume'], {});
    expect(ctx.state!.isPaused).toBe(false);

    // Can pause again
    timeCommand(ctx, ['pause'], {});
    expect(ctx.state!.isPaused).toBe(true);
  });

  it('time rejects invalid subcommand', () => {
    const result = timeCommand(ctx, ['invalid'], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage:');
  });

  // ── 11. Console bridge action count ──────────────────────────────────────────

  describe('console bridge action count', () => {
    /** Console commands that should not count as user actions for event cooldown gating. */
    const META_COMMANDS = ['tick', 'speed', 'pause', 'time'] as const;

    beforeEach(() => {
      clearEvents();
      setupEvents();
    });

    /**
     * Simulate the post-processing that window.__gameConsole performs in main.ts:
     * run the command, extract cmdName, guard on meta commands, call incrementActionCount.
     */
    function simulateBridge(runner: import('../../src/console/ConsoleRunner.js').ConsoleRunner, ctx: GameContext, cmd: string) {
      const result = runner.run(cmd);
      const cmdName = parseCommand(cmd).command;
      if (ctx.state && !META_COMMANDS.includes(cmdName as typeof META_COMMANDS[number])) {
        incrementActionCount(ctx.state.events);
      }
      return result;
    }

    it('non-meta command increments actionCountSinceEvent via bridge', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:42 size:32');

      expect(ctx.state!.events.actionCountSinceEvent).toBe(0);

      simulateBridge(runner, ctx, 'employee hire role:blaster');

      expect(ctx.state!.events.actionCountSinceEvent).toBe(1);
    });

    it('meta command tick does NOT increment actionCountSinceEvent', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:42 size:32');

      simulateBridge(runner, ctx, 'tick 1');

      expect(ctx.state!.events.actionCountSinceEvent).toBe(0);
    });

    it('meta command time does NOT increment actionCountSinceEvent', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:42 size:32');

      simulateBridge(runner, ctx, 'time status');

      expect(ctx.state!.events.actionCountSinceEvent).toBe(0);
    });

    it('multiple non-meta commands accumulate action count', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:42 size:32');

      simulateBridge(runner, ctx, 'employee hire role:blaster');
      simulateBridge(runner, ctx, 'employee hire role:driller');
      simulateBridge(runner, ctx, 'finances');

      expect(ctx.state!.events.actionCountSinceEvent).toBe(3);
    });

    it('mixed meta and non-meta — only non-meta increments', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:42 size:32');

      simulateBridge(runner, ctx, 'tick 1');
      simulateBridge(runner, ctx, 'employee hire role:blaster');
      simulateBridge(runner, ctx, 'time status');
      simulateBridge(runner, ctx, 'finances');

      // 2 non-meta commands: employee, finances
      expect(ctx.state!.events.actionCountSinceEvent).toBe(2);
    });

    it('no crash when ctx.state is null (no game initialized)', () => {
      const { runner, ctx } = createRunner();
      // ctx.state is null — no new_game called

      // Should not throw
      expect(() => {
        runner.run('employee list');
        const cmdName = 'employee';
        if (ctx.state && !META_COMMANDS.includes(cmdName as typeof META_COMMANDS[number])) {
          incrementActionCount(ctx.state.events);
        }
      }).not.toThrow();
    });
  });

  // ── 12. Event cooldown cadence ──────────────────────────────────────────────

  describe('event cooldown cadence', () => {
    it('respects cooldown (120 ticks + 10 actions) in realistic tick+command sequence', () => {
      // ── Phase 0: Setup campaign context ──
      const ctx = makeCampaignCtx('dusty_hollow');

      // Disable non-union timers so only union events can fire
      for (const timer of ctx.state!.events.timers) {
        if (timer.category !== 'union') {
          timer.remaining = 99_999;
        }
      }

      // Pre-warm tickCount to skip past the initial no-timer-activity zone
      ctx.state!.tickCount = 110;

      // Union events need at least one employee (#1412)
      hireEmployee(ctx.state!.employees, 'driller', new Random(1), 0, 0);

      // Set union timer to expire in 2 ticks
      const unionTimer = ctx.state!.events.timers.find(t => t.category === 'union')!;
      unionTimer.remaining = 2;

      // Accumulate the required user actions for the cooldown check
      for (let i = 0; i < MIN_EVENT_INTERVAL_ACTIONS; i++) {
        incrementActionCount(ctx.state!.events);
      }
      expect(ctx.state!.events.actionCountSinceEvent).toBe(MIN_EVENT_INTERVAL_ACTIONS);

      // ── Phase 1: Fire the first event ──
      const safetyLimit = ctx.state!.tickCount + 500;
      while (!ctx.state!.events.pendingEvent && ctx.state!.tickCount < safetyLimit) {
        tickCommand(ctx, ['5'], {});
      }
      expect(ctx.state!.events.pendingEvent).not.toBeNull();
      const event1Tick = ctx.state!.events.pendingEvent!.firedAtTick;
      // Cooldown requires at least MIN_EVENT_INTERVAL_TICKS since lastEventTick (0)
      expect(event1Tick).toBeGreaterThanOrEqual(MIN_EVENT_INTERVAL_TICKS);
      // Action count must have been reset by the event firing
      expect(ctx.state!.events.actionCountSinceEvent).toBe(0);

      // Resolve first event so the game can advance again
      const resolveResult = eventCommand(ctx, ['choose', '0'], {});
      expect(resolveResult.success).toBe(true);
      expect(ctx.state!.events.pendingEvent).toBeNull();

      // ── Phase 2: Cooldown blocks immediate re-fire ──
      tickCommand(ctx, ['1'], {});
      expect(ctx.state!.events.pendingEvent).toBeNull();
      expect(ctx.state!.events.lastEventTick).toBe(event1Tick);

      // ── Phase 3: Second event with cooldown ──
      // Accumulate 10 actions again
      for (let i = 0; i < MIN_EVENT_INTERVAL_ACTIONS; i++) {
        incrementActionCount(ctx.state!.events);
      }
      expect(ctx.state!.events.actionCountSinceEvent).toBe(MIN_EVENT_INTERVAL_ACTIONS);

      // Tick until the next event fires
      const event2SafetyLimit = event1Tick + 500;
      while (!ctx.state!.events.pendingEvent && ctx.state!.tickCount < event2SafetyLimit) {
        tickCommand(ctx, ['5'], {});
      }
      expect(ctx.state!.events.pendingEvent).not.toBeNull();
      const event2Tick = ctx.state!.events.pendingEvent!.firedAtTick;
      // At least MIN_EVENT_INTERVAL_TICKS must elapse between consecutive events
      expect(event2Tick - event1Tick).toBeGreaterThanOrEqual(MIN_EVENT_INTERVAL_TICKS);
      expect(ctx.state!.events.actionCountSinceEvent).toBe(0);
    });
  });

  // ── 13. Game-over wiring — levelEndReason set from the 4 defeat trackers (P8) ──

  describe('levelEndReason wiring', () => {
    it('bankruptcy sets levelEnded + levelEndReason', () => {
      ctx.state!.cash = 0;
      ctx.state!.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
      expect(ctx.state!.levelEnded).toBe(true);
      expect(ctx.state!.levelEndReason).toBe('bankruptcy');
    });

    it('ecological shutdown sets levelEnded + levelEndReason', () => {
      ctx.state!.scores.ecology = 0;
      ctx.state!.ecological.ticksAtZero = ECOLOGICAL_SHUTDOWN_TICKS - 1;

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.ecological.shutdown).toBe(true);
      expect(ctx.state!.levelEnded).toBe(true);
      expect(ctx.state!.levelEndReason).toBe('ecological_shutdown');
    });

    it('arrest sets levelEnded + levelEndReason', () => {
      ctx.state!.mafia.exposureRisk = ARREST_EXPOSURE_THRESHOLD;

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.arrest.arrested).toBe(true);
      expect(ctx.state!.levelEnded).toBe(true);
      expect(ctx.state!.levelEndReason).toBe('arrest');
    });

    it('worker revolt sets levelEnded + levelEndReason', () => {
      ctx.state!.scores.wellBeing = 0;
      ctx.state!.revolt.ticksAtZero = REVOLT_TICKS - 1;

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.revolt.revolted).toBe(true);
      expect(ctx.state!.levelEnded).toBe(true);
      expect(ctx.state!.levelEndReason).toBe('worker_revolt');
    });

    it('bankruptcy and ecological shutdown triggering on the same tick — bankruptcy wins (checked first)', () => {
      ctx.state!.cash = 0;
      ctx.state!.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;
      ctx.state!.scores.ecology = 0;
      ctx.state!.ecological.ticksAtZero = ECOLOGICAL_SHUTDOWN_TICKS - 1;

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.bankruptcy.bankrupt).toBe(true);
      expect(ctx.state!.ecological.shutdown).toBe(true);
      expect(ctx.state!.levelEndReason).toBe('bankruptcy');
    });

    it('no defeat condition met leaves levelEnded false and levelEndReason null', () => {
      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.levelEnded).toBe(false);
      expect(ctx.state!.levelEndReason).toBeNull();
    });
  });
});

// ── #1380: every option of the "No Qualified Worker" event resolves the block ──
//
// Repro: hire a surveyor, queue a survey, the surveyor dies. The event used to fire every tick
// and none of its three options did anything (Hire a Contractor only took $25,000).

describe('unqualified_task_error — each option resolves the block (#1380)', () => {
  const FOLLOW_UP_TICKS = 25;

  interface Site { engine: RunnerWithContext; surveyActionId: number; cashAfterOrder: number; }

  function blockedSite(opts: { school?: boolean; driver?: boolean } = {}): Site {
    const engine = createRunner();
    expect(runCommand(engine, 'new_game seed:42 size:32 cash:900000').success).toBe(true);
    const state = () => engine.ctx.state!;
    expect(runCommand(engine, 'employee hire role:surveyor').success).toBe(true);
    const surveyor = state().employees.employees.at(-1)!;
    if (opts.driver) expect(runCommand(engine, 'employee hire role:driver').success).toBe(true);
    if (opts.school) {
      expect(placeBuilding(state().buildings, 'geology_lab', 20, 20, 32, 32).success).toBe(true);
    }
    expect(runCommand(engine, 'survey seismic x:12 z:12').success).toBe(true);
    const surveyActionId = state().pendingActions.find(a => a.type === 'survey')!.id;
    killEmployee(state().employees, surveyor.id);
    return { engine, surveyActionId, cashAfterOrder: state().cash };
  }

  const isUnqualified = (site: Site) => site.engine.ctx.state!.events.pendingEvent?.eventId === 'unqualified_task_error';

  /** Tick until the event fires; returns the tick count it took. */
  function tickToEvent(site: Site): number {
    for (let i = 1; i <= 10; i++) {
      runCommand(site.engine, 'tick 1');
      if (isUnqualified(site)) return i;
    }
    throw new Error('unqualified_task_error never fired');
  }

  /** Tick one at a time; an unrelated random event is cleared, but the unqualified one must never come back. */
  function expectNoRefire(site: Site, ticks = FOLLOW_UP_TICKS): void {
    for (let i = 0; i < ticks; i++) {
      const state = site.engine.ctx.state!;
      if (state.events.pendingEvent && !isUnqualified(site)) state.events.pendingEvent = null;
      runCommand(site.engine, 'tick 1');
      expect(isUnqualified(site), `unqualified_task_error re-fired ${i + 1} ticks after the answer`).toBe(false);
    }
  }

  it('fires once for the blocked survey and stays pending until answered', () => {
    const site = blockedSite();
    tickToEvent(site);
    expect(site.engine.ctx.state!.events.pendingEvent!.unqualifiedActionIds).toContain(site.surveyActionId);
  });

  it('Cancel the Task: survey and ghost gone, fee refunded, event does not return', () => {
    const site = blockedSite();
    const state = site.engine.ctx.state!;
    tickToEvent(site);
    const cashBefore = state.cash;
    const r = runCommand(site.engine, 'event choose 2');
    expect(r.success).toBe(true);
    expect(state.pendingActions.some(a => a.id === site.surveyActionId)).toBe(false);
    expect(state.ghostPreviews.some(g => g.id === site.surveyActionId)).toBe(false);
    expect(state.cash).toBe(cashBefore + SURVEY_COSTS.seismic);
    expect(state.cash).toBe(site.cashAfterOrder + SURVEY_COSTS.seismic);
    expect(r.output).not.toContain('cancel_task');
    expectNoRefire(site);
    expect(state.surveyResults).toHaveLength(0);
  });

  it('Hire a Contractor: $25,000 debited once, survey result recorded, event does not return', () => {
    const site = blockedSite();
    const state = site.engine.ctx.state!;
    tickToEvent(site);
    const cashBefore = state.cash;
    const r = runCommand(site.engine, 'event choose 1');
    expect(r.success).toBe(true);
    expect(state.cash).toBe(cashBefore - UNQUALIFIED_CONTRACTOR_FEE);
    expect(state.surveyResults).toHaveLength(1);
    expect(state.pendingActions.some(a => a.id === site.surveyActionId)).toBe(false);
    expect(r.output).not.toContain('hire_contractor');
    expectNoRefire(site);
    // The same work is not done twice.
    expect(state.surveyResults).toHaveLength(1);
  });

  it('Send Someone to Training: the driver is booked on geology, fee debited once, event does not return', () => {
    const site = blockedSite({ school: true, driver: true });
    const state = site.engine.ctx.state!;
    tickToEvent(site);
    const driver = state.employees.employees.find(e => e.alive && e.role === 'driver')!;
    const fee = planTraining(driver, 'geology', 1)!.fee;
    const cashBefore = state.cash;
    const r = runCommand(site.engine, 'event choose 0');
    expect(r.success).toBe(true);
    const booked = driver.pendingTrainingState ?? driver.trainingState;
    expect(booked?.skill).toBe('geology');
    expect(state.cash).toBe(cashBefore - fee);
    expectNoRefire(site);
    // Still enrolled or already inside: the survey is waiting for the trainee, not abandoned.
    expect(state.pendingActions.some(a => a.id === site.surveyActionId)).toBe(true);
    expect(state.surveyResults).toHaveLength(0);
  });

  it('Send Someone to Training with no school books nothing and the event does not return', () => {
    const site = blockedSite({ school: false, driver: true });
    const state = site.engine.ctx.state!;
    tickToEvent(site);
    const cashBefore = state.cash;
    const r = runCommand(site.engine, 'event choose 0');
    expect(r.success).toBe(true);
    expect(state.cash).toBe(cashBefore);
    expect(state.employees.employees.every(e => e.trainingState === null && (e.pendingTrainingState ?? null) === null)).toBe(true);
    expectNoRefire(site);
  });

  it('does not fire when the only surveyor is injured, not dead', () => {
    const site = blockedSite();
    const state = site.engine.ctx.state!;
    const surveyor = state.employees.employees.find(e => e.role === 'surveyor')!;
    surveyor.alive = true;
    surveyor.injured = true;
    expectNoRefire(site, 10);
    expect(state.pendingActions.find(a => a.id === site.surveyActionId)!.blockedReason).toBe('no_qualified_employee');
  });

  it('does not fire while the only surveyor is in training', () => {
    const site = blockedSite();
    const state = site.engine.ctx.state!;
    const surveyor = state.employees.employees.find(e => e.role === 'surveyor')!;
    surveyor.alive = true;
    expect(placeBuilding(state.buildings, 'blasting_academy', 20, 20, 32, 32).success).toBe(true);
    expect(runCommand(site.engine, `employee train ${surveyor.id} skill:blasting`).success).toBe(true);
    expect(surveyor.pendingTrainingState ?? surveyor.trainingState).not.toBeNull();
    expectNoRefire(site, 10);
    expect(state.pendingActions.find(a => a.id === site.surveyActionId)?.blockedReason).toBe('no_qualified_employee');
  });
});

// ── #1411: failed bribe / botched mafia consequences through the console ──

describe('failed bribe and botched mafia consequences (#1411)', () => {
  it('a failed bribe deducts cost plus the fine from cash and raises corruption by more than the base attempt', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
      const s = ctx.state!;
      s.seed = seed;
      s.cash = 1_000_000;
      s.finances.cash = s.cash;
      const nuisanceBefore = s.scores.nuisance;
      const cashBefore = s.cash;
      const out = corruptCommand(ctx, [], { target: 'judge' });
      const attempt = s.corruption.attempts[s.corruption.attempts.length - 1]!;
      if (attempt.success) continue;
      expect(out.success).toBe(true);
      const fine = bribeFailureFine(attempt.cost);
      expect(fine).toBeGreaterThan(0);
      expect(s.cash).toBe(cashBefore - attempt.cost - fine);
      expect(s.scores.nuisance).toBeLessThan(nuisanceBefore);
      expect(s.corruption.level).toBe(1 + BRIBERY_FAILURE_CORRUPTION_DELTA);
      return;
    }
    expect.unreachable('no failed bribe in 200 seeds');
  });

  it('a successful bribe charges no fine', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
      const s = ctx.state!;
      s.seed = seed;
      s.cash = 1_000_000;
      s.finances.cash = s.cash;
      corruptCommand(ctx, [], { target: 'judge' });
      const attempt = s.corruption.attempts[s.corruption.attempts.length - 1]!;
      if (!attempt.success) continue;
      expect(s.cash).toBe(1_000_000 - attempt.cost);
      return;
    }
    expect.unreachable('no successful bribe in 200 seeds');
  });

  it('a botched mafia accident queues the police investigation follow-up and raises exposure', () => {
    for (let seed = 0; seed < 200; seed++) {
      const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
      const s = ctx.state!;
      s.seed = seed;
      s.cash = 1_000_000;
      s.corruption.mafiaUnlocked = true;
      const { employee } = hireEmployee(s.employees, 'driller', new Random(1), 0, 0);
      const out = mafiaCommand(ctx, ['accident'], { employee: String(employee.id) });
      expect(out.success).toBe(true);
      if (employee.alive === false) continue; // accident succeeded
      expect(s.events.followUpQueue).toContain(INVESTIGATION_FOLLOWUP_EVENT_ID);
      expect(s.mafia.exposureRisk).toBeGreaterThanOrEqual(
        ACCIDENT_EXPOSURE + ACCIDENT_FAILURE_EXPOSURE_EXTRA + INVESTIGATION_EXPOSURE_JUMP - 1e-9,
      );
      return;
    }
    expect.unreachable('no botched accident in 200 seeds');
  });

  it('choosing the stonewall option raises mafia exposure by exactly its delta', () => {
    const def = getEventById('mafia_police_investigation');
    expect(def).toBeDefined();
    const idx = def!.consequences.findIndex(c => c.effectTag === 'stonewall_police');
    expect(idx).toBeGreaterThanOrEqual(0);
    const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    ctx.state!.mafia.exposureRisk = 0.3;
    ctx.state!.events.pendingEvent = { eventId: 'mafia_police_investigation', firedAtTick: ctx.state!.tickCount };
    const r = eventCommand(ctx, ['choose', String(idx)], {});
    expect(r.success).toBe(true);
    expect(ctx.state!.mafia.exposureRisk).toBeCloseTo(0.3 + def!.consequences[idx]!.exposureDelta!, 10);
    expect(ctx.state!.events.lastOutcome!.effects).toContainEqual({ kind: 'other', key: 'exposure', delta: 15 });
  });
});
