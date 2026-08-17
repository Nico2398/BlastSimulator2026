// BlastSimulator2026 — The long-run wrapper and the two hooks around it
//
// `npm run long` exists because an unattended session gets one turn and three of
// this project's required commands do not fit in one 600s Bash call. It is the
// only sanctioned way to detach, and `require-settled-turn.sh` reads its handle
// directory to decide whether a turn may end — so a wrong answer here is a lost
// run, the failure that produced PRs #594, #603 and #604.
//
// Three things have to hold, and each broke once while this was being written:
//   - a command's real exit code survives, including when the command calls
//     `exit` itself (the first cut wrapped it without a subshell and reported a
//     finished command as DIED)
//   - argv survives the trip through `bash -c` (the first cut joined on spaces,
//     turning one command into four statements)
//   - `&&` and `2>&1` are not backgrounding and must keep working

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { shellQuote, handleFor, readState, unfinished, EXIT_RUNNING } from '../../../scripts/long-run';

const ROOT = join(import.meta.dirname, '../../..');
const read = (path: string): string => readFileSync(path, 'utf8');
const SCRIPT = join(ROOT, 'scripts/long-run.ts');

/** Runs the CLI in an isolated cwd so handles never touch the repo's own. */
function long(cwd: string, args: string[]): { code: number; out: string } {
  const result = spawnSync('npx', ['tsx', SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('shellQuote', () => {
  it('keeps a command with shell metacharacters as one word', () => {
    expect(shellQuote('echo hi; exit 3')).toBe(`'echo hi; exit 3'`);
  });

  it('survives an embedded single quote', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

describe('npm run long', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'longrun-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the command exit code even when the command exits itself', () => {
    // The `exit 3` is the point: without the subshell in the wrapper it replaces
    // the shell that was going to write the exit file, and a command that ran
    // fine gets reported as DIED.
    expect(long(dir, ['start', 'probe', '--', 'bash', '-c', 'echo hello; exit 3']).code).toBe(0);
    const waited = long(dir, ['wait', 'probe']);
    expect(waited.out).toContain('FINISHED exit=3');
    expect(waited.out).toContain('hello');
    expect(waited.code).toBe(1);
  });

  it('exits 0 when the command succeeded', () => {
    long(dir, ['start', 'ok', '--', 'bash', '-c', 'echo fine']);
    const waited = long(dir, ['wait', 'ok']);
    expect(waited.out).toContain('FINISHED exit=0');
    expect(waited.code).toBe(0);
  });

  it('exits 75 — not a failure — while the command is still going', () => {
    long(dir, ['start', 'slow', '--', 'bash', '-c', 'sleep 30']);
    const waited = long(dir, ['wait', 'slow', '--budget-seconds', '1']);
    expect(waited.out).toContain('STILL RUNNING');
    expect(waited.out).toContain('Not a verdict');
    expect(waited.code).toBe(EXIT_RUNNING);
  });

  it('refuses a second start under a label already running', () => {
    long(dir, ['start', 'busy', '--', 'bash', '-c', 'sleep 30']);
    expect(long(dir, ['start', 'busy', '--', 'bash', '-c', 'echo x']).code).toBe(4);
  });

  it('status answers what is unfinished, and exits non-zero while any is', () => {
    long(dir, ['start', 'pending', '--', 'bash', '-c', 'sleep 30']);
    const running = long(dir, ['status']);
    expect(running.out).toContain('pending');
    expect(running.code).toBe(1);

    long(dir, ['start', 'quick', '--', 'bash', '-c', 'true']);
    long(dir, ['wait', 'quick']);
    // `pending` is still going, so status must still say so.
    expect(long(dir, ['status']).code).toBe(1);
  });

  it('rejects a missing `--`, a missing label and an unknown subcommand', () => {
    expect(long(dir, ['start', 'label']).code).toBe(4);
    expect(long(dir, ['wait']).code).toBe(4);
    expect(long(dir, ['sprint']).code).toBe(4);
  });
});

describe('readState / unfinished', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'longstate-'));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats a written exit code as authoritative over liveness', () => {
    const handle = handleFor('x', dir);
    // A pid that is alive (this process) plus an exit file: finished wins, so a
    // command that completed a moment ago never reads as still running.
    writeFileSync(handle.pidPath, String(process.pid));
    writeFileSync(handle.exitPath, '0');
    expect(readState(handle)).toEqual({ kind: 'finished', code: 0 });
    expect(unfinished(dir)).toEqual([]);
  });

  it('calls a gone process with no exit code died, not finished', () => {
    const handle = handleFor('y', dir);
    writeFileSync(handle.pidPath, '2147483646');
    expect(readState(handle).kind).toBe('died');
    expect(unfinished(dir)).toEqual([]);
  });

  it('lists a live handle with no exit code as unfinished', () => {
    writeFileSync(handleFor('z', dir).pidPath, String(process.pid));
    expect(unfinished(dir)).toEqual(['z']);
  });
});

/** Feeds a PreToolUse payload to a hook and returns its exit code. */
function hook(script: string, payload: unknown, env: NodeJS.ProcessEnv = {}): number {
  const result = spawnSync(join(ROOT, '.claude/hooks', script), [], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result.status ?? -1;
}

const bash = (command: string, background?: boolean) => ({
  tool_input: background === undefined ? { command } : { command, run_in_background: background },
});

describe('require-foreground-bash.sh', () => {
  it.each([
    ['a plain command', bash('npm run test')],
    ['an explicit foreground call', bash('npm run test', false)],
    ['a && chain', bash('npm run typecheck && npm run test')],
    ['a 2>&1 redirect', bash('npm run test 2>&1 | tail -20')],
    ['the sanctioned wrapper', bash('npm run long -- start scenarios -- npm run scenarios')],
    // A server is not a result. The visual channel cannot run without one, and
    // `npm run dev &` is what `dev-visual-testing`, `rendering.md`,
    // `visual-tester` and `verify-env` all already tell a session to type.
    ['the dev server the visual channel needs', bash('npm run dev &')],
    ['the dev server on an explicit port', bash('npm run dev -- --port 5173 &')],
    ['vite directly', bash('npx vite &')],
    ['the dev server with its output redirected', bash('npm run dev > /tmp/dev.log 2>&1 &')],
    ['the dev server through the background flag', bash('npm run dev', true)],
  ])('allows %s', (_label, payload) => {
    expect(hook('require-foreground-bash.sh', payload)).toBe(0);
  });

  it.each([
    ['run_in_background: true', bash('npm run scenarios', true)],
    ['nohup', bash('nohup npx tsx scripts/run-all-scenarios.ts > /tmp/o 2>&1 &')],
    ['a trailing &', bash('npx vitest run &')],
    ['setsid', bash('setsid npm run scenarios')],
    // The dev-server carve-out is anchored at the start of the command, so a
    // detach wrapper in front of one is still a detach.
    ['a dev server behind a detach wrapper', bash('setsid npm run dev')],
    ['disown', bash('npm run dev & disown')],
    ['a backgrounded line inside a multi-line command', bash('cd /tmp\nnpm run dev &\necho started')],
    // The dev-server allowance covers one simple command and nothing chained
    // onto it — otherwise naming `npm run dev` would launder anything after it.
    ['a real background command chained onto a dev server', bash('npm run dev & npx vitest run &')],
    ['a nohup hidden behind a dev server', bash('npm run dev & sleep 3; nohup npm run scenarios &')],
  ])('blocks %s', (_label, payload) => {
    expect(hook('require-foreground-bash.sh', payload)).toBe(2);
  });

  it('names the wrapper in the reason it gives back', () => {
    const result = spawnSync(join(ROOT, '.claude/hooks/require-foreground-bash.sh'), [], {
      input: JSON.stringify(bash('npm run scenarios', true)),
      encoding: 'utf8',
    });
    expect(result.stderr).toContain('npm run long -- start');
    expect(result.stderr).toContain('75');
  });

  // A human at an interactive CLI genuinely has a later turn. No pipeline
  // workflow sets this — blocking stays the default so a runner cannot lose a
  // run to an environment variable that failed to arrive.
  it('lets a human opt out', () => {
    expect(
      hook('require-foreground-bash.sh', bash('npm run dev &'), { AGENTIC_ALLOW_BACKGROUND_BASH: '1' })
    ).toBe(0);
  });

  it('fails open on an unreadable payload rather than wedging every command', () => {
    const result = spawnSync(join(ROOT, '.claude/hooks/require-foreground-bash.sh'), [], {
      input: 'not json at all',
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
  });
});

describe('require-settled-turn.sh', () => {
  let dir: string;

  const stop = (env: NodeJS.ProcessEnv = {}): number =>
    spawnSync(join(ROOT, '.claude/hooks/require-settled-turn.sh'), [], {
      input: '{}',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    }).status ?? -1;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stophook-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets a turn end when nothing was ever started', () => {
    expect(stop()).toBe(0);
  });

  it('lets a turn end when every long run reported', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'done.pid'), String(process.pid));
    writeFileSync(join(handles, 'done.exit'), '0');
    expect(stop()).toBe(0);
  });

  it('refuses the turn while a long run is still going', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'scenarios.pid'), String(process.pid));
    expect(stop()).toBe(2);
  });

  it('names the wait command in the reason it gives back', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'scenarios.pid'), String(process.pid));
    const result = spawnSync(join(ROOT, '.claude/hooks/require-settled-turn.sh'), [], {
      input: '{}',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    expect(result.stderr).toContain('npm run long -- wait scenarios');
  });

  // Blocking forever is its own outage: a job that cannot end never reaches the
  // rescue step, so the branch dies with the VM instead of becoming a draft
  // somebody can finish. A counter with a bound, not a wall.
  it('releases on its brake after the configured number of refusals', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'stuck.pid'), String(process.pid));
    expect([stop(), stop()]).toEqual([2, 2]);
    expect(stop({ AGENTIC_STOP_BLOCK_LIMIT: '2' })).toBe(0);
  });

  it('forgets its count once nothing is outstanding', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'again.pid'), String(process.pid));
    expect(stop()).toBe(2);
    writeFileSync(join(handles, 'again.exit'), '0');
    expect(stop()).toBe(0);
    expect(existsSync(join(handles, '.stop-blocks'))).toBe(false);
  });

  it('lets a human opt out', () => {
    const handles = join(dir, '.agentic/long');
    mkdirSync(handles, { recursive: true });
    writeFileSync(join(handles, 'x.pid'), String(process.pid));
    expect(stop({ AGENTIC_ALLOW_UNSETTLED_TURN: '1' })).toBe(0);
  });
});

describe('the wrapper is reachable the way the context files name it', () => {
  it('is wired as `npm run long`', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.long).toBe('tsx scripts/long-run.ts');
  });

  it('keeps its handles out of the repository', () => {
    expect(read(join(ROOT, '.gitignore'))).toContain('.agentic/');
  });

  it('is what CLAUDE.md tells a session to use', () => {
    const claudeMd = read(join(ROOT, '.claude/CLAUDE.md'));
    expect(claudeMd).toContain('npm run long -- wait');
    expect(claudeMd).toContain('There is no later turn');
  });
});
