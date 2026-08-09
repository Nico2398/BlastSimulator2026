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
// This suite is NOT conditional on today's retagging state — it names the
// end state issue #515 requires and stays in the tree once reached. Written
// during the RED (test-writer) phase against ~280 untagged steps across ~68
// scenario-defs files, so every `it` below is expected to fail today:
//   - "every scenario step has a role" — most steps have no `role` at all.
//   - "every guard-role step proves a control is disabled" — vacuously
//     passes today (no step is tagged `guard` yet) but is the permanent
//     proof once retagging lands.
//   - "every bootstrap-role step's command is on the audited allowlist" —
//     `isAllowedBootstrapCommand` (scripts/shared/interaction-executor.ts)
//     is still a `throw new Error('not implemented')` stub, so this `it`
//     errors out rather than merely failing an assertion — an acceptable RED
//     state per the test-writer brief, not something to work around here.
//
// @implementer's job is the retagging (scripts/scenario-defs/*.json) and
// filling in isAllowedBootstrapCommand/BOOTSTRAP_COMMAND_ALLOWLIST
// (scripts/shared/interaction-executor.ts) — not this test file.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { isAllowedBootstrapCommand } from '../../../scripts/shared/interaction-executor.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

interface RoleViolation {
  file: string;
  stepIndex: number;
  command: string;
}

function formatViolations(violations: RoleViolation[]): string {
  return violations
    .map((v) => `  ${v.file}.json step[${v.stepIndex}] ("${v.command}")`)
    .join('\n');
}

// Shared enumeration: walk every scenario file's every step, collecting the
// ones for which `isViolation` returns true. Each `it` below supplies only
// its own predicate (which is also responsible for skipping steps it does
// not apply to, by returning false) — the file/step traversal and violation
// bookkeeping live here once.
function collectViolations(isViolation: (step: ScenarioStepDef) => boolean): RoleViolation[] {
  const violations: RoleViolation[] = [];
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

describe('repo-wide — every scenario step has a role (issue #515)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('every scenario step has a role', () => {
    const violations = collectViolations((step) => step.role === undefined);
    expect(
      violations,
      `${violations.length} scenario step(s) missing role:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it('every guard-role step proves a control is disabled', () => {
    const violations = collectViolations(
      (step) => step.role === 'guard' && step.expect?.blocked === undefined,
    );
    expect(
      violations,
      `${violations.length} guard-role step(s) with no expect.blocked:\n${formatViolations(violations)}`,
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

    const violations = collectViolations(
      (step) => step.role === 'bootstrap' && !isAllowedBootstrapCommand(step.command),
    );
    expect(
      violations,
      `${violations.length} bootstrap-role step(s) with a command outside `
      + `BOOTSTRAP_COMMAND_ALLOWLIST:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});
