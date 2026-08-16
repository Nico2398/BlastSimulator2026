// BlastSimulator2026 — `waitUntil` scenario step, command mode (issue #590)
//
// Proves the wiring, not just the pure loop: runSteps (command-runner.ts)
// must actually drive `tick 1` repeatedly against the real game engine until
// the named state-dump field matches, and fail loudly naming the field, its
// last value, and the tick budget when it never does.
//
// DO NOT implement anything here — only add implementation to src/ or scripts/.

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { createGameEngine, runSteps } from '../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

function run(steps: ScenarioStepDef[]) {
  const engine = createGameEngine();
  const outDir = resolve(tmpdir(), `bs2026-scenario-wait-until-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return runSteps(engine, steps, outDir);
}

describe('command-mode runSteps drives waitUntil by looping tick 1 (issue #590)', () => {
  it('passes once tickCount reaches its target within the tick budget', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'wait_until field:tickCount equals:3 max_ticks:10',
        role: 'setup',
        interaction: [{ type: 'waitUntil', field: 'tickCount', equals: 3, maxTicks: 10, timeoutMs: 30000 }],
      },
    ]);

    expect(results[1]!.error).toBeUndefined();
    expect(results[1]!.gameState).not.toBeNull();
    expect((results[1]!.gameState as { tickCount: number }).tickCount).toBe(3);
    expect(results[1]!.commandOutput).toMatch(/tickCount.*reached 3 after 3 tick/);
  });

  it('exhausts the tick budget and fails naming the field, its last value, and the budget', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'wait_until field:tickCount equals:999 max_ticks:2',
        role: 'setup',
        interaction: [{ type: 'waitUntil', field: 'tickCount', equals: 999, maxTicks: 2, timeoutMs: 30000 }],
      },
    ]);

    expect(results[1]!.error).toMatch(/"tickCount" never reached 999/);
    expect(results[1]!.error).toMatch(/stalled at 2/);
    expect(results[1]!.error).toMatch(/after 2 ticks/);
  });

  it('a following expect check sees the state left by the wait, not the state before it', () => {
    const results = run([
      { command: 'new_game seed:42' },
      {
        command: 'wait_until field:tickCount equals:2 max_ticks:10',
        role: 'setup',
        interaction: [{ type: 'waitUntil', field: 'tickCount', equals: 2, maxTicks: 10, timeoutMs: 30000 }],
        expect: { equals: { tickCount: 2 } },
      },
    ]);

    expect(results[1]!.error).toBeUndefined();
  });
});
