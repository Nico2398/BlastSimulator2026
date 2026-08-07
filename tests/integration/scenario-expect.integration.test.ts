// BlastSimulator2026 — Scenario step `expect` assertions, command mode
//
// Proves the wiring, not just the pure function: runSteps (command-runner.ts)
// must actually fail a step when its `expect` is violated, and pass it when
// satisfied, using the real game engine — not a mock. checkGoalAgainstState
// itself (the pure equals/increased comparison) is covered in
// tests/unit/scenario-goal.test.ts; this is the "wired into the runner" half.
//
// DO NOT implement anything here — only add implementation to src/ or scripts/.

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

function run(steps: ScenarioStepDef[]) {
  const engine = createGameEngine();
  const outDir = resolve(tmpdir(), `bs2026-scenario-expect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return runSteps(engine, steps, outDir);
}

describe('command-mode runSteps checks a step\'s expect, not just whether the command threw', () => {
  it('passes a step whose expect.equals matches the real post-command state', () => {
    const results = run([
      { command: 'new_game seed:42', expect: { equals: { cash: 50000, buildingCount: 0 } } },
    ]);
    expect(results[0]!.error).toBeUndefined();
  });

  it('fails a step whose expect.equals does not match the real post-command state', () => {
    const results = run([
      { command: 'new_game seed:42', expect: { equals: { cash: 1 } } },
    ]);
    expect(results[0]!.error).toMatch(/expect failed/);
    expect(results[0]!.error).toMatch(/cash/);
  });

  it('passes a step whose expect.increased field genuinely grew', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('fails a step whose expect.increased field did not move', () => {
    const results = run([
      { command: 'new_game seed:42' },
      // `state` is a pure read — nothing increases.
      { command: 'state', expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[1]!.error).toMatch(/expect failed/);
    expect(results[1]!.error).toMatch(/employeeCount/);
  });

  it('increased is measured against the state just before this step, not the scenario\'s start', () => {
    // Two hires in a row: the second step's `before` must be post-first-hire
    // (1), so only a genuine second increase (to 2) satisfies it.
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller' },
      { command: 'employee hire role:surveyor', expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[2]!.error).toBeUndefined();
  });

  it('passes a step whose expect.decreased field genuinely shrank', () => {
    const results = run([
      { command: 'new_game seed:42' },
      // Hiring spends HIRING_COSTS.driller — cash genuinely drops.
      { command: 'employee hire role:driller', expect: { decreased: ['cash'] } },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('fails a step whose expect.decreased field did not move', () => {
    const results = run([
      { command: 'new_game seed:42' },
      // `state` is a pure read — nothing decreases.
      { command: 'state', expect: { decreased: ['cash'] } },
    ]);
    expect(results[1]!.error).toMatch(/expect failed/);
    expect(results[1]!.error).toMatch(/cash/);
  });

  it('a goal with only usable/blocked/tutorialStep is a no-op in command mode (no page to check against)', () => {
    const results = run([
      { command: 'new_game seed:42', expect: { usable: '#bs-survey-run', tutorialStep: 'time-speed' } },
    ]);
    expect(results[0]!.error).toBeUndefined();
  });

  it('a step with no expect at all is unaffected — pure "did it throw" as before', () => {
    const results = run([{ command: 'new_game seed:42' }]);
    expect(results[0]!.error).toBeUndefined();
  });
});
