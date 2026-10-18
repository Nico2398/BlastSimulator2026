// BlastSimulator2026 — Integration: employee_leaves options name their leaver at fire time (#1908)

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { tickCommand, eventCommand } from '../../src/console/commands/events.js';
import { setupEvents } from '../../src/core/events/index.js';
import { clearEvents, registerEvents, type EventDef } from '../../src/core/events/EventPool.js';
import { leaverLabel } from '../../src/core/events/EventLeavers.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { createGame } from '../../src/core/state/GameState.js';

const LEAVE_EVENT: EventDef = {
  id: 'leaver_followup', category: 'mafia', followUpOnly: true,
  titleKey: 'event.leaver_followup.title', descKey: 'event.leaver_followup.desc',
  options: [
    { labelKey: 'event.leaver_followup.opt0', resultKey: 'event.leaver_followup.res0' },
    { labelKey: 'event.leaver_followup.opt1', resultKey: 'event.leaver_followup.res1' },
    { labelKey: 'event.leaver_followup.opt2', resultKey: 'event.leaver_followup.res2' },
  ],
  consequences: [
    { cashDelta: 0 },
    { cashDelta: 0, effects: [{ type: 'employee_leaves', pick: 'random' }] },
    { cashDelta: 0, effects: [{ type: 'employee_leaves', pick: 'role', role: 'manager' }] },
  ],
  weightCoeff: () => 1, canFire: () => true,
};

function started() {
  const { runner, ctx } = createRunner();
  runner.run('new_game mine_type:desert seed:42 staffed:true');
  // new_game re-registers the shipped pool, so the test event goes in afterwards.
  registerEvents([LEAVE_EVENT]);
  return ctx;
}

describe('event leavers', () => {
  beforeEach(() => { clearEvents(); setupEvents(); });

  it('console fire stores one draw per employee_leaves option', () => {
    const ctx = started();
    eventCommand(ctx, ['fire', 'leaver_followup'], {});
    const leavers = ctx.state!.events.pendingEvent!.leavers!;
    expect(leavers.map(l => l.optionIndex)).toEqual([1, 2]);
    const roster = ctx.state!.employees.employees;
    expect(roster.some(e => e.id === leavers[0]!.employeeId)).toBe(true);
  });

  it('console fire of an event without leave options leaves the field absent', () => {
    const ctx = started();
    eventCommand(ctx, ['fire', 'union_strike_aftermath'], {});
    expect('leavers' in ctx.state!.events.pendingEvent!).toBe(false);
  });

  it('a tick-fired event stores its leavers from the living staff', () => {
    const ctx = started();
    const s = ctx.state!;
    s.events.followUpQueue = ['leaver_followup'];
    s.events.followUpDelayTicks = 1;
    tickCommand(ctx, ['1'], {});
    const pending = s.events.pendingEvent;
    expect(pending?.eventId).toBe('leaver_followup');
    expect(pending!.leavers).toHaveLength(2);
    // The staffed roster has no manager, so the role option draws nobody (null).
    const [random, byRole] = pending!.leavers!;
    expect(s.employees.employees.find(e => e.id === random!.employeeId)?.alive).toBe(true);
    expect(byRole!.employeeId).toBeNull();
  });

  it('choosing the option removes exactly the shown employee and the outcome names them', () => {
    const ctx = started();
    eventCommand(ctx, ['fire', 'leaver_followup'], {});
    const s = ctx.state!;
    const shown = leaverLabel(s.events.pendingEvent!, 1, s.employees.employees);
    expect(shown).not.toBe('nobody');
    const id = s.events.pendingEvent!.leavers![0]!.employeeId!;
    // Roster churn between fire and choice must not change who leaves.
    s.isPaused = false;
    eventCommand(ctx, ['choose', '1'], {});
    expect(s.employees.employees.some(e => e.id === id)).toBe(false);
    const chip = s.events.lastOutcome!.effects.find(e => e.textKey?.startsWith('ui.event.effect.employee_leaves'));
    expect(chip?.textKey).toBe('ui.event.effect.employee_leaves_named');
    expect((chip as unknown as { params: { name: string } }).params.name).toBe((shown as { name: string }).name);
  });

  it('the shown leaver is gone by choice time: nobody leaves, no fresh draw', () => {
    const ctx = started();
    eventCommand(ctx, ['fire', 'leaver_followup'], {});
    const s = ctx.state!;
    const id = s.events.pendingEvent!.leavers![0]!.employeeId!;
    s.employees.employees = s.employees.employees.filter(e => e.id !== id);
    const before = s.employees.employees.length;
    eventCommand(ctx, ['choose', '1'], {});
    expect(s.employees.employees).toHaveLength(before);
    expect(s.events.lastOutcome!.resultKey).toBe('event.leaver_followup.res1_alt');
    expect(s.events.lastOutcome!.effects.some(e => e.textKey === 'ui.event.effect.employee_leaves_nobody')).toBe(true);
  });

  it('an old pending event without leavers resolves through a choice-time draw', () => {
    const ctx = started();
    const s = ctx.state!;
    s.events.pendingEvent = { eventId: 'leaver_followup', firedAtTick: s.tickCount };
    const before = s.employees.employees.length;
    eventCommand(ctx, ['choose', '1'], {});
    expect(s.employees.employees).toHaveLength(before - 1);
  });

  it('leavers survive a save round trip and still decide who leaves', () => {
    const game = createGame({ seed: 42 });
    game.events.pendingEvent = { eventId: 'leaver_followup', firedAtTick: 3, leavers: [{ optionIndex: 1, employeeId: 4 }, { optionIndex: 2, employeeId: null }] };
    const restored = deserialize(serialize(game));
    expect(restored.events.pendingEvent!.leavers).toEqual([{ optionIndex: 1, employeeId: 4 }, { optionIndex: 2, employeeId: null }]);
  });

  it('an old save without leavers loads with the field absent', () => {
    const game = createGame({ seed: 42 });
    game.events.pendingEvent = { eventId: 'leaver_followup', firedAtTick: 3 };
    const restored = deserialize(serialize(game));
    expect(restored.events.pendingEvent).toEqual({ eventId: 'leaver_followup', firedAtTick: 3 });
  });
});
