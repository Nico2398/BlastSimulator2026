// BlastSimulator2026 — `npm run scenarios` as real processes
//
// The fan-out's unit tests drive fakes. What only a real process shows is the
// wiring around them: that a forked worker starts under the parent's tsx
// loader and answers over IPC, that the exit code carries a failed scenario
// and a dead worker, and that `--worker` started by hand — with no parent to
// ask it for anything — refuses rather than exiting 0 having run nothing.
// Each case spawns the real runner on definitions that cost milliseconds.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const TSX = resolve(ROOT, 'node_modules/.bin/tsx');
const RUNNER = resolve(ROOT, 'scripts/run-all-scenarios.ts');
/** Two definitions that open on `help` / `state` rather than generating a world. */
const CHEAP = ['main-menu-visual', 'loading-screen-visual'] as const;
const TIMEOUT = 120_000;

function runScenarios(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(TSX, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT - 10_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('npm run scenarios, as real processes', () => {
  it('fans two scenarios out across two forked workers and passes both', () => {
    const { status, output } = runScenarios(['--jobs', '2', ...CHEAP]);
    expect(output).toContain('Starting 2 worker processes');
    for (const name of CHEAP) expect(output).toContain(`[${name}]`);
    expect(output).toContain('Total: 2, Passed: 2, Failed: 0');
    expect(status, output).toBe(0);
  }, TIMEOUT);

  it('exits non-zero when one scenario of the fan-out fails', () => {
    const { status, output } = runScenarios(['--jobs', '2', CHEAP[0], 'no-such-scenario-definition']);
    expect(output).toContain('Total: 2, Passed: 1, Failed: 1');
    expect(status, output).toBe(1);
  }, TIMEOUT);

  it('runs a name given twice once', () => {
    const { status, output } = runScenarios(['--jobs', '2', CHEAP[0], CHEAP[0]]);
    expect(output).toContain('Total: 1, Passed: 1, Failed: 0');
    expect(status, output).toBe(0);
  }, TIMEOUT);

  it('refuses --worker without a parent to serve', () => {
    const { status, output } = runScenarios(['--worker']);
    expect(output).toContain('--worker is internal');
    expect(status).not.toBe(0);
  }, TIMEOUT);
});
