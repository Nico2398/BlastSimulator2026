import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { performSurvey, isSurveyed, SURVEY_COST } from '../../../src/core/mining/Survey.js';

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
