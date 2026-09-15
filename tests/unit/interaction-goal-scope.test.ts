// BlastSimulator2026 — which half of `expect` interaction mode owns
//
// `scopeGoalToInteraction` (scripts/shared/interaction-goal-scope.ts) may only
// ever NARROW what the browser channel asserts, and only for the fields
// TRAJECTORY_COUPLED_GOAL_FIELDS names. Command mode reads `step.expect`
// unscoped, so anything scoped out here is still proven on every pull request
// — these tests pin that this stays a reachability/magnitude split and never
// becomes a way to silence a goal outright.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepGoal } from '../../scripts/shared/scenario-types.js';
import {
  scopeGoalToInteraction,
  goalAssertsAnything,
  TRAJECTORY_COUPLED_GOAL_FIELDS,
} from '../../scripts/shared/interaction-goal-scope.js';

describe('scopeGoalToInteraction', () => {
  it('leaves a goal untouched when it names no trajectory-coupled field', () => {
    const goal: ScenarioStepGoal = {
      equals: { holeCount: 6, orderedHoleCount: 0 },
      increased: ['orderedChargeCount'],
      changedBy: { employeeCount: 1 },
    };
    const { scoped, deferred } = scopeGoalToInteraction(goal);
    expect(deferred).toEqual([]);
    // Same object identity: nothing to scope means nothing to rebuild.
    expect(scoped).toBe(goal);
  });

  it('leaves an absolute tickCount to command mode', () => {
    const { scoped, deferred } = scopeGoalToInteraction({
      equals: { tickCount: 130, holeCount: 6 },
    });
    expect(scoped.equals).toEqual({ holeCount: 6 });
    expect(deferred).toHaveLength(1);
    expect(deferred[0]!.field).toBe('tickCount');
    expect(deferred[0]!.goalType).toBe('equals');
    expect(deferred[0]!.reason).toMatch(/clock/i);
  });

  it('leaves a per-step tick budget to command mode too', () => {
    // Interaction mode is entitled to spend more ticks on the same beat — a
    // retry round, an event resolution its `command` string has no equivalent
    // for. Pinning the budget is command mode's job.
    const { scoped, deferred } = scopeGoalToInteraction({
      changedBy: { tickCount: 6, cash: -1000 },
    });
    expect(scoped.changedBy).toEqual({ cash: -1000 });
    expect(deferred.map(d => d.field)).toEqual(['tickCount']);
  });

  it('leaves a chained absolute cash balance to command mode', () => {
    const { scoped, deferred } = scopeGoalToInteraction({
      equals: { cash: 48500, employeeCount: 4 },
    });
    expect(scoped.equals).toEqual({ employeeCount: 4 });
    expect(deferred.map(d => d.field)).toEqual(['cash']);
  });

  it('keeps a step-local cash delta checked in both modes', () => {
    // `changedBy: {cash: -1000}` states what THIS step cost, not what every
    // step before it left the balance at — the form the authoring rule asks
    // for, and insensitive to a diverged event draw upstream.
    const goal: ScenarioStepGoal = { changedBy: { cash: -1000 } };
    const { scoped, deferred } = scopeGoalToInteraction(goal);
    expect(deferred).toEqual([]);
    expect(scoped.changedBy).toEqual({ cash: -1000 });
  });

  it('never scopes out a direction, on any field', () => {
    // A direction survives a diverged trajectory and fails exactly when the
    // step stops moving the field it is testing.
    const goal: ScenarioStepGoal = { increased: ['tickCount', 'cash'], decreased: ['cash'] };
    const { scoped, deferred } = scopeGoalToInteraction(goal);
    expect(deferred).toEqual([]);
    expect(scoped.increased).toEqual(['tickCount', 'cash']);
    expect(scoped.decreased).toEqual(['cash']);
  });

  it('never scopes out atMost — it is not in TRAJECTORY_COUPLED_GOAL_FIELDS, so it passes through unscoped (issue #1083)', () => {
    const goal: ScenarioStepGoal = { atMost: { vehicleBoardingCount: 2 } };
    const { scoped, deferred } = scopeGoalToInteraction(goal);
    expect(deferred).toEqual([]);
    expect(scoped.atMost).toEqual({ vehicleBoardingCount: 2 });
    // Same object identity: nothing to scope means nothing to rebuild.
    expect(scoped).toBe(goal);
  });

  it('never scopes out a DOM or tutorial goal — those are the reachability claim', () => {
    const goal: ScenarioStepGoal = {
      equals: { tickCount: 40 },
      usable: '[data-action="fire"]',
      blocked: '[data-action="run-analysis"]',
      tutorialStep: 'drill-holes',
    };
    const { scoped } = scopeGoalToInteraction(goal);
    expect(scoped.usable).toBe('[data-action="fire"]');
    expect(scoped.blocked).toBe('[data-action="run-analysis"]');
    expect(scoped.tutorialStep).toBe('drill-holes');
  });

  it('drops the record entirely when nothing in it survives', () => {
    // So checkGoal's own `if (goal.increased || goal.equals || ...)` guard
    // still skips the state fetch for a step left with no state goal.
    const { scoped } = scopeGoalToInteraction({ equals: { tickCount: 40 }, note: 'clock only' });
    expect(scoped.equals).toBeUndefined();
    expect('equals' in scoped).toBe(false);
    expect(scoped.note).toBe('clock only');
  });

  it('does not mutate the goal it was given', () => {
    // Command mode reads the same object from the same loaded definition.
    const goal: ScenarioStepGoal = { equals: { tickCount: 130, holeCount: 6 } };
    scopeGoalToInteraction(goal);
    expect(goal.equals).toEqual({ tickCount: 130, holeCount: 6 });
  });

  it('reports every deferred goal, not just the first', () => {
    const { deferred } = scopeGoalToInteraction({
      equals: { tickCount: 130, cash: 48500 },
      changedBy: { tickCount: 6 },
    });
    expect(deferred).toHaveLength(3);
    for (const d of deferred) expect(d.reason.length).toBeGreaterThan(0);
  });
});

describe('TRAJECTORY_COUPLED_GOAL_FIELDS', () => {
  it('stays a short, individually-reasoned list', () => {
    // An entry here removes a real assertion from the browser channel. Growth
    // is the drift this module exists to stop: a shard red on any other field
    // is a finding, not an entry. Raising this bound is a deliberate act.
    expect(Object.keys(TRAJECTORY_COUPLED_GOAL_FIELDS).length).toBeLessThanOrEqual(4);
  });

  it('gives every entry a non-empty reason and at least one goal kind', () => {
    for (const [field, rule] of Object.entries(TRAJECTORY_COUPLED_GOAL_FIELDS)) {
      expect(rule.kinds.length, `${field} scopes no goal kind`).toBeGreaterThan(0);
      expect(rule.reason.length, `${field} has no reason`).toBeGreaterThan(20);
      for (const kind of rule.kinds) expect(['equals', 'changedBy']).toContain(kind);
    }
  });
});

describe('goalAssertsAnything', () => {
  it('is false for a goal carrying only a note', () => {
    expect(goalAssertsAnything({ note: 'nothing to assert here' })).toBe(false);
    expect(goalAssertsAnything({})).toBe(false);
  });

  it('is true for each assertion field on its own', () => {
    const cases: ScenarioStepGoal[] = [
      { increased: ['cash'] },
      { decreased: ['cash'] },
      { equals: { holeCount: 1 } },
      { changedBy: { cash: -1 } },
      { atMost: { vehicleBoardingCount: 2 } },
      { usable: '#x' },
      { blocked: '#x' },
      { tutorialStep: 'a' },
    ];
    for (const goal of cases) expect(goalAssertsAnything(goal), JSON.stringify(goal)).toBe(true);
  });
});
