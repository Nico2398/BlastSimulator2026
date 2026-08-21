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
import { createGameEngine, runSteps, runScenario } from '../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

function run(steps: ScenarioStepDef[]) {
  const engine = createGameEngine();
  const outDir = resolve(tmpdir(), `bs2026-scenario-expect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return runSteps(engine, steps, outDir);
}

function runDrift(steps: ScenarioStepDef[]) {
  const engine = createGameEngine();
  const outDir = resolve(tmpdir(), `bs2026-scenario-expect-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return runSteps(engine, steps, outDir, true);
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

// ──────────────────────────────────────────────
// reportDrift mode (issue #679): runSteps(engine, steps, outDir, true) runs
// every step to completion instead of stopping at the first equals/changedBy
// mismatch, collecting the mismatches on the step's own result instead of
// throwing. Directional (increased/decreased) goals are never suppressed.
// ──────────────────────────────────────────────
describe('runSteps with reportDrift=true', () => {
  const mismatchedScenario: ScenarioStepDef[] = [
    { command: 'new_game seed:42', expect: { equals: { cash: 1 } } },
    { command: 'employee hire role:driller', expect: { increased: ['employeeCount'] } },
  ];

  it('does not set .error on a step whose expect.equals mismatches, and populates .driftMismatches instead', () => {
    const results = runDrift(mismatchedScenario);
    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.driftMismatches).toBeDefined();
    expect(results[0]!.driftMismatches!.length).toBeGreaterThan(0);
    expect(results[0]!.driftMismatches![0]!.field).toBe('cash');
    expect(results[0]!.driftMismatches![0]!.goalType).toBe('equals');
  });

  it('lets the scenario run to completion — the step after a drifted step still executes', () => {
    const results = runDrift(mismatchedScenario);
    // Second step ran for real against the post-first-step state (a hire genuinely happened).
    expect(results).toHaveLength(2);
    expect(results[1]!.error).toBeUndefined();
    expect(results[1]!.commandOutput).not.toBe('');
  });

  it('the exact same scenario without reportDrift still fails normally (drift-on vs drift-off, side by side)', () => {
    const results = run(mismatchedScenario);
    expect(results[0]!.error).toMatch(/expect failed/);
    expect(results[0]!.error).toMatch(/cash/);
  });

  it('a failed increased/decreased goal still sets .error even with reportDrift=true — directional goals are never suppressed', () => {
    const results = runDrift([
      { command: 'new_game seed:42' },
      // `state` is a pure read — nothing increases.
      { command: 'state', expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[1]!.error).toMatch(/expect failed/);
    expect(results[1]!.error).toMatch(/employeeCount/);
  });

  it('a scenario with zero mismatches under reportDrift=true leaves every step\'s .driftMismatches unset', () => {
    const results = runDrift([
      { command: 'new_game seed:42', expect: { equals: { cash: 50000, buildingCount: 0 } } },
      { command: 'employee hire role:driller', expect: { increased: ['employeeCount'] } },
    ]);
    expect(results[0]!.driftMismatches ?? []).toEqual([]);
    expect(results[1]!.driftMismatches ?? []).toEqual([]);
  });
});

describe('runScenario with reportDrift=true (issue #679)', () => {
  it('populates ScenarioResult.driftRecords with scenario/step/command plus the mismatch, when steps have mismatches', () => {
    const engine = createGameEngine();
    const outDir = resolve(tmpdir(), `bs2026-run-scenario-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const steps: ScenarioStepDef[] = [
      { command: 'new_game seed:42', expect: { equals: { cash: 1 } } },
    ];
    const result = runScenario(engine, 'drift-scenario', steps, outDir, true);
    expect(result.driftRecords).toBeDefined();
    const rec = result.driftRecords!.find(r => r.field === 'cash')!;
    expect(rec).toBeDefined();
    expect(rec.scenario).toBe('drift-scenario');
    expect(rec.step).toBe(0);
    expect(rec.command).toBe('new_game seed:42');
  });

  it('leaves driftRecords absent/empty when there are no mismatches', () => {
    const engine = createGameEngine();
    const outDir = resolve(tmpdir(), `bs2026-run-scenario-no-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const steps: ScenarioStepDef[] = [
      { command: 'new_game seed:42', expect: { equals: { cash: 50000, buildingCount: 0 } } },
    ];
    const result = runScenario(engine, 'clean-scenario', steps, outDir, true);
    expect(result.driftRecords ?? []).toEqual([]);
  });
});
