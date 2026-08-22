// BlastSimulator2026 — Integration tests: Event system (Phase 6)
// Covers timer-based events, traffic jam detection, unqualified task detection,
// event lifecycle (pending, clear, follow-up), and time/pause console commands.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { tickCommand, eventCommand, timeCommand } from '../../src/console/commands/events.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
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
import { createRunner } from '../../src/console/createRunner.js';
import { parseCommand } from '../../src/console/ConsoleRunner.js';
import { makeCampaignCtx } from './full-level/helpers.js';
import type { DamageState } from '../../src/core/entities/Damage.js';
import {
  MIN_EVENT_INTERVAL_TICKS,
  MIN_EVENT_INTERVAL_ACTIONS,
  BANKRUPTCY_GRACE_TICKS,
  ECOLOGICAL_SHUTDOWN_TICKS,
  ARREST_EXPOSURE_THRESHOLD,
  REVOLT_TICKS,
} from '../../src/core/config/balance.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'blaster'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

/** Minimal EventContext for core-API calls that don't need a full GameState. */
function makeEventCtx(overrides: Partial<{
  wellBeing: number;
  safety: number;
  ecology: number;
  nuisance: number;
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
    },
    employeeCount: overrides.employeeCount ?? 0,
    deathCount: overrides.deathCount ?? 0,
    corruptionLevel: overrides.corruptionLevel ?? 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: overrides.tickCount ?? 0,
    lawsuitCount: overrides.lawsuitCount ?? 0,
    activeContractCount: overrides.activeContractCount ?? 0,
    weatherId: 'clear',
  };
}

/** Build a minimal waiting-vehicle fixture for traffic-jam tests. */
let _nextVehicleId: number;
function makeWaitingVehicle(
  targetX: number,
  targetZ: number,
  waitingTicks: number,
  overrides?: Partial<Vehicle>,
): Vehicle {
  const id = _nextVehicleId++;
  return {
    id,
    type: 'debris_hauler',
    tier: 1,
    x: targetX - 1,
    z: targetZ,
    hp: 100,
    task: 'moving',
    targetX,
    targetZ,
    driverId: null,
    state: 'waiting',
    payloadKg: 0,
    waitingTicks,
    ...overrides,
  };
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
    eventState.followUpQueue.push('union_coffee_uprising');

    // pendingEvent should be null initially
    expect(eventState.pendingEvent).toBeNull();

    const evCtx = makeEventCtx();
    const result = tickEventSystem(eventState, evCtx, new Random(42));

    // Should pick up the follow-up event
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('union_coffee_uprising');
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('union_coffee_uprising');
  });

  // ── 5. detectTrafficJam returns null with insufficient vehicles ───────────

  it('detectTrafficJam returns null with empty vehicle list', () => {
    const eventState = createEventSystemState();
    const result = detectTrafficJam([], eventState, 100);
    expect(result).toBeNull();
  });

  it('detectTrafficJam returns null with only 1 vehicle', () => {
    const eventState = createEventSystemState();
    const vehicles = [makeWaitingVehicle(5, 5, 15)];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  it('detectTrafficJam returns null with 2 vehicles (below threshold of 3)', () => {
    const eventState = createEventSystemState();
    const vehicles = [
      makeWaitingVehicle(5, 5, 12),
      makeWaitingVehicle(5, 5, 15),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  it('detectTrafficJam ignores vehicles below waiting-ticks threshold', () => {
    const eventState = createEventSystemState();
    // 3 vehicles on same target but each has waited only 5 ticks (< 10)
    const vehicles = [
      makeWaitingVehicle(3, 3, 5),
      makeWaitingVehicle(3, 3, 5),
      makeWaitingVehicle(3, 3, 5),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  it('detectTrafficJam ignores non-waiting vehicles even if on shared target', () => {
    const eventState = createEventSystemState();
    const vehicles = [
      makeWaitingVehicle(8, 8, 10),
      makeWaitingVehicle(8, 8, 10),
      { ...makeWaitingVehicle(8, 8, 10), state: 'moving' as const },
    ];
    // Only 2 are in 'waiting' state → below threshold of 3
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  it('detectTrafficJam fires when 3+ vehicles wait on same target long enough', () => {
    const eventState = createEventSystemState();
    const vehicles = [
      makeWaitingVehicle(7, 2, 10),
      makeWaitingVehicle(7, 2, 12),
      makeWaitingVehicle(7, 2, 15),
    ];
    const result = detectTrafficJam(vehicles, eventState, 42);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
    expect(result!.firedAtTick).toBe(42);
    // Should also set state.pendingEvent
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('traffic_jam');
  });

  it('detectTrafficJam returns null when an event is already pending', () => {
    const eventState = createEventSystemState();
    eventState.pendingEvent = { eventId: 'existing_event', firedAtTick: 90 };

    const vehicles = [
      makeWaitingVehicle(2, 2, 10),
      makeWaitingVehicle(2, 2, 10),
      makeWaitingVehicle(2, 2, 10),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);

    expect(result).toBeNull();
    // The pre-existing pending event must not be overwritten
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
    queueFollowUp(eventState, 'union_coffee_uprising');
    queueFollowUp(eventState, 'union_overtime_revolt');
    expect(eventState.followUpQueue).toHaveLength(2);

    const evCtx = makeEventCtx();
    tickEventSystem(eventState, evCtx, new Random(42));

    // First follow-up should have been consumed; second stays in queue
    expect(eventState.followUpQueue).toHaveLength(1);
    expect(eventState.followUpQueue[0]).toBe('union_overtime_revolt');
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
        const result = runner.run('employee list');
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

  // ── 14. Crisis-floor wiring (#698) ──────────────────────────────────────────
  // Exercises tickCommand's lastDeathTick/crisisActiveCount derivation and
  // eventCommand's lastSafetyRecoveryTick stamping through the real command
  // handlers — tests/unit/scores/ScoreManager.test.ts covers the pure
  // reassertFloorIfCrisisActive(state, crisisActive) function in isolation;
  // this covers the wiring around it that decides what crisisActive *is*.

  describe('crisis-floor wiring (#698)', () => {
    /** Record a fatal accident and bump deathCount — mirrors what
     * processEmployeeHit (Damage.ts) does on a real fatal fragment hit,
     * without needing a full blast pipeline. Does NOT touch scores.safety
     * directly — the floor pin is left to tickCommand's own
     * reassertFloorIfCrisisActive wiring, so the ticks below prove the real
     * mechanism drives safety to 0, rather than asserting a hand-set value.
     */
    function recordDeath(ctx: GameContext): void {
      const state = ctx.state!;
      state.damage.accidents.push({
        tick: state.tickCount,
        type: 'death',
        entityId: 999,
        fragmentId: 1,
        kineticEnergy: 5000,
      });
      state.damage.deathCount++;
    }

    it('untagged event resolution does not lift the post-death safety floor', () => {
      recordDeath(ctx);
      tickCommand(ctx, ['1'], {}); // drives safety to 0 via the crisis floor
      expect(ctx.state!.scores.safety).toBe(0);

      // lawsuit_osha_hardhats' option 0 (osha_full_overhaul) has a positive
      // safety delta but carries no resolvesDeathCrisis tag.
      const fireResult = eventCommand(ctx, ['fire', 'lawsuit_osha_hardhats'], {});
      expect(fireResult.success).toBe(true);
      const chooseResult = eventCommand(ctx, ['choose', '0'], {});
      expect(chooseResult.success).toBe(true);
      expect(chooseResult.output).toContain('osha_full_overhaul');
      expect(ctx.state!.scores.safety).toBe(15);
      expect(ctx.state!.damage.lastSafetyRecoveryTick).toBeNull();

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.scores.safety).toBe(0);
    });

    it('resolvesDeathCrisis-tagged event resolution lifts the floor and it stays lifted', () => {
      recordDeath(ctx);
      // Advance well past updateScores' own 10-tick recentAccidents window so
      // the assertion below isolates the crisis-floor mechanism from that
      // unrelated -5 safety penalty (recordDeath's accident would otherwise
      // still be "recent" and mask the floor lifting with its own penalty).
      tickCommand(ctx, ['15'], {});
      expect(ctx.state!.scores.safety).toBe(0);

      // Option 0 (settle_death_suit) is tagged resolvesDeathCrisis: true.
      const fireResult = eventCommand(ctx, ['fire', 'lawsuit_wrongful_death'], {});
      expect(fireResult.success).toBe(true);
      const chooseResult = eventCommand(ctx, ['choose', '0'], {});
      expect(chooseResult.success).toBe(true);
      expect(chooseResult.output).toContain('settle_death_suit');
      expect(ctx.state!.damage.lastSafetyRecoveryTick).toBe(ctx.state!.tickCount);

      tickCommand(ctx, ['1'], {});

      // The resolved +5 safety delta stands — not reset to 0.
      expect(ctx.state!.scores.safety).toBeGreaterThan(0);
    });

    it('a second death re-arms the crisis after a recovery', () => {
      recordDeath(ctx);
      tickCommand(ctx, ['15'], {});
      eventCommand(ctx, ['fire', 'lawsuit_wrongful_death'], {});
      eventCommand(ctx, ['choose', '0'], {});
      tickCommand(ctx, ['1'], {});
      expect(ctx.state!.scores.safety).toBeGreaterThan(0); // recovered

      // A second, later death re-arms the crisis regardless of the earlier
      // recovery already recorded on lastSafetyRecoveryTick.
      recordDeath(ctx);
      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.scores.safety).toBe(0);

      // Stays re-pinned on a subsequent tick too, not just the one right
      // after the new death.
      tickCommand(ctx, ['1'], {});
      expect(ctx.state!.scores.safety).toBe(0);
    });

    it('treats a legacy save (lastSafetyRecoveryTick deserialized as undefined) as crisis-active', () => {
      // A save serialized before #698 added the field deserializes it as
      // `undefined` (key absent), not `null` — construct that shape directly
      // rather than going through createDamageState(), which always sets it.
      ctx.state!.damage = {
        accidents: [{ tick: 0, type: 'death', entityId: 1, fragmentId: 1, kineticEnergy: 5000 }],
        lawsuitPending: false,
        deathCount: 1,
        blastCount: 0,
      } as unknown as DamageState;
      expect(ctx.state!.damage.lastSafetyRecoveryTick).toBeUndefined();

      tickCommand(ctx, ['1'], {});

      expect(ctx.state!.scores.safety).toBe(0);
    });
  });
});
