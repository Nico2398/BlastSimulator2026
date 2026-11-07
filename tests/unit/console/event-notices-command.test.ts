// BlastSimulator2026 — console wiring of minor-event notices (#2146): `event fire|choose|status` and `tick`
// treat a minor event as an optional, non-blocking notice and a major one as the blocking pending event.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { registerEvents, clearEvents, type EventDef } from '../../../src/core/events/EventPool.js';
import { EVENT_NOTICE_COUNTDOWN_TICKS, MIN_EVENT_INTERVAL_ACTIONS } from '../../../src/core/config/balance.js';

function makeEvent(id: string, consequences: EventDef['consequences']): EventDef {
  return {
    id,
    category: 'weather',
    titleKey: `event.${id}.title`,
    descKey: `event.${id}.desc`,
    options: consequences.map((_, i) => ({ labelKey: `event.${id}.opt${i}`, resultKey: `event.${id}.res${i}` })),
    consequences,
    weightCoeff: () => 1,
    canFire: () => true,
  };
}

/** Minor at ordinary cash. Option 2 is the default answer (+500). */
const CMD_MINOR_A = makeEvent('cmd_minor_a', [{ cashDelta: -300 }, { cashDelta: 0 }, { cashDelta: 500 }]);
const CMD_MINOR_B = makeEvent('cmd_minor_b', [{ cashDelta: -50 }, { cashDelta: 70 }]);
/** Major whatever the cash: option 1 stops work. */
const CMD_MAJOR = makeEvent('cmd_major', [
  { cashDelta: -20 },
  { cashDelta: 0, effects: [{ type: 'work_stoppage', hours: 4 }] },
]);

function setup(cash = 1_000_000) {
  const { runner, ctx } = createRunner();
  runner.run('new_game mine_type:desert seed:42');
  clearEvents();
  registerEvents([CMD_MINOR_A, CMD_MINOR_B, CMD_MAJOR]);
  const state = ctx.state!;
  state.cash = cash;
  state.isPaused = false;
  // No timer event interferes unless a test arms one.
  for (const t of state.events.timers) t.remaining = 1_000_000_000;
  return { run: (cmd: string) => runner.run(cmd), state };
}

beforeEach(() => clearEvents());
afterEach(() => clearEvents());

describe('event fire', () => {
  it('a minor event becomes a notice and is not the pending event', () => {
    const { run, state } = setup();
    const r = run('event fire cmd_minor_a');
    expect(r.success).toBe(true);
    expect(state.events.pendingEvent).toBeNull();
    expect(state.events.minorNotices).toHaveLength(1);
    expect(state.events.minorNotices[0]).toMatchObject({
      eventId: 'cmd_minor_a', firedAtTick: state.tickCount, minor: true,
      expiresAtTick: state.tickCount + EVENT_NOTICE_COUNTDOWN_TICKS,
    });
    expect(state.events.firedEventIds).toContain('cmd_minor_a');
  });

  it('a minor event does not pause the clock', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    expect(state.isPaused).toBe(false);
  });

  it('a major event sets pendingEvent and leaves the notices alone', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    const r = run('event fire cmd_major');
    expect(r.success).toBe(true);
    expect(state.events.pendingEvent?.eventId).toBe('cmd_major');
    expect(state.events.minorNotices.map(n => n.eventId)).toEqual(['cmd_minor_a']);
    expect(state.isPaused).toBe(true);
  });

  it('a minor event is major when the player is too poor to absorb it', () => {
    const { run, state } = setup(100);
    run('event fire cmd_minor_a');
    expect(state.events.pendingEvent?.eventId).toBe('cmd_minor_a');
    expect(state.events.minorNotices).toEqual([]);
  });

  it('two minor events make two notices', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_minor_b');
    expect(state.events.minorNotices.map(n => n.eventId)).toEqual(['cmd_minor_a', 'cmd_minor_b']);
  });

  it('an unknown event id is refused and creates nothing', () => {
    const { run, state } = setup();
    expect(run('event fire no_such_event').success).toBe(false);
    expect(state.events.minorNotices).toEqual([]);
    expect(state.events.pendingEvent).toBeNull();
  });
});

describe('tick with notices', () => {
  it('advances while only notices exist', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    const before = state.tickCount;
    const r = run('tick 5');
    expect(r.success).toBe(true);
    expect(state.tickCount).toBe(before + 5);
    expect(state.isPaused).toBe(false);
    expect(state.events.minorNotices).toHaveLength(1);
  });

  it('still refuses while a major is pending', () => {
    const { run, state } = setup();
    run('event fire cmd_major');
    const before = state.tickCount;
    expect(run('tick 3').success).toBe(false);
    expect(state.tickCount).toBe(before);
  });

  it('still refuses while a major is pending next to a notice', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_major');
    const before = state.tickCount;
    expect(run('tick').success).toBe(false);
    expect(state.tickCount).toBe(before);
  });

  it('a timer-fired minor event prints its EVENT lines but neither pauses nor cuts the batch short', () => {
    const { run, state } = setup();
    clearEvents();
    registerEvents([CMD_MINOR_A]);
    state.tickCount = 5000;
    state.events.lastEventTick = 0;
    state.events.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    state.events.timers.find(t => t.category === 'weather')!.remaining = 1;
    const r = run('tick 10');
    expect(r.success).toBe(true);
    expect(r.output).toContain('EVENT:');
    expect(state.tickCount).toBe(5010);
    expect(state.isPaused).toBe(false);
    expect(state.events.pendingEvent).toBeNull();
    expect(state.events.minorNotices.map(n => n.eventId)).toEqual(['cmd_minor_a']);
  });

  it('a timer-fired major event still pauses and cuts the batch short', () => {
    const { run, state } = setup(50);
    clearEvents();
    registerEvents([CMD_MINOR_A]);
    state.tickCount = 5000;
    state.events.lastEventTick = 0;
    state.events.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    state.events.timers.find(t => t.category === 'weather')!.remaining = 1;
    const r = run('tick 10');
    expect(r.success).toBe(true);
    expect(r.output).toContain('EVENT:');
    expect(state.tickCount).toBe(5001);
    expect(state.isPaused).toBe(true);
    expect(state.events.pendingEvent?.eventId).toBe('cmd_minor_a');
  });

  it('an ignored notice resolves itself when its countdown ends', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    const cashBefore = state.cash;
    run(`tick ${EVENT_NOTICE_COUNTDOWN_TICKS - 1}`);
    expect(state.events.minorNotices).toHaveLength(1);
    expect(state.events.lastNoticeOutcome).toBeNull();
    run('tick 1');
    expect(state.events.minorNotices).toEqual([]);
    expect(state.events.lastNoticeOutcome).toMatchObject({
      eventId: 'cmd_minor_a', resultKey: 'event.cmd_minor_a.res2', auto: true, seq: 1,
    });
    expect(state.cash - cashBefore).toBe(500);
  });
});

describe('event choose on a notice', () => {
  it('resolves the named notice and records a player answer', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    const cashBefore = state.cash;
    const r = run('event choose 0 cmd_minor_a');
    expect(r.success).toBe(true);
    expect(state.events.minorNotices).toEqual([]);
    expect(state.cash).toBe(cashBefore - 300);
    expect(state.events.lastNoticeOutcome).toEqual({
      eventId: 'cmd_minor_a', resultKey: 'event.cmd_minor_a.res0', auto: false, seq: 1,
    });
    expect(state.events.lastOutcome).toBeNull();
  });

  it('does not change the clock when the clock was running', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    state.isPaused = false;
    run('event choose 1 cmd_minor_a');
    expect(state.isPaused).toBe(false);
  });

  it('does not change the clock when the clock was paused', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    state.isPaused = true;
    run('event choose 1 cmd_minor_a');
    expect(state.isPaused).toBe(true);
  });

  it('answers the named notice while a major stays pending', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_major');
    const r = run('event choose 1 cmd_minor_a');
    expect(r.success).toBe(true);
    expect(state.events.minorNotices).toEqual([]);
    expect(state.events.pendingEvent?.eventId).toBe('cmd_major');
    expect(state.isPaused).toBe(true);
    expect(state.events.lastOutcome).toBeNull();
  });

  it('without an event id resolves the pending major first and leaves the notice', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_major');
    const r = run('event choose 0');
    expect(r.success).toBe(true);
    expect(state.events.pendingEvent).toBeNull();
    expect(state.events.lastOutcome?.eventId).toBe('cmd_major');
    expect(state.events.minorNotices.map(n => n.eventId)).toEqual(['cmd_minor_a']);
    expect(state.events.lastNoticeOutcome).toBeNull();
  });

  it('without an event id and with no major resolves the oldest notice', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('tick 1');
    run('event fire cmd_minor_b');
    const r = run('event choose 1');
    expect(r.success).toBe(true);
    expect(state.events.minorNotices.map(n => n.eventId)).toEqual(['cmd_minor_b']);
    expect(state.events.lastNoticeOutcome).toMatchObject({ eventId: 'cmd_minor_a', auto: false });
  });

  it('numbers successive answers with an increasing seq', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_minor_b');
    run('event choose 0 cmd_minor_a');
    expect(state.events.lastNoticeOutcome?.seq).toBe(1);
    run('event choose 0 cmd_minor_b');
    expect(state.events.lastNoticeOutcome?.seq).toBe(2);
  });

  it('refuses an option index out of range and keeps the notice', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    const cashBefore = state.cash;
    expect(run('event choose 99 cmd_minor_a').success).toBe(false);
    expect(run('event choose -1 cmd_minor_a').success).toBe(false);
    expect(state.events.minorNotices).toHaveLength(1);
    expect(state.cash).toBe(cashBefore);
    expect(state.events.lastNoticeOutcome).toBeNull();
  });

  it('refuses a non-numeric option', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    expect(run('event choose abc cmd_minor_a').success).toBe(false);
    expect(state.events.minorNotices).toHaveLength(1);
  });

  it('refuses an event id that has no notice', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    expect(run('event choose 0 cmd_minor_b').success).toBe(false);
    expect(state.events.minorNotices).toHaveLength(1);
  });

  it('refuses when there is nothing to answer', () => {
    const { run } = setup();
    expect(run('event choose 0').success).toBe(false);
  });

  it('refuses a notice that already expired on its own', () => {
    const { run, state } = setup();
    run('event fire cmd_minor_a');
    run(`tick ${EVENT_NOTICE_COUNTDOWN_TICKS}`);
    expect(state.events.minorNotices).toEqual([]);
    expect(run('event choose 0 cmd_minor_a').success).toBe(false);
  });
});

describe('event status with notices', () => {
  it('succeeds with nothing pending and no notice', () => {
    const { run } = setup();
    expect(run('event status').success).toBe(true);
  });

  it('lists a notice with the ticks left on its countdown', () => {
    const { run } = setup();
    run('event fire cmd_minor_a');
    const r = run('event status');
    expect(r.success).toBe(true);
    expect(r.output).toContain('event.cmd_minor_a.title');
    expect(r.output).toContain(String(EVENT_NOTICE_COUNTDOWN_TICKS));
  });

  it('shows the countdown shrinking as ticks pass', () => {
    const { run } = setup();
    run('event fire cmd_minor_a');
    run('tick 10');
    expect(run('event status').output).toContain(String(EVENT_NOTICE_COUNTDOWN_TICKS - 10));
  });

  it('lists every notice', () => {
    const { run } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_minor_b');
    const out = run('event status').output;
    expect(out).toContain('event.cmd_minor_a.title');
    expect(out).toContain('event.cmd_minor_b.title');
  });

  it('lists the pending major together with the notices', () => {
    const { run } = setup();
    run('event fire cmd_minor_a');
    run('event fire cmd_major');
    const out = run('event status').output;
    expect(out).toContain('event.cmd_major.title');
    expect(out).toContain('event.cmd_minor_a.title');
  });

  it('no longer lists a notice once it is answered', () => {
    const { run } = setup();
    run('event fire cmd_minor_a');
    run('event choose 0 cmd_minor_a');
    expect(run('event status').output).not.toContain('event.cmd_minor_a.title');
  });
});
