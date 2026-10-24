/**
 * BlastSimulator2026 — Append run records to the `agentic-metrics` branch
 *
 * Artifacts expire; decisions about the pipeline need months of runs. So every
 * runner appends its records to `runs.jsonl` on an orphan branch that holds
 * nothing else. Two properties make that safe unattended:
 *
 * - **Idempotent by identity.** A record whose `sessionId` is already in the
 *   file is not appended again, so a re-run job or a retried step adds nothing.
 * - **A bounded push race.** Parallel runs push to the same branch; a rejected
 *   push re-fetches and re-applies, at most `attempts` times — a counter, not
 *   a clock.
 *
 * @module metrics/publish
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const FILE = 'runs.jsonl';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Lines of `records` whose session is not already in `existing`. */
export function newLines(existing: string, records: string[]): string[] {
  const seen = new Set<string>();
  for (const line of existing.split('\n')) {
    const match = /"sessionId":"([^"]+)"/.exec(line);
    if (match) seen.add(match[1]!);
  }
  const fresh: string[] = [];
  for (const record of records) {
    const match = /"sessionId":"([^"]+)"/.exec(record);
    if (!match || seen.has(match[1]!)) continue;
    seen.add(match[1]!);
    fresh.push(record);
  }
  return fresh;
}

interface PublishOptions {
  /** Directory of one-line `.json` records, as `extract` writes them. */
  dir: string;
  remote: string;
  branch?: string;
  attempts?: number;
}

/** Append the records to the branch. Returns how many lines it added. */
export function publish(options: PublishOptions): number {
  const branch = options.branch ?? 'agentic-metrics';
  const attempts = options.attempts ?? 5;
  const records = existsSync(options.dir)
    ? readdirSync(options.dir).filter((f) => f.endsWith('.json')).sort().map((f) => readFileSync(join(options.dir, f), 'utf8').trim()).filter(Boolean)
    : [];
  if (records.length === 0) return 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const work = mkdtempSync(join(tmpdir(), 'agentic-metrics-'));
    try {
      git(work, 'init', '-q');
      git(work, 'remote', 'add', 'origin', options.remote);
      const exists = git(work, 'ls-remote', '--heads', 'origin', branch) !== '';
      if (exists) {
        git(work, 'fetch', '-q', '--depth', '1', 'origin', branch);
        git(work, 'checkout', '-q', '-b', branch, 'FETCH_HEAD');
      } else {
        git(work, 'checkout', '-q', '--orphan', branch);
      }
      const path = join(work, FILE);
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const fresh = newLines(existing, records);
      if (fresh.length === 0) return 0;
      writeFileSync(path, `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${fresh.join('\n')}\n`);
      git(work, 'add', FILE);
      git(work, '-c', 'user.name=agentic-metrics', '-c', 'user.email=agentic-metrics@users.noreply.github.com', 'commit', '-q', '-m', `metrics: ${fresh.length} session(s)`);
      try {
        git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
        return fresh.length;
      } catch (error) {
        if (attempt === attempts) throw error;
        // Another run pushed first: start over from its tip.
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return 0;
}
