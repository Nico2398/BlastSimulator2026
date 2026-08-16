// BlastSimulator2026 — Scenario goal checking (state half, command mode)
//
// checkGoalAgainstState is the command-mode half of a step's `expect`: no
// DOM, so only `equals`/`increased` are checkable — the interaction-mode
// half (`usable`/`blocked`/`tutorialStep`) is interaction-driver.ts's checkGoal,
// exercised in tests/unit/scenario-interaction.test.ts instead. Both modes
// check the fields they can; neither is a no-op channel.

import { describe, it, expect } from 'vitest';
import { checkGoalAgainstState } from '../../scripts/shared/scenario-goal.js';

describe('checkGoalAgainstState — equals', () => {
  it('passes when every field matches exactly', () => {
    const violation = checkGoalAgainstState(
      { equals: { cash: 70000, buildingCount: 1 } },
      {},
      { cash: 70000, buildingCount: 1 },
    );
    expect(violation).toBeNull();
  });

  it('fails naming the field, expected value, and actual value', () => {
    const violation = checkGoalAgainstState(
      { equals: { cash: 70000 } },
      {},
      { cash: 80000 },
    );
    expect(violation).toContain('cash');
    expect(violation).toContain('70000');
    expect(violation).toContain('80000');
  });

  it('fails when the after state is null (step produced no state dump)', () => {
    const violation = checkGoalAgainstState({ equals: { cash: 70000 } }, {}, null);
    expect(violation).toContain('cash');
  });

  it('distinguishes missing field from a genuine mismatch — undefined does not satisfy "equals 0"', () => {
    const violation = checkGoalAgainstState({ equals: { holeCount: 0 } }, {}, {});
    expect(violation).toContain('holeCount');
  });
});

describe('checkGoalAgainstState — increased', () => {
  it('passes when the field grew', () => {
    const violation = checkGoalAgainstState(
      { increased: ['employeeCount'] },
      { employeeCount: 0 },
      { employeeCount: 1 },
    );
    expect(violation).toBeNull();
  });

  it('fails when the field stayed flat', () => {
    const violation = checkGoalAgainstState(
      { increased: ['employeeCount'] },
      { employeeCount: 1 },
      { employeeCount: 1 },
    );
    expect(violation).toContain('employeeCount');
    expect(violation).toContain('1 → 1');
  });

  it('fails when the field went down', () => {
    const violation = checkGoalAgainstState(
      { increased: ['cash'] },
      { cash: 100 },
      { cash: 50 },
    );
    expect(violation).toContain('cash');
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { increased: ['newField'] },
      {},
      { newField: 5 },
    );
    expect(violation).toBeNull();
  });
});

describe('checkGoalAgainstState — changedBy', () => {
  it('passes when the field moved by exactly the given amount', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 49000 },
    );
    expect(violation).toBeNull();
  });

  it('fails naming the field, expected delta, actual delta, and the was → now values', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 49500 },
    );
    expect(violation).toContain('cash');
    expect(violation).toContain('-1000');
    expect(violation).toContain('-500');
    expect(violation).toContain('50000 → 49500');
  });

  it('handles a negative delta (a decrease) as the expected value', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { nuisance: -30 } },
      { nuisance: 80 },
      { nuisance: 50 },
    );
    expect(violation).toBeNull();
  });

  it('handles a positive delta on a field that grew', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { holeCount: 3 } },
      { holeCount: 2 },
      { holeCount: 5 },
    );
    expect(violation).toBeNull();
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { newField: 5 } },
      {},
      { newField: 5 },
    );
    expect(violation).toBeNull();
  });

  it('fails when the after state is null (step produced no state dump)', () => {
    const violation = checkGoalAgainstState({ changedBy: { cash: -1000 } }, { cash: 50000 }, null);
    expect(violation).toContain('cash');
  });

  it('fails when the field did not move at all', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 50000 },
    );
    expect(violation).toContain('changed by 0');
  });
});

describe('checkGoalAgainstState — decreased', () => {
  it('passes when the field shrank', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'] },
      { nuisance: 50 },
      { nuisance: 20 },
    );
    expect(violation).toBeNull();
  });

  it('fails when the field stayed flat', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'] },
      { nuisance: 50 },
      { nuisance: 50 },
    );
    expect(violation).toContain('nuisance');
    expect(violation).toContain('50 → 50');
  });

  it('fails when the field went up', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['ecology'] },
      { ecology: 20 },
      { ecology: 40 },
    );
    expect(violation).toContain('ecology');
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['newField'] },
      { newField: 5 },
      {},
    );
    expect(violation).toBeNull();
  });
});

describe('checkGoalAgainstState — combined and empty goals', () => {
  it('checks increased before equals, reporting the first violation found', () => {
    const violation = checkGoalAgainstState(
      { increased: ['cash'], equals: { buildingCount: 1 } },
      { cash: 100 },
      { cash: 100, buildingCount: 1 },
    );
    expect(violation).toContain('cash');
  });

  it('checks decreased before equals, reporting the first violation found', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'], equals: { buildingCount: 1 } },
      { nuisance: 50 },
      { nuisance: 50, buildingCount: 1 },
    );
    expect(violation).toContain('nuisance');
  });

  it('a goal with only usable/blocked/tutorialStep/note (no equals or increased) passes trivially in command mode', () => {
    const violation = checkGoalAgainstState(
      { usable: '#bs-survey-run', note: 'checked only in interaction mode' },
      {},
      {},
    );
    expect(violation).toBeNull();
  });
});
