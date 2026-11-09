/**
 * BlastSimulator2026 — Run the verification channels a change owes, quietly
 *
 * Replaces the validator agent and the scattered `[test-runner]` steps. Four
 * things make it cheap:
 *
 * - **Only owed channels run.** `channelsFor` reads the diff; a context-only
 *   change never pays for the test suite.
 * - **`logic` is a focused pre-flight, not a second CI.** It runs the test
 *   files the diff can plausibly break (`test-selection.ts`) — the full suite,
 *   734 s wall on a 4-core box, is CI's, which runs it sharded on every pull
 *   request head while the run waits in-session. Running it locally five to
 *   seven times per run was 49 of 159 measured wall-hours (58 runs on the
 *   `agentic-metrics` branch) and put #2142, #2143, #2148, #2154 and #2199 past
 *   the 270-minute timeout. `--full` asks for the whole suite explicitly.
 * - **A tree that already passed is not re-run.** Results are cached against
 *   the committed tree hash, so running `verify` after a no-op refactor, or a
 *   second time before opening the PR, costs nothing. A dirty working tree has
 *   no hash and is never cached. A focused `logic` pass is recorded apart from
 *   a full one, and never answers `--full`.
 * - **Output stays on disk.** Each channel writes its log under
 *   `.agentic/verify/logs/`; stdout carries one line per channel and, for a
 *   red one, an excerpt from the first failure — not the thousands of lines a
 *   full Vitest run prints into a model's context. The focused selection's
 *   file list, with the reason for each file, is in the `logic` log too.
 *
 * @module pipeline/verify
 */

import { spawnSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { branchChanges, cleanTreeHash, git, gitSucceeds } from './git.js';
import { CHANNEL_COMMANDS, CHANNEL_ORDER, channelsFor, isPlayerFacing, type Channel } from './paths.js';
import { describeSelection, planLogic, selectionLog, type TestSelection } from './test-selection.js';

interface VerifyOptions {
  base?: string | undefined;
  only?: Channel[] | undefined;
  noCache?: boolean | undefined;
  /** Run the whole Vitest suite in `logic` rather than the focused selection. */
  full?: boolean | undefined;
  /** Told when each channel starts, so a `long wait` poll shows where the run is. */
  progress?: ((line: string) => void) | undefined;
}

interface ChannelResult {
  channel: Channel;
  status: 'pass' | 'fail' | 'cached' | 'skipped';
  seconds: number;
  /** What ran, when it is worth a word on the channel's line: the focused selection. */
  detail?: string;
  log?: string;
  excerpt?: string[];
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
/** Where a tool's own failure report starts: Vitest's summary, a tsc error, an npm error. */
const FAILURE_REPORT = /(⎯ Failed Tests \d+|^\s*FAIL\s|error TS\d+|npm ERR!|^\s*(✗|×)\s)/;
/** Anything that merely looks like a failure — a test name, a logged line. The fallback. */
const FAILURE_LINE = /(AssertionError|Error:|\bFAILED\b|\bfailed\b)/;

/**
 * The part of a red channel's log worth reading: from where the tool's own
 * failure report starts (or, failing that, the first line that looks like a
 * failure), capped, plus the log's last lines, where Vitest and tsc print their
 * totals. A passing test named "…logs the FAILED line" is not where to start.
 */
export function failureExcerpt(log: string, maxLines = 60, tailLines = 8): string[] {
  const lines = log.replace(ANSI, '').split('\n').map((line) => line.trimEnd()).filter((line) => line !== '');
  const report = lines.findIndex((line) => FAILURE_REPORT.test(line));
  const first = report !== -1 ? report : lines.findIndex((line) => FAILURE_LINE.test(line));
  const head = first === -1 ? [] : lines.slice(first, first + maxLines);
  const tailStart = Math.max(lines.length - tailLines, first === -1 ? 0 : first + head.length);
  const tail = lines.slice(tailStart);
  return head.length > 0 && tail.length > 0 && tailStart > first + head.length ? [...head, '…', ...tail] : [...head, ...tail];
}

/**
 * What one tree's cache file records. A channel name is a pass of that
 * channel in full — for `logic`, the whole suite. A focused `logic` pass is
 * `logic@<fork point>`: the selection is a function of the diff, so the same
 * tree measured against another base is another selection.
 */
export type VerifyCache = Partial<Record<Channel | `logic@${string}`, 'pass'>>;

/** How `logic` runs this time. */
export interface LogicMode {
  full: boolean;
  /** Where its pass is recorded. */
  key: keyof VerifyCache;
}

/** The cache key a focused `logic` pass on a branch forked at `forkPoint` is recorded under. */
export function focusedLogicKey(forkPoint: string): `logic@${string}` {
  return `logic@${forkPoint}`;
}

/**
 * The mode a cached `logic` pass answers this request with, if any. A full
 * pass answers a focused request too; a focused pass never answers `--full`.
 */
export function cachedLogic(cache: VerifyCache, full: boolean, forkPoint: string): LogicMode | undefined {
  if (cache.logic === 'pass') return { full: true, key: 'logic' };
  if (!full && cache[focusedLogicKey(forkPoint)] === 'pass') return { full: false, key: focusedLogicKey(forkPoint) };
  return undefined;
}

/**
 * Whether `context` may drop its Vitest half (`tests/unit/config`,
 * `tests/unit/lint`) because `logic` covers it: only a full `logic` run holds
 * those suites whole. A focused one holds `tests/unit/lint` but only the
 * config suites the diff reaches, so `context` keeps its own.
 */
export function contextSubsumedBy(logic: LogicMode | undefined): boolean {
  return logic?.full === true;
}

function cachePath(root: string, tree: string): string {
  return join(root, '.agentic', 'verify', `${tree}.json`);
}

function readCache(root: string, tree: string | undefined): VerifyCache {
  if (!tree || !existsSync(cachePath(root, tree))) return {};
  return JSON.parse(readFileSync(cachePath(root, tree), 'utf8')) as VerifyCache;
}

function writeCache(root: string, tree: string, cache: VerifyCache): void {
  mkdirSync(join(root, '.agentic', 'verify'), { recursive: true });
  writeFileSync(cachePath(root, tree), `${JSON.stringify(cache)}\n`);
}

function runChannel(root: string, channel: Channel, commands: string[][], preamble: string[] = []): ChannelResult {
  const logDir = join(root, '.agentic', 'verify', 'logs');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${channel}.log`);
  writeFileSync(log, preamble.map((line) => `${line}\n`).join(''));
  const started = Date.now();
  for (const [command, ...args] of commands) {
    appendFileSync(log, `$ ${[command, ...args].join(' ')}\n`);
    const result = spawnSync(command!, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '1' },
      shell: process.platform === 'win32',
    });
    appendFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    if (result.status !== 0) {
      return {
        channel,
        status: 'fail',
        seconds: Math.round((Date.now() - started) / 1000),
        log,
        excerpt: failureExcerpt(readFileSync(log, 'utf8')),
      };
    }
  }
  return { channel, status: 'pass', seconds: Math.round((Date.now() - started) / 1000), log };
}

/** How the `logic` channel runs when it is not answered from the cache. */
interface LogicPlan {
  mode: LogicMode;
  commands: string[][];
  /** The one-line account printed on the channel's line. */
  detail: string;
  /** The selection, file by file, for the channel log. */
  log: string[];
}

/** The focused selection as a Vitest command, or the full suite when the selection says so. */
export function logicPlanFor(selection: TestSelection, forkPoint: string): LogicPlan {
  if (selection.full) return { mode: { full: true, key: 'logic' }, commands: CHANNEL_COMMANDS.logic, detail: describeSelection(selection), log: selectionLog(selection) };
  return {
    mode: { full: false, key: focusedLogicKey(forkPoint) },
    commands: selection.files.length === 0 ? [] : [['npx', 'vitest', 'run', '--reporter=dot', ...selection.files]],
    detail: `${describeSelection(selection)}; the full suite is CI's`,
    log: selectionLog(selection),
  };
}

function fullLogicPlan(reason: string): LogicPlan {
  return { mode: { full: true, key: 'logic' }, commands: CHANNEL_COMMANDS.logic, detail: `full suite (${reason})`, log: [`# logic — full suite (${reason})`] };
}

function planLogicRun(root: string, forkPoint: string, changed: string[], full: boolean): LogicPlan {
  if (full) return fullLogicPlan('--full');
  try {
    return logicPlanFor(planLogic(root, forkPoint, changed), forkPoint);
  } catch (error) {
    // A selection that cannot be computed verifies more, never less.
    return fullLogicPlan(`the focused selection failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
}

function defaultBase(root: string): string {
  return gitSucceeds(root, 'rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main';
}

/** Run every owed channel and return one line per channel plus the verdict. */
export function verify(root: string, options: VerifyOptions = {}): { ok: boolean; lines: string[] } {
  const base = options.base ?? defaultBase(root);
  const changed = branchChanges(root, base);
  const channels = options.only ?? channelsFor(changed);
  const tree = options.noCache ? undefined : cleanTreeHash(root);
  const cache = readCache(root, tree);
  const results: ChannelResult[] = [];

  // `logic` is settled first: whether it runs in full decides how much `context` runs.
  const forkPoint = git(root, 'merge-base', base, 'HEAD');
  const cachedLogicMode = channels.includes('logic') ? cachedLogic(cache, options.full === true, forkPoint) : undefined;
  const logicPlan = channels.includes('logic') && cachedLogicMode === undefined ? planLogicRun(root, forkPoint, changed, options.full === true) : undefined;
  const logicMode = cachedLogicMode ?? logicPlan?.mode;

  for (const channel of CHANNEL_ORDER.filter((c) => channels.includes(c))) {
    if (channel === 'logic' ? cachedLogicMode !== undefined : cache[channel] === 'pass') {
      const detail = channel === 'logic' ? (cachedLogicMode?.full ? 'full suite' : 'focused selection') : undefined;
      results.push({ channel, status: 'cached', seconds: 0, ...(detail ? { detail } : {}) });
      continue;
    }
    if (channel === 'scenario' && results.some((r) => r.status === 'fail')) {
      results.push({ channel, status: 'skipped', seconds: 0 });
      continue;
    }
    // A full `logic` run already holds the suites `context` would run on its
    // own, so a reduced `context` is cached only once that full run passes.
    const reduced = channel === 'context' && contextSubsumedBy(logicMode);
    const commands = channel === 'logic' ? logicPlan!.commands : reduced ? CHANNEL_COMMANDS.context.slice(0, 1) : CHANNEL_COMMANDS[channel];
    const shown = channel === 'logic' ? logicPlan!.detail : commands.map((c) => c.join(' ')).join(' && ');
    options.progress?.(`running ${channel}: ${shown}`);
    const result = runChannel(root, channel, commands, channel === 'logic' ? logicPlan!.log : []);
    results.push(channel === 'logic' ? { ...result, detail: logicPlan!.detail } : result);
    if (result.status === 'pass' && tree && !reduced) {
      writeCache(root, tree, { ...readCache(root, tree), [channel === 'logic' ? logicPlan!.mode.key : channel]: 'pass' });
    }
  }
  const passed = (channel: Channel) => results.some((r) => r.channel === channel && (r.status === 'pass' || r.status === 'cached'));
  if (tree && passed('context') && passed('logic') && contextSubsumedBy(logicMode)) writeCache(root, tree, { ...readCache(root, tree), context: 'pass' });

  const lines = [`Changed vs ${base}: ${changed.length} files. Channels owed: ${channels.join(', ') || 'none'}.`];
  for (const result of results) {
    const label = { pass: 'PASS', fail: 'FAIL', cached: 'PASS (cached: this exact tree already passed)', skipped: 'SKIPPED (an earlier channel is red)' }[result.status];
    const detail = result.detail ? ` — ${result.detail}` : '';
    lines.push(`${label} ${result.channel}${result.seconds ? ` ${result.seconds}s` : ''}${detail}${result.status === 'fail' ? ` — full log: ${result.log}` : ''}`);
    for (const line of result.excerpt ?? []) lines.push(`    ${line}`);
  }
  if (changed.some(isPlayerFacing)) {
    lines.push('OWED visual — player-facing files changed: the visual-tester reads screenshots; CI runs the interaction shards.');
  }
  const failed = results.filter((r) => r.status === 'fail' || r.status === 'skipped').map((r) => r.channel);
  lines.push(failed.length === 0 ? 'VERIFY: PASS' : `VERIFY: FAIL (${failed.join(', ')})`);
  mkdirSync(join(root, '.agentic', 'verify'), { recursive: true });
  writeFileSync(join(root, '.agentic', 'verify', 'last.txt'), `${lines.filter((l) => !l.startsWith('    ')).join('\n')}\n`);
  return { ok: failed.length === 0, lines };
}
