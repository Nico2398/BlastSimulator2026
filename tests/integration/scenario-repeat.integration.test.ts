// BlastSimulator2026 — `repeat: N` scenario step multiplier, command mode (#696)
//
// Proves the wiring, not just the pure resolveRepeatCount (covered in
// tests/unit/scripts/shared/scenario-utils.test.ts): runSteps
// (command-runner.ts) must actually run a step's command `repeat` times in
// immediate succession, evaluate `commandOutcome` after EVERY iteration
// independently, and evaluate `expect`'s state-goal fields
// (increased/decreased/equals/changedBy) exactly ONCE per step — against the
// state immediately before the FIRST iteration and immediately after the
// LAST — using the real game engine, not a mock.
//
// Motivated by PR #693's 24 duplicate `employee hire role:driller` steps in
// scripts/scenario-defs/blast-execution-visual.json, which this feature lets
// a scenario author express as one `repeat: 24` block instead.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

function run(steps: ScenarioStepDef[]) {
  const engine = createGameEngine();
  const outDir = resolve(tmpdir(), `bs2026-scenario-repeat-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return runSteps(engine, steps, outDir);
}

describe('command-mode runSteps honors a step\'s repeat field (issue #696)', () => {
  it('absent repeat behaves exactly as today — command runs once', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', expect: { changedBy: { employeeCount: 1 } } },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('repeat: 1 behaves exactly as absent — command runs once', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', repeat: 1, expect: { changedBy: { employeeCount: 1 } } },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('repeat: N runs the command N times — expect.changedBy matching the aggregate (Nx) delta passes', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'employee hire role:driller',
        role: 'bootstrap',
        repeat: 3,
        expect: { changedBy: { employeeCount: 3 } },
      },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('repeat: N — expect.changedBy matching only a single iteration\'s delta fails (proves N iterations genuinely ran, not just one)', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'employee hire role:driller',
        role: 'bootstrap',
        repeat: 3,
        expect: { changedBy: { employeeCount: 1 } },
      },
    ]);
    expect(results[1]!.error).toBeDefined();
    expect(results[1]!.error).toMatch(/expect failed/);
    expect(results[1]!.error).toMatch(/employeeCount/);
  });

  it('repeat: N produces exactly ONE report/state-dump entry for the step, carrying the LAST iteration\'s output', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', role: 'bootstrap', repeat: 5 },
    ]);
    // One StepResult for the repeat step, not five.
    expect(results).toHaveLength(2);
    const gs = results[1]!.gameState as { employeeCount: number } | null;
    expect(gs).not.toBeNull();
    // The LAST iteration's state: 5 drillers hired, not 1.
    expect(gs!.employeeCount).toBe(5);
  });

  it('repeat: N — increased/decreased are evaluated against first-before vs last-after, not per-iteration', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'employee hire role:driller',
        role: 'bootstrap',
        repeat: 4,
        expect: { increased: ['employeeCount'], decreased: ['cash'] },
      },
    ]);
    expect(results[1]!.error).toBeUndefined();
  });

  it('commandOutcome is checked after EVERY iteration independently — a repeat block that starts failing partway through reports the failing iteration, not an aggregate pass', () => {
    // manager hires cost $2,000 (HIRING_COSTS.manager) against a $50,000
    // starting purse: exactly 25 succeed, driving cash to $0. Iteration 26
    // is refused for insufficient funds — commandOutcome defaults to
    // "must succeed", so this must surface as a failure naming the
    // iteration, never silently absorbed because 25/26 succeeded.
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:manager', role: 'bootstrap', repeat: 26 },
    ]);
    expect(results[1]!.error).toBeDefined();
    expect(results[1]!.error).toMatch(/26/);
  });

  it('repeat: 0 is invalid — the step fails immediately naming the step and the offending value, without running the command', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', repeat: 0, expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[1]!.error).toBeDefined();
    expect(results[1]!.error).toMatch(/0/);
    // The invalid step must not have run the command at all.
    const gs = results[1]!.gameState as { employeeCount: number } | null;
    if (gs !== null) expect(gs.employeeCount).toBe(0);
  });

  it('a negative repeat is invalid — the step fails immediately', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', repeat: -1 },
    ]);
    expect(results[1]!.error).toBeDefined();
  });

  it('a non-integer repeat is invalid — the step fails immediately', () => {
    const results = run([
      { command: 'new_game seed:42' },
      { command: 'employee hire role:driller', repeat: 1.5 },
    ]);
    expect(results[1]!.error).toBeDefined();
  });

  it('repeat combined with a waitUntil interaction action on the same step is rejected, naming both constructs', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'wait_until field:tickCount equals:3 max_ticks:10',
        role: 'setup',
        repeat: 2,
        interaction: [{ type: 'waitUntil', field: 'tickCount', equals: 3, maxTicks: 10, timeoutMs: 30000 }],
      },
    ]);
    expect(results[1]!.error).toBeDefined();
    expect(results[1]!.error).toMatch(/repeat/i);
    expect(results[1]!.error).toMatch(/waitUntil/i);
  });
});
