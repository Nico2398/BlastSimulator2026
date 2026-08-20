// BlastSimulator2026 — command-mode runSteps honours a step's commandOutcome (issue #585)
//
// Today runSteps (scripts/shared/command-runner.ts) discards CommandResult's
// own `success` flag: a step whose console command is refused (unknown
// command, insufficient prerequisites, etc.) still lands in `results` with no
// `.error`, so the scenario silently "passes" a step that never actually
// happened. This file pins down the fix's contract:
//
//   - no `commandOutcome` (default)  — the command must succeed; a refusal
//     fails the step, naming the command and the console's own refusal text.
//   - commandOutcome: 'refused'      — refusal is the expected outcome; the
//     command *succeeding* is the failure (the "guard stopped guarding" case).
//   - commandOutcome: 'either'       — genuinely nondeterministic; either
//     outcome passes.
//   - a genuinely thrown exception always fails the step with the exception
//     message, regardless of what `commandOutcome` declares — a declaration
//     only reinterprets a `success:false` refusal, never a thrown error.
//
// Proves the wiring, not just the pure function: checkCommandOutcome itself
// (the pure decision) is covered directly in tests/unit/scenario-goal.test.ts;
// this is the "wired into runSteps, against the real game engine" half,
// mirroring tests/integration/scenario-expect.integration.test.ts's split for
// `expect`.
//
// DO NOT implement anything here — only add implementation to src/ or scripts/.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

/** A command no `new_game`/state can ever make succeed — deterministic refusal. */
const REFUSED_CMD = 'zzz_command_585_never_registered';

function outDir(label: string): string {
  return resolve(tmpdir(), `bs2026-command-outcome-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function run(steps: ScenarioStepDef[], label = 'run') {
  const engine = createGameEngine();
  return runSteps(engine, steps, outDir(label));
}

describe('runSteps — no commandOutcome declared (default: command must succeed)', () => {
  it('passes a step whose command succeeded', () => {
    const results = run([{ command: 'new_game seed:42' }], 'default-success');
    expect(results[0]!.error).toBeUndefined();
  });

  it('fails a step whose command was refused, naming the command and the refusal text', () => {
    const results = run([{ command: REFUSED_CMD }], 'default-refused');
    expect(results[0]!.error).toBeDefined();
    expect(results[0]!.error).toContain(REFUSED_CMD);
    // ConsoleRunner's own refusal text for an unregistered command.
    expect(results[0]!.error).toMatch(/unknown command/i);
  });

  it('a refused command\'s failure is still visible in the step result and the written state dump — commandOutput/gameState are not nulled out', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: REFUSED_CMD },
    ], 'default-refused-statedump');
    const refused = results[1]!;
    expect(refused.error).toBeDefined();
    expect(refused.commandOutput, 'refusal output text should still be captured').not.toBe('');
    expect(refused.gameState, 'game state should still be captured, not nulled out by the refusal').not.toBeNull();
    expect(refused.statePath, 'a state-dump file should still be written for a refusal failure').not.toBe('');

    const written = JSON.parse(readFileSync(refused.statePath, 'utf-8')) as {
      commandOutput: string;
      gameState: Record<string, unknown> | null;
    };
    expect(written.commandOutput).not.toBe('');
    expect(written.gameState).not.toBeNull();
  });
});

describe("runSteps — commandOutcome: 'refused' (refusal is the expected outcome)", () => {
  it('passes a step whose command was refused', () => {
    const results = run([
      { command: REFUSED_CMD, commandOutcome: 'refused' },
    ], 'refused-refused');
    expect(results[0]!.error).toBeUndefined();
  });

  it('fails a step whose command unexpectedly SUCCEEDED — the guard stopped guarding', () => {
    const results = run([
      { command: 'new_game seed:42', commandOutcome: 'refused' },
    ], 'refused-succeeded');
    expect(results[0]!.error).toBeDefined();
    expect(results[0]!.error).toContain('new_game seed:42');
  });

  it('with an expect goal that also holds, both checks are satisfied and the step passes', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: REFUSED_CMD,
        commandOutcome: 'refused',
        expect: { equals: { cash: 50000 } },
      },
    ], 'refused-with-expect');
    expect(results[1]!.error).toBeUndefined();
  });
});

describe("runSteps — commandOutcome: 'either' (genuinely nondeterministic)", () => {
  it('passes a step whose command was refused', () => {
    const results = run([
      { command: REFUSED_CMD, commandOutcome: 'either' },
    ], 'either-refused');
    expect(results[0]!.error).toBeUndefined();
  });

  it('passes a step whose command succeeded', () => {
    const results = run([
      { command: 'new_game seed:42', commandOutcome: 'either' },
    ], 'either-succeeded');
    expect(results[0]!.error).toBeUndefined();
  });
});

describe('runSteps — a genuine thrown exception always fails the step, regardless of commandOutcome', () => {
  function runWithThrowingCommand(commandOutcome?: 'refused' | 'either') {
    const engine = createGameEngine();
    // Register a command-only-for-this-test that throws a real exception,
    // rather than returning CommandResult.success:false — the distinction
    // this whole suite hinges on. Uses the runner's own public registration
    // API, so nothing under scripts/ or src/ is modified.
    engine.runner.register('throw_test_585', 'test-only: throws', () => {
      throw new Error('synthetic thrown error for command-runner test');
    });
    const step: ScenarioStepDef = commandOutcome === undefined
      ? { command: 'throw_test_585' }
      : { command: 'throw_test_585', commandOutcome };
    return runSteps(engine, [step], outDir(`throw-${commandOutcome ?? 'default'}`));
  }

  it('fails with the exception message when no commandOutcome is declared', () => {
    const results = runWithThrowingCommand(undefined);
    expect(results[0]!.error).toContain('synthetic thrown error for command-runner test');
  });

  it("fails with the exception message even when commandOutcome is 'refused' — a declaration must not swallow a real throw", () => {
    const results = runWithThrowingCommand('refused');
    expect(results[0]!.error).toContain('synthetic thrown error for command-runner test');
  });

  it("fails with the exception message even when commandOutcome is 'either' — a declaration must not swallow a real throw", () => {
    const results = runWithThrowingCommand('either');
    expect(results[0]!.error).toContain('synthetic thrown error for command-runner test');
  });
});

describe('runSteps — baseline regression pin (no declaration, command succeeds)', () => {
  it('a normal successful step is unaffected by this feature', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller' },
    ], 'baseline');
    expect(results[0]!.error).toBeUndefined();
    expect(results[1]!.error).toBeUndefined();
  });
});
