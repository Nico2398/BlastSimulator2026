/**
 * BlastSimulator2026 — Run a command longer than one Bash call, inside one turn
 *
 * The Bash tool caps a foreground call at 600s. Three of this project's own
 * required commands sit past that cap or close enough to it that a slower runner
 * crosses it:
 *
 *   npm run test      ~186s   fits
 *   npm run scenarios ~559s   fits in a sandbox, not on a 2-core runner
 *   npm run ci:await  minutes to tens of minutes, by design — it waits on CI
 *
 * So an agent that must run one of these has to detach it and come back. The way
 * it came back is what cost this project three runs in four days. PRs #594, #603
 * and #604 were all rescued branches, and every one of them died on the same
 * shape:
 *
 *   #604  `npm run scenarios` backgrounded, then: "pausing here until it reports
 *         back." The turn ended. 3h11m and $30.55 of completed TDD work, gone.
 *         Its retry repeated the move in 2m51s: "Waiting on test run results
 *         (background monitor armed)."
 *   #594  "Waiting for the background vitest run (task `bip2e4izv`) to complete
 *         — will be notified automatically." It will not. Both attempts.
 *   #603  Avoided ending the turn by hand-rolling
 *         `timeout 280 bash -c 'until ! ps -p <pid>; do sleep 5; done'` — 40+
 *         times. Structurally right, and it still burned the whole 360-minute
 *         job budget polling instead of working, then died on the job timeout
 *         with no budget left for a retry.
 *
 * An unattended run gets one turn. A notification delivered on a later turn is
 * never delivered, because there is no later turn — the same rule
 * `require-foreground-agents.sh` already enforces for delegation (#404, #406),
 * arriving through a shell command instead of through a sub-agent.
 *
 * This is the supported way to do it. `start` detaches and returns immediately;
 * `wait` blocks in the foreground for a bounded slice and reports whether the
 * command finished. A slice that expires is not a verdict — it exits 75, which
 * means *ask again, in this same turn*, and the caller loops on it. Nothing here
 * decides anything on a duration: the verdict is always the command's own exit
 * code, read from disk.
 *
 * Usage:
 *   npm run long -- start scenarios -- npm run scenarios
 *   npm run long -- wait scenarios                    # repeat until it is not 75
 *   npm run long -- wait scenarios --budget-seconds 300
 *   npm run long -- status                            # what is still unfinished
 *   npm run long -- clean                             # drop finished handles
 *
 * Exit codes — the caller branches on these:
 *   0   DONE      the command finished, exit code 0
 *   1   FAILED    the command finished non-zero, or died without reporting
 *   75  RUNNING   this slice is spent and the command is still going. Not a
 *                 verdict. Call `wait` again in this same turn
 *   4   USAGE     bad arguments
 *
 * @module long-run
 */

import { spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from 'fs';
import { join, resolve } from 'path';

/** Where handles live. Gitignored: these are runner-local, never a deliverable. */
export const LONG_DIR = resolve(process.cwd(), '.agentic/long');

/**
 * Default seconds a single `wait` blocks before reporting RUNNING.
 *
 * Not a timeout and not a threshold anything is decided on — it is how much of
 * one Bash call this spends before handing the turn back a still-running answer.
 * Under the tool's own 600s ceiling with room for process startup, so a `wait`
 * always gets to print its own line rather than being killed mid-poll. Raising
 * or lowering it changes how many `wait` calls a long command costs, and nothing
 * else.
 */
export const DEFAULT_BUDGET_SECONDS = 540;

/** How often `wait` looks at the exit file. Cadence, not a verdict. */
const POLL_MS = 2000;

/** Exit code meaning "still running, ask again". `EX_TEMPFAIL`, by convention. */
export const EXIT_RUNNING = 75;

/** A label has to be safe as a filename and readable in a log. */
export const LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface Handle {
  label: string;
  pidPath: string;
  logPath: string;
  exitPath: string;
  cmdPath: string;
}

/**
 * Quotes one argv element for `bash -c`.
 *
 * The command arrives as argv, and joining it with spaces would hand the shell a
 * different command than the caller wrote: `bash -c 'echo hi; exit 3'` joined
 * raw becomes four separate statements. Single quotes with the standard
 * `'\''` escape keep every element exactly one word.
 */
export function shellQuote(argument: string): string {
  return `'${argument.replace(/'/g, `'\\''`)}'`;
}

export function handleFor(label: string, dir: string = LONG_DIR): Handle {
  return {
    label,
    pidPath: join(dir, `${label}.pid`),
    logPath: join(dir, `${label}.log`),
    exitPath: join(dir, `${label}.exit`),
    cmdPath: join(dir, `${label}.cmd`),
  };
}

/** True when the process is still alive. Signal 0 tests without delivering. */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to somebody else — alive either way.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type State =
  | { kind: 'unknown' }
  | { kind: 'running'; pid: number }
  | { kind: 'finished'; code: number }
  /** Gone without writing an exit code: killed, or the runner reaped it. */
  | { kind: 'died'; pid: number };

/**
 * Reads a handle's state off disk.
 *
 * The exit file is written by the detached shell itself, so it is authoritative
 * and it outlives the process. It is checked before liveness deliberately: a
 * command that finished microseconds ago is finished, not dead.
 */
export function readState(handle: Handle): State {
  if (existsSync(handle.exitPath)) {
    const raw = readFileSync(handle.exitPath, 'utf8').trim();
    const code = Number.parseInt(raw, 10);
    return { kind: 'finished', code: Number.isNaN(code) ? 1 : code };
  }
  if (!existsSync(handle.pidPath)) return { kind: 'unknown' };
  const pid = Number.parseInt(readFileSync(handle.pidPath, 'utf8').trim(), 10);
  return isAlive(pid) ? { kind: 'running', pid } : { kind: 'died', pid };
}

/** Every handle that has been started and has not reported an exit code. */
export function unfinished(dir: string = LONG_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.pid'))
    .map((name) => name.slice(0, -'.pid'.length))
    .filter((label) => readState(handleFor(label, dir)).kind === 'running')
    .sort();
}

function tail(path: string, lines: number): string {
  if (!existsSync(path)) return '(no output yet)';
  const content = readFileSync(path, 'utf8').split('\n');
  const slice = content.slice(-lines).join('\n').trimEnd();
  return slice === '' ? '(no output yet)' : slice;
}

function usage(message: string): number {
  console.error(`${message}

Usage:
  npm run long -- start <label> -- <command...>
  npm run long -- wait <label> [--budget-seconds N]
  npm run long -- status
  npm run long -- clean`);
  return 4;
}

function start(label: string, command: string[]): number {
  if (!LABEL_PATTERN.test(label)) {
    return usage(`Not a usable label: \`${label}\`. Letters, digits, dot, dash, underscore.`);
  }
  if (command.length === 0) {
    return usage('No command given. Everything after `--` is the command to run.');
  }

  mkdirSync(LONG_DIR, { recursive: true });
  const handle = handleFor(label);

  const state = readState(handle);
  if (state.kind === 'running') {
    console.error(
      `\`${label}\` is already running (pid ${state.pid}). ` +
      `Wait for it, or start it under another label.`
    );
    return 4;
  }

  // A previous run under this label is replaced, not appended to: a stale exit
  // code left in place would make the next `wait` report success instantly.
  for (const path of [handle.exitPath, handle.logPath, handle.pidPath]) {
    rmSync(path, { force: true });
  }

  const line = command.map(shellQuote).join(' ');
  const fd = openSync(handle.logPath, 'a');

  // The detached shell writes its own exit file. No supervisor process is
  // involved, so nothing has to outlive this call for the result to survive —
  // which is the whole point: `start` returns now, the answer lands on disk
  // whenever the command is done, and `wait` can be called from any later tool
  // call in this turn.
  //
  // The command runs in a subshell so that a command which calls `exit` itself
  // cannot skip the two lines after it. Without the parentheses that exit
  // replaces the wrapper, no exit file is ever written, and `wait` reports DIED
  // for a command that in fact ran to completion.
  const script =
    `( ${line} )\nstatus=$?\nprintf '%s' "$status" > ${shellQuote(handle.exitPath)}\nexit $status\n`;
  const child = spawn('bash', ['-c', script], {
    detached: true,
    stdio: ['ignore', fd, fd],
    cwd: process.cwd(),
  });
  child.unref();
  closeSync(fd);

  if (child.pid === undefined) {
    console.error(`Could not start \`${line}\`.`);
    return 1;
  }

  writeFileSync(handle.pidPath, String(child.pid));
  writeFileSync(handle.cmdPath, line);

  console.log(
    `LONG RUN ${label} STARTED pid=${child.pid}\n` +
    `  command: ${line}\n` +
    `  log:     ${handle.logPath}\n` +
    `▶ This turn is not finished until you have waited for it:\n` +
    `  npm run long -- wait ${label}\n` +
    `  Repeat that call while it exits ${EXIT_RUNNING}. Do not end your turn first — ` +
    `an unattended run has no later turn to be notified in.`
  );
  return 0;
}

async function wait(label: string, budgetSeconds: number): Promise<number> {
  const handle = handleFor(label);
  if (!existsSync(handle.pidPath) && !existsSync(handle.exitPath)) {
    return usage(`No long run called \`${label}\`. Started ones: ${
      existsSync(LONG_DIR)
        ? readdirSync(LONG_DIR).filter((n) => n.endsWith('.pid')).map((n) => n.slice(0, -4)).join(', ') || '(none)'
        : '(none)'
    }`);
  }

  const startedAt = Date.now();
  const command = existsSync(handle.cmdPath) ? readFileSync(handle.cmdPath, 'utf8') : label;

  for (;;) {
    const state = readState(handle);

    if (state.kind === 'finished') {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(tail(handle.logPath, 200));
      console.log(
        `\nLONG RUN ${label} FINISHED exit=${state.code} (waited ${elapsed}s in this call)\n` +
        `  command: ${command}\n` +
        `  log:     ${handle.logPath}`
      );
      return state.code === 0 ? 0 : 1;
    }

    if (state.kind === 'died' || state.kind === 'unknown') {
      console.log(tail(handle.logPath, 200));
      console.log(
        `\nLONG RUN ${label} DIED — the process is gone and wrote no exit code.\n` +
        `  command: ${command}\n` +
        `  Treat this as a failure of that command, not as a result. Re-run it.`
      );
      return 1;
    }

    if (Date.now() - startedAt >= budgetSeconds * 1000) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(tail(handle.logPath, 40));
      console.log(
        `\nLONG RUN ${label} STILL RUNNING after ${elapsed}s of this call (pid ${state.pid}).\n` +
        `  command: ${command}\n` +
        `▶ Not a verdict — nothing has failed. Call \`npm run long -- wait ${label}\` ` +
        `again, in this same turn, until it reports FINISHED.`
      );
      return EXIT_RUNNING;
    }

    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

function status(): number {
  const pending = unfinished();
  if (pending.length === 0) {
    console.log('No long run is unfinished.');
    return 0;
  }
  console.log(`Unfinished long run(s): ${pending.join(', ')}`);
  for (const label of pending) {
    const handle = handleFor(label);
    const command = existsSync(handle.cmdPath) ? readFileSync(handle.cmdPath, 'utf8') : '(unknown)';
    console.log(`  ${label}: ${command}`);
  }
  return 1;
}

function clean(): number {
  if (!existsSync(LONG_DIR)) return 0;
  const pending = new Set(unfinished());
  let removed = 0;
  for (const name of readdirSync(LONG_DIR)) {
    const label = name.replace(/\.(pid|log|exit|cmd)$/, '');
    if (pending.has(label)) continue;
    rmSync(join(LONG_DIR, name), { force: true });
    removed += 1;
  }
  console.log(`Removed ${removed} finished handle file(s).`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case 'start': {
      const separator = rest.indexOf('--');
      if (separator === -1) {
        return usage('`start` needs `--` between the label and the command.');
      }
      const [label, ...extra] = rest.slice(0, separator);
      if (label === undefined || extra.length > 0) {
        return usage('`start` takes exactly one label before `--`.');
      }
      return start(label, rest.slice(separator + 1));
    }
    case 'wait': {
      const label = rest[0];
      if (label === undefined) return usage('`wait` needs a label.');
      let budget = DEFAULT_BUDGET_SECONDS;
      const flag = rest.indexOf('--budget-seconds');
      if (flag !== -1) {
        const value = Number.parseInt(rest[flag + 1] ?? '', 10);
        if (!Number.isFinite(value) || value <= 0) {
          return usage('`--budget-seconds` needs a positive number of seconds.');
        }
        budget = value;
      }
      return wait(label, budget);
    }
    case 'status':
      return status();
    case 'clean':
      return clean();
    default:
      return usage(subcommand === undefined ? 'No subcommand given.' : `Unknown subcommand: ${subcommand}`);
  }
}

// Guarded so the unit tests can import the helpers above without running a poll
// loop, matching `await-pr-ci.ts`'s own entry guard.
if (process.argv[1] !== undefined && process.argv[1].endsWith('long-run.ts')) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
