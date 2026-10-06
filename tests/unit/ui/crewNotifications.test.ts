// BlastSimulator2026 — wireCrewNotifications (#1387): crew event toasts.
import { describe, it, expect, beforeEach } from 'vitest';
import { wireCrewNotifications } from '../../../src/ui/notify/crewNotifications.js';
import type { NotifyInput } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { CREW_TOAST_COOLDOWN_TICKS } from '../../../src/core/config/balance.js';
import en from '../../../src/core/i18n/locales/en.json';

type Handler = (payload: never) => void;

function makeEmitter() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: ((event: string, h: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
      return () => undefined;
    }) as never,
    fire(event: string, payload: unknown): void {
      for (const h of handlers.get(event) ?? []) (h as (p: unknown) => void)(payload);
    },
    has(event: string): boolean { return (handlers.get(event) ?? []).length > 0; },
  };
}

describe('crew notification i18n keys', () => {
  const keys = [
    'notification.title.crew',
    'notification.crew.collapsed',
    'notification.crew.need_warning',
    'notification.crew.levelup',
    'notification.crew.trained',
    'notification.crew.training_cancelled',
    'notification.crew.stuck',
    'notification.crew.action_abandoned',
    'ui.crew.task_stuck',
    'notification.pip.crew_stuck_tip',
  ];
  for (const key of keys) {
    it(`en.json defines ${key}`, () => {
      expect((en as Record<string, string>)[key]).toBeTypeOf('string');
    });
  }
});

describe('wireCrewNotifications', () => {
  let state: GameState;
  let emitter: ReturnType<typeof makeEmitter>;
  let notes: NotifyInput[];
  let empId: number;
  let empName: string;

  beforeEach(() => {
    setLocale('en');
    state = createGame({ seed: 42 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(42), 0, 0);
    empId = employee.id;
    empName = employee.name;
    emitter = makeEmitter();
    notes = [];
    wireCrewNotifications(emitter, () => state, n => notes.push(n));
  });

  it('subscribes to all seven crew events', () => {
    for (const ev of [
      'employee:collapsed', 'employee:need_warning', 'employee:levelup', 'employee:trained',
      'employee:training_cancelled', 'agent:stuck', 'agent:action_abandoned',
    ]) {
      expect(emitter.has(ev), ev).toBe(true);
    }
  });

  it('collapse raises a critical toast naming the employee', () => {
    emitter.fire('employee:collapsed', { employeeId: empId, needKey: 'fatigue' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('critical');
    expect(notes[0]!.title).toBe(t('notification.title.crew'));
    expect(notes[0]!.body).toContain(empName);
    expect(notes[0]!.body).not.toContain('notification.crew.');
  });

  it('need warning raises a warn toast naming the employee', () => {
    emitter.fire('employee:need_warning', { employeeId: empId, needKey: 'fatigue' });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.body).toContain(empName);
  });

  it('stuck raises a warn toast', () => {
    emitter.fire('agent:stuck', { employeeId: empId });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.body).toContain(empName);
  });

  it('abandoned action raises a warn toast', () => {
    emitter.fire('agent:action_abandoned', { employeeId: empId, actionId: 5 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.body).toContain(empName);
  });

  it('cancelled training is warn and states the formatted refund', () => {
    emitter.fire('employee:training_cancelled', { employeeId: empId, skill: 'driving', buildingId: 1, refund: 1234 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.body).toContain(empName);
    expect(notes[0]!.body).toContain(formatMoney(1234));
  });

  it('level up is info and names the employee and new level', () => {
    emitter.fire('employee:levelup', { employeeId: empId, category: 'driving', oldLevel: 1, newLevel: 2 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('info');
    expect(notes[0]!.body).toContain(empName);
    expect(notes[0]!.body).toContain('2');
  });

  it('trained is info; isNew switches the text', () => {
    emitter.fire('employee:trained', { employeeId: empId, skill: 'driving', level: 1, isNew: true });
    emitter.fire('employee:trained', { employeeId: empId, skill: 'driving', level: 2, isNew: false });
    expect(notes).toHaveLength(2);
    expect(notes[0]!.severity).toBe('info');
    expect(notes[1]!.severity).toBe('info');
    expect(notes[0]!.body).toContain(empName);
    expect(notes[1]!.body).toContain(empName);
    expect(notes[0]!.body).not.toBe(notes[1]!.body);
  });

  it('falls back to #id for an unknown employee, without throwing', () => {
    expect(() => emitter.fire('employee:collapsed', { employeeId: 9999, needKey: 'fatigue' })).not.toThrow();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('#9999');
  });

  it('does not throw when state is null', () => {
    const e2 = makeEmitter();
    const n2: NotifyInput[] = [];
    wireCrewNotifications(e2, () => null, n => n2.push(n));
    expect(() => e2.fire('agent:stuck', { employeeId: 3 })).not.toThrow();
    expect(() => e2.fire('employee:collapsed', { employeeId: 3, needKey: 'fatigue' })).not.toThrow();
    for (const n of n2) expect(n.body).toContain('#3');
  });

  it('localizes through the active locale', () => {
    emitter.fire('employee:collapsed', { employeeId: empId, needKey: 'fatigue' });
    const english = notes[0]!;
    setLocale('fr');
    emitter.fire('employee:collapsed', { employeeId: empId, needKey: 'fatigue' });
    setLocale('en');
    expect(notes[1]!.body).not.toBe(english.body);
    expect(notes[1]!.body).toContain(empName);
  });

  describe('cooldown for stuck / abandoned', () => {
    it('suppresses repeated stuck toasts for one employee within the cooldown', () => {
      emitter.fire('agent:stuck', { employeeId: empId });
      state.tickCount += CREW_TOAST_COOLDOWN_TICKS - 1;
      emitter.fire('agent:stuck', { employeeId: empId });
      expect(notes).toHaveLength(1);
    });

    it('toasts again once the cooldown has elapsed', () => {
      emitter.fire('agent:stuck', { employeeId: empId });
      state.tickCount += CREW_TOAST_COOLDOWN_TICKS;
      emitter.fire('agent:stuck', { employeeId: empId });
      expect(notes).toHaveLength(2);
    });

    it('suppresses repeated abandoned toasts within the cooldown, then re-arms', () => {
      emitter.fire('agent:action_abandoned', { employeeId: empId, actionId: 1 });
      emitter.fire('agent:action_abandoned', { employeeId: empId, actionId: 2 });
      expect(notes).toHaveLength(1);
      state.tickCount += CREW_TOAST_COOLDOWN_TICKS + 1;
      emitter.fire('agent:action_abandoned', { employeeId: empId, actionId: 3 });
      expect(notes).toHaveLength(2);
    });

    it('is keyed per employee', () => {
      const { employee: other } = hireEmployee(state.employees, 'blaster', new Random(7), 0, 0);
      emitter.fire('agent:stuck', { employeeId: empId });
      emitter.fire('agent:stuck', { employeeId: other.id });
      expect(notes).toHaveLength(2);
    });

    it('is keyed per kind: stuck does not suppress abandoned', () => {
      emitter.fire('agent:stuck', { employeeId: empId });
      emitter.fire('agent:action_abandoned', { employeeId: empId, actionId: 1 });
      expect(notes).toHaveLength(2);
    });
  });
});
