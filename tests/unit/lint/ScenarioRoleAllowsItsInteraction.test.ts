// BlastSimulator2026 — a step's role admits every command its interaction runs
//
// `checkStepActionAllowed` (scripts/shared/interaction-executor.ts) is the one
// rule that decides whether a role-marked step may dispatch a given console
// command: a `player` step may run none, a `setup` step only the bootstrap
// allowlist, an `observe` step only read-only commands, and so on. It runs at
// scenario execution time — which, for a step's `interaction` array, means
// interaction mode only. Command mode never reads step roles, so a violation
// costs a full browser shard to discover.
//
// `tests/unit/scenario-defs-validation/permissions.test.ts` already applies
// the same check ahead of that, but over `ALL_SCENARIO_NAMES` — a hand-kept
// constant in that suite's own `fixtures.ts`. A scenario file added without
// also being added to that list is validated by nothing, which is exactly how
// `building-construction-continuous-policy`'s `setup`-marked
// `set_policy mode:continuous fatigue:90` reached `main`: green on all 140
// command-mode scenarios, then red on interaction shard 9/10 after the merge,
// where no PR-level CI can hand the failure back.
//
// This lint reads the directory instead (`scenarioFiles`, whose own docstring
// already names this requirement), so a new scenario is covered the moment its
// file exists rather than when someone remembers a second list.

import { describe, it, expect } from 'vitest';
import { scenarioFiles, SCENARIO_DIR, loadScenarioDef } from '../../../scripts/shared/scenario-utils.js';
import { checkStepActionAllowed } from '../../../scripts/shared/interaction-executor.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

describe("repo-wide — a step's role admits every command its interaction runs", () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('no role-marked step dispatches a command its role forbids', () => {
    const violations: string[] = [];
    for (const name of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      scenario.steps.forEach((step, index) => {
        if (step.role === undefined) return;
        for (const action of step.interaction ?? []) {
          if (action.type !== 'command') continue;
          const violation = checkStepActionAllowed(step, action);
          if (violation !== null) violations.push(`${name}.json step ${index}: ${violation}`);
        }
      });
    }
    expect(
      violations,
      `${violations.length} scenario step(s) whose role forbids the command they run:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
