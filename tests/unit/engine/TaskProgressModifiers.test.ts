import { describe, it, expect } from 'vitest';
import { tickTaskProgress } from '../../../src/core/engine/TaskProgress.js';
import { addModifier } from '../../../src/core/events/ActiveModifiers.js';
import { makeEffectWorld, mod } from '../../helpers/eventEffectWorld.js';

function workingFixture() {
  const fx = makeEffectWorld();
  const emp = fx.state.employees.employees.find(e => e.role === 'driller')!;
  emp.taskTicksRemaining = 10;
  emp.activeTaskTotalTicks = 10;
  fx.state.tickCount = 5;
  return { ...fx, emp };
}

describe('task progress under event modifiers (#1414)', () => {
  it('without modifiers one tick decrements by one', () => {
    const { state, emp } = workingFixture();
    tickTaskProgress(state, emp);
    expect(emp.taskTicksRemaining).toBe(9);
  });

  it('a work_stoppage keeps taskTicksRemaining unchanged', () => {
    const { state, emp } = workingFixture();
    addModifier(state.events.activeModifiers, mod({ kind: 'work_stoppage', startTick: 0, endTick: 100 }), 1);
    for (let i = 0; i < 5; i++) tickTaskProgress(state, emp);
    expect(emp.taskTicksRemaining).toBe(10);
  });

  it('a role-limited stoppage spares other roles', () => {
    const { state, emp } = workingFixture();
    addModifier(state.events.activeModifiers, mod({ kind: 'work_stoppage', role: 'driver', endTick: 100 }), 1);
    tickTaskProgress(state, emp);
    expect(emp.taskTicksRemaining).toBe(9);
  });

  it('a 0.5 work_rate halves progress over time', () => {
    const { state, emp } = workingFixture();
    addModifier(state.events.activeModifiers, mod({ kind: 'work_rate', magnitude: 0.5, endTick: 100 }), 1);
    for (let i = 0; i < 4; i++) tickTaskProgress(state, emp);
    expect(emp.taskTicksRemaining).toBe(8);
  });

  it('an expired stoppage no longer stops work', () => {
    const { state, emp } = workingFixture();
    addModifier(state.events.activeModifiers, mod({ kind: 'work_stoppage', endTick: 5 }), 1);
    tickTaskProgress(state, emp);
    expect(emp.taskTicksRemaining).toBe(9);
  });
});
