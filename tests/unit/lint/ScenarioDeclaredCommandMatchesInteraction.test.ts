// BlastSimulator2026 — a step's declared command is the command interaction
// mode actually runs (issue #674)
//
// `.claude/rules/scenario-defs.md`: "A step's `command` and its `interaction`
// must target the same place. Command mode reads the command, interaction mode
// reads the clicks; when they disagree the two channels silently test
// different things."
//
// The narrowest, mechanically checkable case of that rule is a step whose
// whole interaction array is a single `command` action: there the two modes
// each run exactly one console command, and the only way they can disagree is
// if the two strings differ. level2-playthrough-win.json had eleven such
// steps (issue #674) — a `tick 45` that interaction mode ran as `tick 6`,
// putting every later step of the two modes 39 ticks apart, plus five
// `contract accept`/`contract deliver` pairs where command mode worked
// rubble-disposal contracts and interaction mode ore-sale ones. Nothing
// failed loudly: both modes ran green against their own separate
// trajectories, and the gap only surfaced as a scenario that could not be run
// in interaction mode at all.
//
// This lint names the end state and stays in the tree permanently. It does
// not constrain a step whose interaction array does real UI work — a click
// sequence has no string to compare against — only the degenerate
// one-command-action shape, where a mismatch is never intentional.

import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

/** Trims and collapses internal whitespace so incidental spacing is not a mismatch. */
function normalize(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/**
 * The step's single `command` action, when its interaction array consists of
 * exactly that one action. `null` for every other shape — no array at all, a
 * real click sequence, or a command action alongside other actions (where the
 * step's own command may legitimately describe the whole beat rather than
 * that one action).
 */
function loneCommandAction(step: ScenarioStepDef): string | null {
  const actions = step.interaction;
  if (actions === undefined || actions.length !== 1) return null;
  const only = actions[0]!;
  return only.type === 'command' ? only.command : null;
}

describe('repo-wide — a step\'s declared command is what interaction mode runs (issue #674)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  it('no step whose only interaction action is a command runs a different command than it declares', () => {
    const violations: string[] = [];

    for (const file of ALL_SCENARIO_NAMES) {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      scenario.steps.forEach((rawStep, stepIndex) => {
        const step = rawStep as ScenarioStepDef;
        const actual = loneCommandAction(step);
        if (actual === null) return;
        if (normalize(actual) !== normalize(step.command)) {
          violations.push(
            `  ${file}.json step[${stepIndex}]: declares "${step.command}" but interaction mode runs "${actual}"`,
          );
        }
      });
    }

    expect(
      violations,
      `Scenario steps whose declared command and interaction command disagree — the two\n`
      + `verification channels would run different commands from that step on:\n`
      + `${violations.join('\n')}\n`,
    ).toEqual([]);
  });
});
