// BlastSimulator2026 — Unit tests for computeXpPerTick (issue #619)
//
// computeXpPerTick lives in src/core/entities/EmployeeXpRules.ts and was
// extracted from GameLoop.ts's tickTaskProgress
// (`const xpPerTick = 1 + Math.floor(currentLevel * 0.5);`).
//
// Formula: XP_PER_TICK_BASE + floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE)
// With XP_PER_TICK_BASE = 1 and XP_PER_TICK_LEVEL_SCALE = 0.5, pinned values:
//   level 1 -> 1, level 2 -> 2, level 3 -> 2, level 4 -> 3, level 5 -> 3

import { describe, it, expect } from 'vitest';
import { computeXpPerTick, computeTaskXpAwards } from '../../../src/core/entities/EmployeeXpRules.js';
import { XP_PER_TICK_BASE, XP_PER_TICK_LEVEL_SCALE } from '../../../src/core/config/balance.js';
import { createEmployeeState, hireEmployee, assignSkill, type Employee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

describe('computeXpPerTick', () => {
  it('returns 1 XP for proficiency level 1 (Rookie, minimum boundary)', () => {
    expect(computeXpPerTick(1)).toBe(1);
  });

  it('returns 2 XP for proficiency level 2', () => {
    expect(computeXpPerTick(2)).toBe(2);
  });

  it('returns 2 XP for proficiency level 3', () => {
    expect(computeXpPerTick(3)).toBe(2);
  });

  it('returns 3 XP for proficiency level 4', () => {
    expect(computeXpPerTick(4)).toBe(3);
  });

  it('returns 3 XP for proficiency level 5 (Master, maximum boundary)', () => {
    expect(computeXpPerTick(5)).toBe(3);
  });

  it('matches the formula derived directly from the balance constants for every level', () => {
    // Stays correct if XP_PER_TICK_BASE / XP_PER_TICK_LEVEL_SCALE are later
    // retuned — asserts the *relationship*, not just today's pinned numbers.
    const levels: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
    for (const level of levels) {
      const expected = XP_PER_TICK_BASE + Math.floor(level * XP_PER_TICK_LEVEL_SCALE);
      expect(computeXpPerTick(level)).toBe(expected);
    }
  });

  it('is non-decreasing as proficiency level increases (rejects an inverted formula)', () => {
    let previous = computeXpPerTick(1);
    for (const level of [2, 3, 4, 5] as const) {
      const current = computeXpPerTick(level);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('always returns an integer XP award (never a fractional tick grant)', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const award = computeXpPerTick(level);
      expect(Number.isInteger(award)).toBe(true);
    }
  });
});

// ── computeTaskXpAwards (issue #621) ─────────────────────────────────────
//
// Replaces tickTaskProgress's direct single-skill `gainXp` call with a pure
// rule function returning a list of awards, so future multi-skill task types
// can award more than one category per tick without touching GameLoop.ts.

describe('computeTaskXpAwards', () => {
  const SEED = 42;

  function makeAction(overrides: Partial<PendingAction> & { requiredSkill: PendingAction['requiredSkill'] }): PendingAction {
    return {
      id: 1,
      type: 'general_work',
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: null,
      ...overrides,
    };
  }

  function makeEmployee(role: 'driller' | 'blaster' | 'driver' | 'surveyor' | 'manager' = 'blaster'): Employee {
    const state = createEmployeeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state, role, rng);
    return employee;
  }

  it('drill_hole-shaped action (requiredSkill: blasting) returns exactly one award at Rookie level', () => {
    const employee = makeEmployee('blaster'); // starts with 'blasting' level 1
    const action = makeAction({ type: 'drill_hole', requiredSkill: 'blasting' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'blasting', amount: computeXpPerTick(1) }]);
  });

  it('drill_hole-shaped action scales the award via computeXpPerTick as proficiency rises (not hardcoded)', () => {
    const state = createEmployeeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 4);
    const action = makeAction({ type: 'drill_hole', requiredSkill: 'blasting' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'blasting', amount: computeXpPerTick(4) }]);
    // Regression guard: level 1 and level 4 must not produce the same amount,
    // or this assertion would pass even with a hardcoded constant.
    expect(computeXpPerTick(4)).not.toBe(computeXpPerTick(1));
  });

  it('drill_hole-shaped action at Master (level 5) uses the level-5 rate', () => {
    const state = createEmployeeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 5);
    const action = makeAction({ type: 'drill_hole', requiredSkill: 'blasting' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'blasting', amount: computeXpPerTick(5) }]);
  });

  it('survey-shaped action (requiredSkill: geology) returns exactly one award', () => {
    const employee = makeEmployee('surveyor'); // starts with 'geology' level 1
    const action = makeAction({ type: 'survey', requiredSkill: 'geology' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'geology', amount: computeXpPerTick(1) }]);
  });

  it('survey-shaped action scales via computeXpPerTick at a higher geology level', () => {
    const state = createEmployeeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state, 'surveyor', rng);
    assignSkill(state, employee.id, 'geology', 3);
    const action = makeAction({ type: 'survey', requiredSkill: 'geology' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'geology', amount: computeXpPerTick(3) }]);
  });

  it('action with requiredSkill: null (e.g. haul_debris/fragment_debris) returns an empty array', () => {
    const employee = makeEmployee('driver');
    const action = makeAction({ type: 'haul_debris', requiredSkill: null });

    expect(computeTaskXpAwards(employee, action)).toEqual([]);
  });

  it('action with requiredSkill: null returns an empty array regardless of employee qualifications', () => {
    const employee = makeEmployee('blaster');
    const action = makeAction({ type: 'fragment_debris', requiredSkill: null });

    expect(computeTaskXpAwards(employee, action)).toEqual([]);
  });

  it('employee with no qualification at all in the required category defaults level to 1', () => {
    const employee = makeEmployee('driver'); // only has 'driving.truck', not 'geology'
    expect(employee.qualifications.some(q => q.category === 'geology')).toBe(false);
    const action = makeAction({ type: 'survey', requiredSkill: 'geology' });

    const awards = computeTaskXpAwards(employee, action);

    expect(awards).toEqual([{ category: 'geology', amount: computeXpPerTick(1) }]);
  });

  it('does not mutate the employee object passed in', () => {
    const employee = makeEmployee('blaster');
    const before = JSON.parse(JSON.stringify(employee));
    const action = makeAction({ type: 'drill_hole', requiredSkill: 'blasting' });

    computeTaskXpAwards(employee, action);

    expect(JSON.parse(JSON.stringify(employee))).toEqual(before);
  });

  it('does not mutate the action object passed in', () => {
    const employee = makeEmployee('blaster');
    const action = makeAction({ type: 'drill_hole', requiredSkill: 'blasting' });
    const before = JSON.parse(JSON.stringify(action));

    computeTaskXpAwards(employee, action);

    expect(JSON.parse(JSON.stringify(action))).toEqual(before);
  });

  it('is pure — calling it twice with the same inputs returns equal results', () => {
    const employee = makeEmployee('surveyor');
    const action = makeAction({ type: 'survey', requiredSkill: 'geology' });

    const first = computeTaskXpAwards(employee, action);
    const second = computeTaskXpAwards(employee, action);

    expect(second).toEqual(first);
  });
});
