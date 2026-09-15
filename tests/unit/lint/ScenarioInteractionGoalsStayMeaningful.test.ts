// BlastSimulator2026 — narrowing interaction mode's `expect` must not empty it
//
// Interaction mode no longer re-asserts trajectory-coupled goals; command
// mode owns them (`scripts/shared/interaction-goal-scope.ts`). That split is
// only sound while it stays a *narrowing of a duplicate*, not a deletion:
//
//   1. Command mode must still assert every scoped goal. It reads
//      `step.expect` unscoped, so this is structural — pinned below against
//      the real evaluator rather than asserted in prose, because the day
//      someone scopes `checkGoalAgainstState` too, 703 assertions leave the
//      suite in one commit and nothing goes red.
//
//   2. A step whose whole `expect` is trajectory-coupled asserts nothing in
//      interaction mode beyond "the clicks landed". That is a legitimate
//      resting state — the clicks landing IS the reachability proof — but it
//      is the state that stops being a *goal*, so the population is bounded
//      here. A new scenario leaning entirely on the clock for its browser
//      claim should say what it means in DOM terms (`usable`, `blocked`,
//      `textEquals`) or in a step-local `changedBy`, not raise this bound.
//
// Measured at 39/2366 steps (1.6%) when the split landed.

import { describe, it, expect } from 'vitest';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR, formatScenarioViolations, type ScenarioViolation } from '../../../scripts/shared/scenario-utils.js';
import { scopeGoalToInteraction, goalAssertsAnything } from '../../../scripts/shared/interaction-goal-scope.js';
import { checkGoalAgainstState } from '../../../scripts/shared/scenario-goal.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/**
 * Headroom over the population measured when the split landed. Deliberately
 * small: this bound exists to catch a drift, and a real increase should be an
 * argued edit to this number rather than a silent pass.
 */
const MAX_STEPS_ASSERTING_NOTHING = 45;

/** A step left with no interaction-mode goal once scoping ran. */
interface EmptiedGoal extends ScenarioViolation {
  /** `equals.tickCount, changedBy.tickCount` — what was left to command mode. */
  deferredGoals: string;
}

describe('repo-wide — scoping interaction goals never removes them from the suite', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('command mode still fails a goal interaction mode leaves to it', () => {
    // The invariant the whole split rests on, exercised against both real
    // evaluators: the same goal that scoping removes from the browser channel
    // must still be a failure in the command channel.
    const goal = { equals: { tickCount: 130, cash: 48500 } };
    const before = { tickCount: 0, cash: 50000 };
    const after = { tickCount: 128, cash: 48000 };

    const { scoped, deferred } = scopeGoalToInteraction(goal);
    expect(deferred.map(d => d.field).sort()).toEqual(['cash', 'tickCount']);
    expect(goalAssertsAnything(scoped)).toBe(false);

    const commandResult = checkGoalAgainstState(goal, before, after);
    expect(commandResult.violation).not.toBeNull();
    expect(commandResult.mismatches.map(m => m.field).sort()).toEqual(['cash', 'tickCount']);
  });

  it('every scoped goal is one command mode evaluates', () => {
    // Nothing may be scoped out of interaction mode that command mode cannot
    // pick up — `checkGoalAgainstState` reads equals/increased/decreased/
    // changedBy and nothing else, so the scoped kinds must live in that set.
    const commandModeKinds = ['equals', 'changedBy'];
    for (const name of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (const rawStep of scenario.steps) {
        const step = rawStep as ScenarioStepDef;
        if (!step.expect) continue;
        for (const d of scopeGoalToInteraction(step.expect).deferred) {
          expect(commandModeKinds, `${name}: ${d.goalType} is not a command-mode goal kind`)
            .toContain(d.goalType);
        }
      }
    }
  });

  it('few steps are left asserting nothing at all in interaction mode', () => {
    const violations: EmptiedGoal[] = [];

    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        if (!step.expect) return;
        const { scoped, deferred } = scopeGoalToInteraction(step.expect);
        if (deferred.length === 0) return;
        if (goalAssertsAnything(scoped)) return;
        violations.push({
          file,
          stepIndex,
          command: step.command,
          deferredGoals: deferred.map(d => `${d.goalType}.${d.field}`).join(', '),
        });
      });
    }

    expect(
      violations.length,
      `${violations.length} steps assert nothing in interaction mode once scoped, over the `
      + `${MAX_STEPS_ASSERTING_NOTHING} this lint allows. State the browser claim in DOM terms `
      + `(usable/blocked/textEquals) or as a step-local changedBy rather than raising the bound.\n`
      + formatScenarioViolations(
        violations.slice(0, 15),
        v => ` — whole expect is trajectory-coupled (${v.deferredGoals})`,
      ),
    ).toBeLessThanOrEqual(MAX_STEPS_ASSERTING_NOTHING);
  });
});
