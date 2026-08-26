// BlastSimulator2026 — every state-dependent scenario goal has a real
// interaction (issue #738)
//
// `executeInteractionActions` (scripts/shared/puppeteer-utils.ts) treats a
// missing/empty `interaction` array as a total no-op — it does NOT fall back
// to running the step's raw `command` string in-browser. A `role: 'player'`
// step whose `expect` asserts state (`equals`/`increased`/`decreased`/
// `changedBy`) but carries no `interaction` array therefore asserts against
// stale, unchanged page state in interaction mode.
//
// This suite is the structural lint closing that gap: same shape as
// `tests/unit/lint/ScenarioStepsHaveRole.test.ts` — walk every scenario file's
// every step, flag any step whose `expect` contains a state-dependent goal but
// has no non-empty `interaction` array.
//
// Two exclusions, confirmed against interaction-executor.ts/interaction-driver.ts:
//  - `guard`-role steps prove a control unreachable via `expect.blocked`, which
//    checkGoal reads through a live-DOM probe (`requireUsable`/its blocked
//    counterpart), not the stale-state fallback `equals`/`increased`/
//    `decreased`/`changedBy` go through — so a guard step legitimately carries
//    no click-driven `interaction` array and is never flagged here.
//  - An `expect` containing only `usable`/`blocked`/`tutorialStep`/`note` (none
//    of the four state-dependent keys) is not flagged either — those need a
//    live page and go through the same DOM-probe path checkGoal uses for
//    `blocked` above, not the stale-state read.
// A step whose `interaction` array's only action is `{ type: 'command', ... }`
// (a bootstrap/observe/setup step driving the console instead of a click)
// counts as HAVING an interaction array — only a missing or empty array is a
// violation, regardless of what the array's actions are.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef, ScenarioStepGoal } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

const ALL_SCENARIO_NAMES: string[] = scenarioFiles(SCENARIO_DIR);

interface InteractionViolation {
  file: string;
  stepIndex: number;
  command: string;
}

function formatViolations(violations: InteractionViolation[]): string {
  return violations
    .map((v) => `  ${v.file}.json step[${v.stepIndex}] ("${v.command}")`)
    .join('\n');
}

/** True when `expect` asserts a state-dependent goal `checkGoal`'s stale-state fallback checks. */
function hasStateDependentGoal(goal: ScenarioStepGoal | undefined): boolean {
  if (goal === undefined) return false;
  return (
    goal.equals !== undefined
    || goal.increased !== undefined
    || goal.decreased !== undefined
    || goal.changedBy !== undefined
  );
}

// Shared enumeration: walk every scenario file's every step, collecting the
// ones for which `isViolation` returns true — same shape as
// ScenarioStepsHaveRole.test.ts's collectViolations.
function collectViolations(
  isViolation: (step: ScenarioStepDef) => boolean,
): InteractionViolation[] {
  const violations: InteractionViolation[] = [];
  for (const file of ALL_SCENARIO_NAMES) {
    const scenario = loadScenarioDef(file, SCENARIO_DIR);
    scenario.steps.forEach((rawStep, stepIndex) => {
      const step = rawStep as ScenarioStepDef;
      if (isViolation(step)) {
        violations.push({ file, stepIndex, command: step.command });
      }
    });
  }
  return violations;
}

describe('repo-wide — every state-dependent scenario goal has an interaction (issue #738)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it(
    'every step whose expect has equals/increased/decreased/changedBy has a non-empty interaction array',
    () => {
      const violations = collectViolations((step) => {
        if (step.role === 'guard') return false;
        if (!hasStateDependentGoal(step.expect)) return false;
        return step.interaction === undefined || step.interaction.length === 0;
      });
      expect(
        violations,
        `${violations.length} scenario step(s) assert state-dependent goals `
        + `(equals/increased/decreased/changedBy) with no interaction array — `
        + `executeInteractionActions (scripts/shared/puppeteer-utils.ts) silently `
        + `no-ops a step with no interaction, so checkGoal then asserts against `
        + `stale/live state instead of state these actions actually produced:\n`
        + `${formatViolations(violations)}`,
      ).toEqual([]);
    },
  );
});
