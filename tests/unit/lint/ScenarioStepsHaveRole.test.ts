// BlastSimulator2026 — every scenario step carries a role (issue #515)
//
// Issue #479 introduced `role: 'player' | 'setup' | 'observe'` as a
// convention a step could opt into; issue #515 turns it into a structural
// lint every scenario step must satisfy, closing the "no role — legacy,
// unconstrained" escape hatch documented in .claude/rules/scenario-defs.md.
// `ScenarioStepRole` (scripts/shared/scenario-types.ts) was widened to
// `'player' | 'setup' | 'observe' | 'bootstrap' | 'guard'` for this: a step
// with no UI equivalent and no business having one is `bootstrap` (checked
// against `BOOTSTRAP_COMMAND_ALLOWLIST`), and a step proving a control is
// unreachable is `guard` (checked against `expect.blocked`).
//
// This suite names the end state issue #515 requires and stays in the tree
// permanently: every scenario step in scripts/scenario-defs/*.json now
// carries a role, every `guard`-role step proves its control is disabled via
// `expect.blocked`, and every `bootstrap`-role step's command is on the
// audited `BOOTSTRAP_COMMAND_ALLOWLIST`.

import { describe, it, expect } from 'vitest';
import { scenarioFiles, SCENARIO_DIR, collectScenarioViolations, formatScenarioViolations } from '../../../scripts/shared/scenario-utils.js';
import { isAllowedBootstrapCommand } from '../../../scripts/shared/interaction-executor.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

describe('repo-wide — every scenario step has a role (issue #515)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('every scenario step has a role', () => {
    const violations = collectScenarioViolations((step) => step.role === undefined, ALL_SCENARIO_NAMES);
    expect(
      violations,
      `${violations.length} scenario step(s) missing role:\n${formatScenarioViolations(violations)}`,
    ).toEqual([]);
  });

  it('every guard-role step proves a control is disabled', () => {
    const violations = collectScenarioViolations(
      (step) => step.role === 'guard' && step.expect?.blocked === undefined,
      ALL_SCENARIO_NAMES,
    );
    expect(
      violations,
      `${violations.length} guard-role step(s) with no expect.blocked:\n${formatScenarioViolations(violations)}`,
    ).toEqual([]);
  });

  it("every bootstrap-role step's command is on the audited allowlist", () => {
    // Sanity call: no scenario-defs file has role:'bootstrap' yet (retagging
    // is @implementer's job), so the JSON-driven scan below would otherwise
    // pass vacuously — zero matches — until that lands, silently hiding the
    // still-unimplemented isAllowedBootstrapCommand. Call it directly first,
    // against one of the plan's own audited entries, so this test is red for
    // the real reason (the stub throws) rather than green on missing data.
    expect(
      () => isAllowedBootstrapCommand('employee assign_skill 1 skill:geology level:3'),
    ).not.toThrow();

    const violations = collectScenarioViolations(
      (step) => step.role === 'bootstrap' && !isAllowedBootstrapCommand(step.command),
      ALL_SCENARIO_NAMES,
    );
    expect(
      violations,
      `${violations.length} bootstrap-role step(s) with a command outside `
      + `BOOTSTRAP_COMMAND_ALLOWLIST:\n${formatScenarioViolations(violations)}`,
    ).toEqual([]);
  });
});
