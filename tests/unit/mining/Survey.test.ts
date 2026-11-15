import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { performSurvey, isSurveyed, SURVEY_COST } from '../../../src/core/mining/Survey.js';
import { runSurvey } from '../../../src/core/mining/SurveyCalc.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';

describe('Survey system', () => {
  it('unsurveyed position returns false', () => {
    const state = createGame({ seed: 42 });
    expect(isSurveyed(state, 10, 20)).toBe(false);
  });

  it('after performSurvey, position is revealed', () => {
    const state = createGame({ seed: 42 });
    const result = performSurvey(state, 10, 20);
    expect(result.success).toBe(true);
    expect(isSurveyed(state, 10, 20)).toBe(true);
  });

  it('surveying deducts cost from finances', () => {
    const state = createGame({ seed: 42, startingCash: 1000 });
    const before = state.cash;
    performSurvey(state, 5, 5);
    expect(state.cash).toBe(before - SURVEY_COST);
  });

  it('re-surveying is a no-op (no extra cost)', () => {
    const state = createGame({ seed: 42, startingCash: 1000 });
    performSurvey(state, 5, 5);
    const afterFirst = state.cash;
    const result = performSurvey(state, 5, 5);
    expect(result.alreadySurveyed).toBe(true);
    expect(state.cash).toBe(afterFirst);
  });

  it('survey fails if not enough cash', () => {
    const state = createGame({ seed: 42, startingCash: 10 });
    const result = performSurvey(state, 5, 5);
    expect(result.success).toBe(false);
    expect(isSurveyed(state, 5, 5)).toBe(false);
  });
});

// ── runSurvey: method gate by mine grade (#2279) ──────────────────────────────

describe('runSurvey method gate (#2279)', () => {
  function staffedState(grade: number | undefined) {
    const state = createGame({ seed: 42, startingCash: 50_000 });
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(99));
    assignSkill(state.employees, employee.id, 'geology', 1);
    if (grade !== undefined) state.grade = { ...createGradeState(), grade };
    return state;
  }
  const AT = { centerX: 10, centerZ: 20 };

  it('refuses core_sample at grade 0 with method_locked and the grade that opens it', () => {
    const state = staffedState(0);
    const result = runSurvey(state, { method: 'core_sample', ...AT });
    expect(result).toEqual({ success: false, error: 'method_locked', neededGrade: 1 });
  });

  it('a refused survey deducts no cash, books no expense and queues nothing', () => {
    const state = staffedState(0);
    const cash = state.cash;
    const expenses = state.finances.transactions.length;
    const nextId = state.nextPendingActionId;
    runSurvey(state, { method: 'core_sample', ...AT });
    expect(state.cash).toBe(cash);
    expect(state.finances.cash).toBe(state.cash);
    expect(state.finances.transactions).toHaveLength(expenses);
    expect(state.pendingActions).toHaveLength(0);
    expect(state.ghostPreviews).toHaveLength(0);
    expect(state.nextPendingActionId).toBe(nextId);
  });

  it.each(['aerial', 'seismic'] as const)('allows %s at grade 0', (method) => {
    const state = staffedState(0);
    const result = runSurvey(state, { method, ...AT });
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(state.pendingActions).toHaveLength(1);
  });

  it.each([1, 2, 3])('allows core_sample at grade %i', (grade) => {
    const state = staffedState(grade);
    const result = runSurvey(state, { method: 'core_sample', ...AT });
    expect(result.success).toBe(true);
    expect(state.pendingActions).toHaveLength(1);
  });

  it('allows core_sample on a site with no grade (non-progression)', () => {
    const state = staffedState(undefined);
    expect(state.grade).toBeUndefined();
    const result = runSurvey(state, { method: 'core_sample', ...AT });
    expect(result.success).toBe(true);
  });

  it('the grade-up opens the method: refused at 0, accepted once grade is 1', () => {
    const state = staffedState(0);
    expect(runSurvey(state, { method: 'core_sample', ...AT }).error).toBe('method_locked');
    state.grade!.grade = 1;
    expect(runSurvey(state, { method: 'core_sample', ...AT }).success).toBe(true);
  });
});
