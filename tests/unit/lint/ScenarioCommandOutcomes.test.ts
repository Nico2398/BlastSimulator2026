// BlastSimulator2026 — every scenario step declares its command outcome (issue #585)
//
// `commandOutcome` (scripts/shared/scenario-types.ts) exists so a step can
// say "this refusal IS the point" (`'refused'`) or "either outcome is fine,
// this beat is genuinely nondeterministic" (`'either'`). A step whose command
// the console actually refuses without declaring either is undeclared drift:
// the scenario is quietly relying on runSteps discarding CommandResult's own
// `success` flag — the bug issue #585 fixes.
//
// This replays every scenario file's command sequence via the same
// primitives runSteps (scripts/shared/command-runner.ts) itself is built
// from — createGameEngine + runCommand — rather than through runSteps
// directly. runSteps's own commandOutcome check (checkCommandOutcome in
// scripts/shared/scenario-goal.ts) is fully wired and not a stub — but this
// lint still bypasses it deliberately, because its job is narrower than
// runSteps's own per-step check: it needs each step's raw
// CommandResult.success to isolate an undeclared refusal from every other
// failure class (a thrown exception, an unrelated `expect` violation), and
// StepResult only exposes a single folded `error` string that conflates a
// commandOutcome violation with an expect violation. Driving runCommand
// here directly keeps this lint's own diagnosis independent of whatever
// else runSteps also happens to check.
//
// Any per-step scratch state this lint captures for diagnosis is written to
// an os.tmpdir() throwaway directory — never into screenshots/ or any other
// committed directory.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { scenarioFiles, loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { createGameEngine, runWaitUntil, findWaitUntilAction } from '../../../scripts/shared/command-runner.js';
import { runCommand } from '../../../src/console/createRunner.js';
import { serializeGameState } from '../../../src/console-api.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const ALL_SCENARIO_NAMES = scenarioFiles(SCENARIO_DIR);

interface UndeclaredRefusal {
  stepIndex: number;
  command: string;
  output: string;
}

/**
 * Replays one scenario file's command sequence against a fresh engine and
 * returns every step whose command was refused (CommandResult.success ===
 * false) without the step declaring commandOutcome. A step whose command
 * genuinely *throws* is a different failure class (a real bug, not a
 * refusal) and is skipped here — mirroring the try/catch boundary
 * runSteps itself draws between a thrown exception and a success:false
 * result.
 */
function findUndeclaredRefusals(name: string, scratchDir: string): UndeclaredRefusal[] {
  const scenario = loadScenarioDef(name, SCENARIO_DIR);
  const engine = createGameEngine();
  const violations: UndeclaredRefusal[] = [];

  scenario.steps.forEach((rawStep, i) => {
    const step = rawStep as ScenarioStepDef;
    const waitUntilAction = findWaitUntilAction(step);
    let result: { success: boolean; output: string };
    try {
      result = waitUntilAction
        ? { success: true, output: runWaitUntil(engine, waitUntilAction).output }
        : runCommand(engine, step.command);
    } catch {
      return;
    }
    if (waitUntilAction) return; // no refusal concept for a wait — it completed or threw above

    // Scratch dump for diagnosis — throwaway tmp location only.
    writeFileSync(
      resolve(scratchDir, `step-${String(i).padStart(3, '0')}.json`),
      JSON.stringify({
        step: i,
        command: step.command,
        success: result.success,
        commandOutput: result.output,
        gameState: serializeGameState(engine.ctx),
      }),
    );

    if (step.commandOutcome !== undefined) return; // already declared — not this lint's concern
    if (!result.success) {
      violations.push({ stepIndex: i, command: step.command, output: result.output });
    }
  });

  return violations;
}

function formatViolations(name: string, violations: UndeclaredRefusal[]): string {
  return violations
    .map(v => `  ${name}.json step[${v.stepIndex}] ("${v.command}") refused: ${v.output}`)
    .join('\n');
}

describe('repo-wide — every scenario step declares its command outcome (issue #585)', () => {
  it('sanity: the scenario directory is non-empty (guards against a silently broken glob)', () => {
    expect(ALL_SCENARIO_NAMES.length).toBeGreaterThan(0);
  });

  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — no step's command is refused without declaring commandOutcome`, () => {
      const scratchDir = mkdtempSync(resolve(tmpdir(), 'bs2026-scenario-command-outcomes-'));
      const violations = findUndeclaredRefusals(name, scratchDir);
      expect(
        violations,
        `${violations.length} undeclared refusal(s) in ${name}.json:\n${formatViolations(name, violations)}`,
      ).toEqual([]);
    });
  }
});
