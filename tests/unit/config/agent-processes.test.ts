// BlastSimulator2026 — An attempt's agent is stopped before anything reads or retries after it
//
// A step's `timeout-minutes` ends the step, not the `claude` process it
// started: a timed-out first attempt kept working for 59 minutes beside the
// retry its unsettled issue had started. `agent-processes.cjs` stops every
// `claude` process tree between an attempt and the steps that follow it.

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);
const { parsePs, treesToStop, unfinishedHandlePids } = require(join(ROOT, '.github/scripts/agent-processes.cjs')) as {
  parsePs: (text: string) => { pid: number; ppid: number; comm: string }[];
  treesToStop: (rows: { pid: number; ppid: number; comm: string }[], names: string[], self?: number, roots?: number[]) => number[];
  unfinishedHandlePids: (dir: string, commandLineOf?: (pid: number) => string | undefined) => number[];
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

  it('stops a root it is handed — a detached long run — with its descendants', () => {
    const detached = parsePs([PS, ' 5000     1 bash', ' 5001  5000 node (vitest)'].join('\n'));
    expect(treesToStop(detached, ['claude'], 201, [5000])).toEqual(expect.arrayContaining([5001, 5000, 2511]));
    expect(treesToStop(detached, ['claude'], 201, [5000]).indexOf(5001)).toBeLessThan(treesToStop(detached, ['claude'], 201, [5000]).indexOf(5000));
  });
});

// `npm run long` detaches each command into its own process group, so stopping
// `claude` leaves it running — and the next attempt's sessions, held by the
// settled-turn hook, then wait on handles they never started (issue 2118's
// retry: 19 minutes).
describe('unfinishedHandlePids', () => {
  const handles = (files: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'long-handles-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  it('names the shells of handles with no exit file whose command line still names that file', () => {
    const dir = handles({ 'run.pid': '4242', 'done.pid': '4343', 'done.exit': '0', 'reused.pid': '4444', 'junk.pid': 'x', 'run.log': '' });
    const commandLines: Record<number, string> = {
      4242: `bash -c ( npm run scenarios ) status=$? printf '%s' "$status" > ${join(dir, 'run.exit')}`,
      4343: `bash -c ... > ${join(dir, 'done.exit')}`,
      4444: 'node some-other-process',
    };
    try {
      expect(unfinishedHandlePids(dir, (pid) => commandLines[pid])).toEqual([4242]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names nothing for a missing directory', () => {
    expect(unfinishedHandlePids(join(tmpdir(), 'no-such-handle-dir-xyz'))).toEqual([]);
  });

  it('stops a real detached long run and its whole process group, a reparented member included', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'long-handles-'));
    const exitPath = join(dir, 'slow.exit');
    // What `npm run long -- start` spawns: a detached shell that writes its exit
    // file. Its command leaves a `sleep` whose parent exits first, so that sleep
    // is reparented out of the shell's tree and only the process group holds it.
    const command = `( sh -c 'sleep 30 &'; sleep 30 )`;
    const child = spawn('bash', ['-c', `${command}\nstatus=$?\nprintf '%s' "$status" > '${exitPath}'\nexit $status\n`], { detached: true, stdio: 'ignore' });
    child.unref();
    writeFileSync(join(dir, 'slow.pid'), String(child.pid));
    // Live members of the shell's group. A killed member reparented to an init
    // that never reaps it stays listed as a zombie, which runs nothing.
    const liveMembers = () => spawnSync('ps', ['-eo', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8' }).stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter(([, , pgid, stat]) => pgid === String(child.pid) && stat !== undefined && !stat.startsWith('Z'))
      .map(([pid, ppid]) => ({ pid: Number(pid), ppid: Number(ppid) }));
    const reparented = (members: { pid: number; ppid: number }[]) =>
      members.filter((member) => member.pid !== child.pid && !members.some((other) => other.pid === member.ppid));
    // Bounded well inside the test's own timeout, so the cleanup below always
    // runs: a test that times out abandons its body before `finally`.
    const settle = { timeout: 5_000, interval: 50 };
    try {
      await vi.waitFor(() => expect(reparented(liveMembers())).toHaveLength(1), settle);
      const stopper = spawnSync('node', [join(ROOT, '.github/scripts/agent-processes.cjs'), 'stop', 'no-such-agent', '--handles', dir], { encoding: 'utf8' });
      expect(stopper.status, stopper.stderr).toBe(0);
      await vi.waitFor(() => expect(liveMembers()).toEqual([]), settle);
      expect(existsSync(exitPath)).toBe(false);
    } finally {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
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
      expect(step).toContain('stop claude --handles "$GITHUB_WORKSPACE/.agentic/long"');
    }
  });
});
