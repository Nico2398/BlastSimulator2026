import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { drawLeavers, storeLeavers, leaverLabel, pickLeaver } from '../../../src/core/events/EventLeavers.js';
import type { EventDef } from '../../../src/core/events/EventPool.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import { makeEffectWorld } from '../../helpers/eventEffectWorld.js';

function def(effectsByOption: Array<EventDef['consequences'][number]['effects']>): EventDef {
  return {
    id: 'leaver_test', category: 'mafia', titleKey: 't', descKey: 'd',
    options: effectsByOption.map((_, i) => ({ labelKey: `l${i}`, resultKey: `event.leaver_test.res${i}` })),
    consequences: effectsByOption.map(effects => (effects ? { cashDelta: 0, effects } : { cashDelta: 0 })),
    weightCoeff: () => 1, canFire: () => true,
  };
}
const pending = (): FiredEvent => ({ eventId: 'leaver_test', firedAtTick: 1 });

describe('pickLeaver', () => {
  it('role pick returns an employee of that role', () => {
    const { state, rng } = makeEffectWorld();
    const e = pickLeaver({ type: 'employee_leaves', pick: 'role', role: 'manager' }, state.employees.employees, rng);
    expect(e?.role).toBe('manager');
  });

  it('returns undefined for an empty roster', () => {
    const { rng } = makeEffectWorld({ empty: true });
    expect(pickLeaver({ type: 'employee_leaves', pick: 'random' }, [], rng)).toBeUndefined();
  });

  it('returns undefined when no employee has the role', () => {
    const { state, rng } = makeEffectWorld();
    state.employees.employees = state.employees.employees.filter(e => e.role !== 'surveyor');
    expect(pickLeaver({ type: 'employee_leaves', pick: 'role', role: 'surveyor' }, state.employees.employees, rng)).toBeUndefined();
  });

  it('junior pick takes the highest hiredAtTick, ties to the highest id', () => {
    const { state, rng } = makeEffectWorld();
    const staff = state.employees.employees;
    for (const e of staff) e.hiredAtTick = 0;
    staff[1]!.hiredAtTick = 9;
    staff[3]!.hiredAtTick = 9;
    expect(pickLeaver({ type: 'employee_leaves', pick: 'junior' }, staff, rng)?.id).toBe(Math.max(staff[1]!.id, staff[3]!.id));
    staff[0]!.hiredAtTick = 20;
    expect(pickLeaver({ type: 'employee_leaves', pick: 'junior' }, staff, rng)?.id).toBe(staff[0]!.id);
  });

  it('random pick returns a roster member', () => {
    const { state, rng } = makeEffectWorld();
    const e = pickLeaver({ type: 'employee_leaves', pick: 'random' }, state.employees.employees, rng);
    expect(state.employees.employees.map(x => x.id)).toContain(e!.id);
  });
});

describe('drawLeavers', () => {
  it('draws one entry per option holding employee_leaves, keyed by option index', () => {
    const { state, rng } = makeEffectWorld();
    const d = def([undefined, [{ type: 'employee_leaves', pick: 'random' }], [{ type: 'work_stoppage', hours: 1 }], [{ type: 'employee_leaves', pick: 'role', role: 'manager' }]]);
    const draws = drawLeavers(d, state.employees.employees, rng);
    expect(draws.map(x => x.optionIndex)).toEqual([1, 3]);
    expect(state.employees.employees.map(e => e.id)).toContain(draws[0]!.employeeId);
    expect(state.employees.employees.find(e => e.id === draws[1]!.employeeId)!.role).toBe('manager');
  });

  it('draws nothing for an event without employee_leaves', () => {
    const { state, rng } = makeEffectWorld();
    expect(drawLeavers(def([undefined, [{ type: 'employee_injured' }]]), state.employees.employees, rng)).toEqual([]);
  });

  it('records employeeId null when nobody matches', () => {
    const { state, rng } = makeEffectWorld();
    state.employees.employees = state.employees.employees.filter(e => e.role !== 'surveyor');
    const d = def([[{ type: 'employee_leaves', pick: 'role', role: 'surveyor' }]]);
    expect(drawLeavers(d, state.employees.employees, rng)).toEqual([{ optionIndex: 0, employeeId: null }]);
  });

  it('records null for every option on an empty roster', () => {
    const { rng } = makeEffectWorld({ empty: true });
    const d = def([[{ type: 'employee_leaves', pick: 'random' }], [{ type: 'employee_leaves', pick: 'junior' }]]);
    expect(drawLeavers(d, [], rng)).toEqual([{ optionIndex: 0, employeeId: null }, { optionIndex: 1, employeeId: null }]);
  });

  it('does not draw for an employee_leaves only in the alt consequence', () => {
    const { state, rng } = makeEffectWorld();
    const d = def([undefined]);
    d.consequences[0] = { cashDelta: 0, probability: 0.5, altConsequence: { cashDelta: 0, effects: [{ type: 'employee_leaves', pick: 'random' }] } };
    expect(drawLeavers(d, state.employees.employees, rng)).toEqual([]);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const fx = makeEffectWorld({ seed: 11 });
      return drawLeavers(def([[{ type: 'employee_leaves', pick: 'random' }]]), fx.state.employees.employees, new Random(5));
    };
    expect(run()).toEqual(run());
  });

  it('draws random leavers through rng.nextInt', () => {
    const { state } = makeEffectWorld();
    const staff = state.employees.employees;
    const rng = new Random(3);
    const expected = staff[new Random(3).nextInt(0, staff.length - 1)]!.id;
    const draws = drawLeavers(def([[{ type: 'employee_leaves', pick: 'random' }]]), staff, rng);
    expect(draws[0]!.employeeId).toBe(expected);
  });
});

describe('storeLeavers', () => {
  it('stores the draws on the pending event', () => {
    const { state, rng } = makeEffectWorld();
    const p = pending();
    storeLeavers(p, def([undefined, [{ type: 'employee_leaves', pick: 'random' }]]), state.employees.employees, rng);
    expect(p.leavers).toHaveLength(1);
    expect(p.leavers![0]!.optionIndex).toBe(1);
  });

  it('leaves the field absent when no option takes an employee', () => {
    const { state, rng } = makeEffectWorld();
    const p = pending();
    storeLeavers(p, def([undefined, undefined]), state.employees.employees, rng);
    expect('leavers' in p).toBe(false);
  });

  it('is a no-op for a null pending event or an undefined def', () => {
    const { state, rng } = makeEffectWorld();
    const d = def([[{ type: 'employee_leaves', pick: 'random' }]]);
    expect(() => storeLeavers(null, d, state.employees.employees, rng)).not.toThrow();
    const p = pending();
    storeLeavers(p, undefined, state.employees.employees, rng);
    expect(p.leavers).toBeUndefined();
  });

  it('does not consume rng without a pending event', () => {
    const { state } = makeEffectWorld();
    const rng = new Random(9);
    storeLeavers(null, def([[{ type: 'employee_leaves', pick: 'random' }]]), state.employees.employees, rng);
    expect(rng.nextInt(0, 1000)).toBe(new Random(9).nextInt(0, 1000));
  });
});

describe('leaverLabel', () => {
  it('is undefined without a pending event', () => {
    expect(leaverLabel(null, 0, [])).toBeUndefined();
  });

  it('is undefined when the option has no stored draw', () => {
    const { state } = makeEffectWorld();
    const p = { ...pending(), leavers: [{ optionIndex: 1, employeeId: state.employees.employees[0]!.id }] };
    expect(leaverLabel(p, 0, state.employees.employees)).toBeUndefined();
    expect(leaverLabel(pending(), 0, state.employees.employees)).toBeUndefined();
  });

  it('names the stored leaver and role', () => {
    const { state } = makeEffectWorld();
    const e = state.employees.employees[2]!;
    const p = { ...pending(), leavers: [{ optionIndex: 1, employeeId: e.id }] };
    expect(leaverLabel(p, 1, state.employees.employees)).toEqual({ name: e.name, role: e.role });
  });

  it("is 'nobody' for a null draw", () => {
    const { state } = makeEffectWorld();
    const p = { ...pending(), leavers: [{ optionIndex: 0, employeeId: null }] };
    expect(leaverLabel(p, 0, state.employees.employees)).toBe('nobody');
  });

  it("is 'nobody' when the leaver is gone from the roster", () => {
    const { state } = makeEffectWorld();
    const e = state.employees.employees[2]!;
    const p = { ...pending(), leavers: [{ optionIndex: 0, employeeId: e.id }] };
    state.employees.employees = state.employees.employees.filter(x => x.id !== e.id);
    expect(leaverLabel(p, 0, state.employees.employees)).toBe('nobody');
  });

  it("is 'nobody' when the leaver is dead", () => {
    const { state } = makeEffectWorld();
    const e = state.employees.employees[2]!;
    e.alive = false;
    const p = { ...pending(), leavers: [{ optionIndex: 0, employeeId: e.id }] };
    expect(leaverLabel(p, 0, state.employees.employees)).toBe('nobody');
  });
});
