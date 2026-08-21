// BlastSimulator2026 — Scenario goal checking (state half, command mode)
//
// checkGoalAgainstState is the command-mode half of a step's `expect`: no
// DOM, so only `equals`/`increased` are checkable — the interaction-mode
// half (`usable`/`blocked`/`tutorialStep`) is interaction-driver.ts's checkGoal,
// exercised in tests/unit/scenario-interaction.test.ts instead. Both modes
// check the fields they can; neither is a no-op channel.

import { describe, it, expect } from 'vitest';
import { checkGoalAgainstState, checkCommandOutcome } from '../../scripts/shared/scenario-goal.js';

describe('checkGoalAgainstState — equals', () => {
  it('passes when every field matches exactly', () => {
    const violation = checkGoalAgainstState(
      { equals: { cash: 70000, buildingCount: 1 } },
      {},
      { cash: 70000, buildingCount: 1 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('fails naming the field, expected value, and actual value', () => {
    const violation = checkGoalAgainstState(
      { equals: { cash: 70000 } },
      {},
      { cash: 80000 },
    ).violation;
    expect(violation).toContain('cash');
    expect(violation).toContain('70000');
    expect(violation).toContain('80000');
  });

  it('fails when the after state is null (step produced no state dump)', () => {
    const violation = checkGoalAgainstState({ equals: { cash: 70000 } }, {}, null).violation;
    expect(violation).toContain('cash');
  });

  it('distinguishes missing field from a genuine mismatch — undefined does not satisfy "equals 0"', () => {
    const violation = checkGoalAgainstState({ equals: { holeCount: 0 } }, {}, {}).violation;
    expect(violation).toContain('holeCount');
  });
});

describe('checkGoalAgainstState — increased', () => {
  it('passes when the field grew', () => {
    const violation = checkGoalAgainstState(
      { increased: ['employeeCount'] },
      { employeeCount: 0 },
      { employeeCount: 1 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('fails when the field stayed flat', () => {
    const violation = checkGoalAgainstState(
      { increased: ['employeeCount'] },
      { employeeCount: 1 },
      { employeeCount: 1 },
    ).violation;
    expect(violation).toContain('employeeCount');
    expect(violation).toContain('1 → 1');
  });

  it('fails when the field went down', () => {
    const violation = checkGoalAgainstState(
      { increased: ['cash'] },
      { cash: 100 },
      { cash: 50 },
    ).violation;
    expect(violation).toContain('cash');
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { increased: ['newField'] },
      {},
      { newField: 5 },
    ).violation;
    expect(violation).toBeNull();
  });
});

describe('checkGoalAgainstState — changedBy', () => {
  it('passes when the field moved by exactly the given amount', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 49000 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('fails naming the field, expected delta, actual delta, and the was → now values', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 49500 },
    ).violation;
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
    ).violation;
    expect(violation).toBeNull();
  });

  it('handles a positive delta on a field that grew', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { holeCount: 3 } },
      { holeCount: 2 },
      { holeCount: 5 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { newField: 5 } },
      {},
      { newField: 5 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('fails when the after state is null (step produced no state dump)', () => {
    const violation = checkGoalAgainstState({ changedBy: { cash: -1000 } }, { cash: 50000 }, null).violation;
    expect(violation).toContain('cash');
  });

  it('fails when the field did not move at all', () => {
    const violation = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 50000 },
    ).violation;
    expect(violation).toContain('changed by 0');
  });
});

describe('checkGoalAgainstState — decreased', () => {
  it('passes when the field shrank', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'] },
      { nuisance: 50 },
      { nuisance: 20 },
    ).violation;
    expect(violation).toBeNull();
  });

  it('fails when the field stayed flat', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'] },
      { nuisance: 50 },
      { nuisance: 50 },
    ).violation;
    expect(violation).toContain('nuisance');
    expect(violation).toContain('50 → 50');
  });

  it('fails when the field went up', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['ecology'] },
      { ecology: 20 },
      { ecology: 40 },
    ).violation;
    expect(violation).toContain('ecology');
  });

  it('treats a missing/non-numeric before or after field as 0, not a crash', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['newField'] },
      { newField: 5 },
      {},
    ).violation;
    expect(violation).toBeNull();
  });
});

describe('checkGoalAgainstState — combined and empty goals', () => {
  it('checks increased before equals, reporting the first violation found', () => {
    const violation = checkGoalAgainstState(
      { increased: ['cash'], equals: { buildingCount: 1 } },
      { cash: 100 },
      { cash: 100, buildingCount: 1 },
    ).violation;
    expect(violation).toContain('cash');
  });

  it('checks decreased before equals, reporting the first violation found', () => {
    const violation = checkGoalAgainstState(
      { decreased: ['nuisance'], equals: { buildingCount: 1 } },
      { nuisance: 50 },
      { nuisance: 50, buildingCount: 1 },
    ).violation;
    expect(violation).toContain('nuisance');
  });

  it('a goal with only usable/blocked/tutorialStep/note (no equals or increased) passes trivially in command mode', () => {
    const violation = checkGoalAgainstState(
      { usable: '#bs-survey-run', note: 'checked only in interaction mode' },
      {},
      {},
    ).violation;
    expect(violation).toBeNull();
  });
});

// ──────────────────────────────────────────────
// checkGoalAgainstState — drift-report fields (issue #679): `.mismatches`
// and `.onlyDriftViolations`, exhaustive over equals/changedBy failures and
// never populated by increased/decreased failures.
// ──────────────────────────────────────────────
describe('checkGoalAgainstState — mismatches (drift report, issue #679)', () => {
  it('records one GoalMismatch for a mismatched equals goal, with the real post-state value as actual', () => {
    const result = checkGoalAgainstState(
      { equals: { cash: 70000 } },
      {},
      { cash: 80000 },
    );
    expect(result.mismatches).toEqual([
      { field: 'cash', goalType: 'equals', expected: 70000, actual: 80000 },
    ]);
  });

  it('records one GoalMismatch for a mismatched changedBy goal, with the observed delta as actual (not the absolute value)', () => {
    const result = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 49500 },
    );
    expect(result.mismatches).toEqual([
      { field: 'cash', goalType: 'changedBy', expected: -1000, actual: -500 },
    ]);
  });

  it('is exhaustive: an equals goal with 3+ fields records every mismatching field, not just the first', () => {
    const result = checkGoalAgainstState(
      { equals: { cash: 70000, buildingCount: 1, employeeCount: 2 } },
      {},
      { cash: 80000, buildingCount: 1, employeeCount: 5 },
    );
    expect(result.mismatches).toHaveLength(2);
    const fields = result.mismatches.map(m => m.field).sort();
    expect(fields).toEqual(['cash', 'employeeCount']);
    expect(result.mismatches).toContainEqual({ field: 'cash', goalType: 'equals', expected: 70000, actual: 80000 });
    expect(result.mismatches).toContainEqual({ field: 'employeeCount', goalType: 'equals', expected: 2, actual: 5 });
  });

  it('never records a mismatch for a failed increased/decreased goal — mismatches stays empty', () => {
    const result = checkGoalAgainstState(
      { increased: ['employeeCount'] },
      { employeeCount: 1 },
      { employeeCount: 1 },
    );
    expect(result.violation).not.toBeNull();
    expect(result.mismatches).toEqual([]);
  });

  it('onlyDriftViolations is true when the only failure is equals/changedBy', () => {
    const result = checkGoalAgainstState(
      { equals: { cash: 70000 } },
      {},
      { cash: 80000 },
    );
    expect(result.violation).not.toBeNull();
    expect(result.onlyDriftViolations).toBe(true);
  });

  it('onlyDriftViolations is false when a directional goal also fails alongside an equals/changedBy mismatch', () => {
    const result = checkGoalAgainstState(
      { increased: ['employeeCount'], equals: { cash: 70000 } },
      { employeeCount: 1, cash: 0 },
      { employeeCount: 1, cash: 80000 },
    );
    expect(result.violation).not.toBeNull();
    expect(result.onlyDriftViolations).toBe(false);
  });

  it('when nothing fails, violation is null (onlyDriftViolations is meaningless there, but must not be truthy)', () => {
    const result = checkGoalAgainstState(
      { increased: ['cash'], equals: { buildingCount: 1 } },
      { cash: 100 },
      { cash: 200, buildingCount: 1 },
    );
    expect(result.violation).toBeNull();
    expect(result.onlyDriftViolations).toBeFalsy();
  });

  it('violation text and check ordering (increased → decreased → equals → changedBy) is unchanged from before drift-report support', () => {
    // increased wins over a simultaneously-failing equals
    const increasedFirst = checkGoalAgainstState(
      { increased: ['cash'], equals: { buildingCount: 2 } },
      { cash: 100 },
      { cash: 100, buildingCount: 1 },
    );
    expect(increasedFirst.violation).toContain('cash');

    // decreased wins over equals
    const decreasedFirst = checkGoalAgainstState(
      { decreased: ['nuisance'], equals: { buildingCount: 2 } },
      { nuisance: 50 },
      { nuisance: 50, buildingCount: 1 },
    );
    expect(decreasedFirst.violation).toContain('nuisance');

    // equals wins over changedBy
    const equalsFirst = checkGoalAgainstState(
      { equals: { buildingCount: 2 }, changedBy: { cash: -1000 } },
      { cash: 50000, buildingCount: 1 },
      { cash: 50000, buildingCount: 1 },
    );
    expect(equalsFirst.violation).toContain('buildingCount');

    // changedBy fires last, alone
    const changedByOnly = checkGoalAgainstState(
      { changedBy: { cash: -1000 } },
      { cash: 50000 },
      { cash: 50000 },
    );
    expect(changedByOnly.violation).toContain('changed by 0');
  });
});

// ──────────────────────────────────────────────
// checkCommandOutcome (issue #585) — judges a step's commandOutcome
// declaration against the console's own CommandResult, independent of the
// state-based expect checks above.
//
//   - undefined (default) — the command must succeed; success:false violates.
//   - 'refused'            — the command must fail; success:true violates
//     (the "guard stopped guarding" case — a step that used to prove a
//     refusal and silently started succeeding must itself start failing).
//   - 'either'              — always null, no matter which way it went.
// ──────────────────────────────────────────────
describe('checkCommandOutcome — undefined (default): the command must succeed', () => {
  it('passes when the command succeeded', () => {
    const violation = checkCommandOutcome(undefined, { success: true, output: 'OK' }, 'new_game seed:42');
    expect(violation).toBeNull();
  });

  it('fails, naming the command and the console\'s own refusal text, when the command was refused', () => {
    const violation = checkCommandOutcome(
      undefined,
      { success: false, output: 'Unknown command: "foo". Type "help" for available commands.' },
      'foo',
    );
    expect(violation).not.toBeNull();
    expect(violation).toContain('foo');
    expect(violation).toContain('Unknown command: "foo". Type "help" for available commands.');
  });
});

describe("checkCommandOutcome — 'refused': refusal is the expected outcome", () => {
  it('passes when the command was refused', () => {
    const violation = checkCommandOutcome(
      'refused',
      { success: false, output: 'No game loaded. Use new_game first.' },
      'employee list',
    );
    expect(violation).toBeNull();
  });

  it('fails, naming the command, when the command unexpectedly succeeded', () => {
    const violation = checkCommandOutcome(
      'refused',
      { success: true, output: 'Hired driller #1.' },
      'employee hire role:driller',
    );
    expect(violation).not.toBeNull();
    expect(violation).toContain('employee hire role:driller');
  });
});

describe("checkCommandOutcome — 'either': no check, always null", () => {
  it('passes when the command succeeded', () => {
    expect(checkCommandOutcome('either', { success: true, output: 'Choice applied.' }, 'event choose 0')).toBeNull();
  });

  it('passes when the command was refused', () => {
    expect(
      checkCommandOutcome('either', { success: false, output: 'No pending event or invalid option.' }, 'event choose 0'),
    ).toBeNull();
  });
});
