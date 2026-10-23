/**
 * BlastSimulator2026 — Run the verification channels a change owes, quietly
 *
 * Replaces the validator agent and the scattered `[test-runner]` steps. Three
 * things make it cheap:
 *
 * - **Only owed channels run.** `channelsFor` reads the diff; a context-only
 *   change never pays for the 270-second suite.
 * - **A tree that already passed is not re-run.** Results are cached against
 *   the committed tree hash, so running `verify` after a no-op refactor, or a
 *   second time before opening the PR, costs nothing. A dirty working tree has
 *   no hash and is never cached.
 * - **Output stays on disk.** Each channel writes its log under
 *   `.agentic/verify/logs/`; stdout carries one line per channel and, for a
 *   red one, an excerpt from the first failure — not the thousands of lines a
 *   full Vitest run prints into a model's context.
 *
 * @module pipeline/verify
 */

import { spawnSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { branchChanges, cleanTreeHash, gitSucceeds } from './git.js';
import { CHANNEL_COMMANDS, CHANNEL_ORDER, channelsFor, isPlayerFacing, type Channel } from './paths.js';

interface VerifyOptions {
  base?: string | undefined;
  only?: Channel[] | undefined;
  noCache?: boolean | undefined;
  /** Told when each channel starts, so a `long wait` poll shows where the run is. */
  progress?: ((line: string) => void) | undefined;
}

interface ChannelResult {
  channel: Channel;
  status: 'pass' | 'fail' | 'cached' | 'skipped';
  seconds: number;
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

function cachePath(root: string, tree: string): string {
  return join(root, '.agentic', 'verify', `${tree}.json`);
}

function readCache(root: string, tree: string | undefined): Partial<Record<Channel, 'pass'>> {
  if (!tree || !existsSync(cachePath(root, tree))) return {};
  return JSON.parse(readFileSync(cachePath(root, tree), 'utf8')) as Partial<Record<Channel, 'pass'>>;
}

function writeCache(root: string, tree: string, cache: Partial<Record<Channel, 'pass'>>): void {
  mkdirSync(join(root, '.agentic', 'verify'), { recursive: true });
  writeFileSync(cachePath(root, tree), `${JSON.stringify(cache)}\n`);
}

function runChannel(root: string, channel: Channel, commands: string[][]): ChannelResult {
  const logDir = join(root, '.agentic', 'verify', 'logs');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${channel}.log`);
  writeFileSync(log, '');
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

  for (const channel of CHANNEL_ORDER.filter((c) => channels.includes(c))) {
    if (cache[channel] === 'pass') {
      results.push({ channel, status: 'cached', seconds: 0 });
      continue;
    }
    if (channel === 'scenario' && results.some((r) => r.status === 'fail')) {
      results.push({ channel, status: 'skipped', seconds: 0 });
      continue;
    }
    // `logic` already runs the suites `context` would run on its own.
    const commands = channel === 'context' && channels.includes('logic') ? CHANNEL_COMMANDS.context.slice(0, 1) : CHANNEL_COMMANDS[channel];
    options.progress?.(`running ${channel}: ${commands.map((c) => c.join(' ')).join(' && ')}`);
    const result = runChannel(root, channel, commands);
    results.push(result);
    if (result.status === 'pass' && tree) writeCache(root, tree, { ...readCache(root, tree), [channel]: 'pass' });
  }

  const lines = [`Changed vs ${base}: ${changed.length} files. Channels owed: ${channels.join(', ') || 'none'}.`];
  for (const result of results) {
    const label = { pass: 'PASS', fail: 'FAIL', cached: 'PASS (cached: this exact tree already passed)', skipped: 'SKIPPED (an earlier channel is red)' }[result.status];
    lines.push(`${label} ${result.channel}${result.seconds ? ` ${result.seconds}s` : ''}${result.status === 'fail' ? ` — full log: ${result.log}` : ''}`);
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
