// BlastSimulator2026 — An attempt's agent is stopped before anything reads or retries after it
//
// A step's `timeout-minutes` ends the step, not the `claude` process it
// started: a timed-out first attempt kept working for 59 minutes beside the
// retry its unsettled issue had started. `agent-processes.cjs` stops every
// `claude` process tree between an attempt and the steps that follow it.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const { parsePs, treesToStop } = require(join(ROOT, '.github/scripts/agent-processes.cjs')) as {
  parsePs: (text: string) => { pid: number; ppid: number; comm: string }[];
  treesToStop: (rows: { pid: number; ppid: number; comm: string }[], names: string[], self?: number) => number[];
};

const PS = [
  '    1     0 systemd',
  '  100     1 Runner.Worker',
  '  200   100 bash',
  '  201   200 node',
  ' 2415   100 bun',
  ' 2511  2415 claude',
  ' 3000  2511 bash',
  ' 3001  3000 npm exec vitest',
  ' 3002  3001 node (vitest)',
  ' 4000  2511 tail',
].join('\n');

describe('treesToStop', () => {
  const rows = parsePs(PS);

  it('reads command names with spaces', () => {
    expect(rows.find((row) => row.pid === 3001)).toEqual({ pid: 3001, ppid: 3000, comm: 'npm exec vitest' });
  });

  it('stops each named process with every descendant, deepest first', () => {
    const order = treesToStop(rows, ['claude'], 201);
    expect(new Set(order)).toEqual(new Set([2511, 3000, 3001, 3002, 4000]));
    expect(order.indexOf(3002)).toBeLessThan(order.indexOf(3001));
    expect(order.indexOf(3000)).toBeLessThan(order.indexOf(2511));
    expect(order.at(-1)).toBe(2511);
  });

  it('leaves the parent that started the agent and anything unrelated', () => {
    const order = treesToStop(rows, ['claude'], 201);
    expect(order).not.toContain(2415);
    expect(order).not.toContain(200);
  });

  it('never stops itself or its own ancestors, so it stops nothing from inside an agent', () => {
    expect(treesToStop(rows, ['claude'], 3002)).toEqual([]);
  });

  it('stops nothing when no agent is left', () => {
    expect(treesToStop(parsePs('  1 0 systemd\n  5 1 bash'), ['claude'], 5)).toEqual([]);
  });
});

describe('the runner', () => {
  const runner = readFileSync(join(ROOT, '.github/workflows/claude-runner.yml'), 'utf8');
  const at = (name: string) => runner.indexOf(`- name: ${name}`);

  it('stops the first attempt before its issue is read and a retry or rescue starts', () => {
    expect(at('Stop what the first attempt left running')).toBeGreaterThan(at('Run Claude Code'));
    expect(at('Stop what the first attempt left running')).toBeLessThan(at('Did the run settle its issue?'));
    expect(at('Stop what the retry left running')).toBeGreaterThan(at('Retry the run when the first attempt settled nothing'));
    expect(at('Stop what the retry left running')).toBeLessThan(at('Rescue an unfinished run'));
    expect(at('Stop what the retry left running')).toBeLessThan(at('Export run metrics'));
  });

  it('runs the stopper from the workflow commit, whatever branch the agent left', () => {
    const steps = runner.split('- name: ').filter((step) => step.startsWith('Stop what the'));
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step).toContain('if: always()');
      expect(step).toContain('show "$GITHUB_SHA:.github/scripts/agent-processes.cjs"');
      expect(step).toContain('stop claude');
    }
  });
});
