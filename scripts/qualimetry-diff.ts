/**
 * BlastSimulator2026 — Duplication gate for the introduced diff
 *
 * `npm run qualimetry` answers "how duplicated is the codebase", and holds the
 * whole tree under a tight threshold. It cannot answer "how duplicated is the
 * change in front of me": a 900-line codebase clone budget absorbs a 40-line
 * copy-paste without moving the number, so a change can be waved through by a
 * gate that is measuring something else.
 *
 * This script measures the change. It runs jscpd over the same scope the
 * repo-wide gate uses, then keeps only the clones that overlap lines this
 * branch actually added or edited, and reports what share of those lines sit
 * inside a clone.
 *
 * Both halves matter and neither substitutes for the other:
 *   - scanning only the changed files (what the pipeline's qualimetry step
 *     does) compares them against each other and misses the common case — a
 *     new file that is a copy of an existing, untouched one.
 *   - scanning the whole tree without the diff filter re-reports inherited
 *     duplication as though this branch wrote it.
 * So: detect across the whole tree, attribute against the diff.
 *
 * Usage:
 *   npx tsx scripts/qualimetry-diff.ts
 *   npx tsx scripts/qualimetry-diff.ts --base origin/main --threshold 10
 *   npx tsx scripts/qualimetry-diff.ts --json
 *
 * Exit code: 0 when the duplicated share of the changed lines is at or under
 * the threshold (or nothing in scope changed), 1 when it is over, 2 when the
 * comparison could not be made — an unreachable base ref fails the gate rather
 * than passing it silently.
 *
 * @module qualimetry-diff
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(import.meta.dirname, '..');

/** Default ceiling: the share of changed lines allowed to sit inside a clone. */
const DEFAULT_THRESHOLD = 10;

/** Scanned scope, kept in step with `.jscpd.json`'s own `path`. */
const SCOPE = ['src/', 'scripts/'];

interface ChangedLines {
  /** 1-based line numbers added or edited in this file, on the head side. */
  lines: Set<number>;
}

interface CloneSide { name: string; start: number; end: number }
interface Clone { a: CloneSide; b: CloneSide }

export interface DiffDuplicationReport {
  changedFiles: number;
  changedLines: number;
  duplicatedLines: number;
  percentage: number;
  /** Per changed file: which of its changed lines are duplicated, and against what. */
  hits: { file: string; lines: number; against: string[] }[];
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** True for a file the repo-wide gate would scan: TypeScript, in scope, not a test. */
function inScope(file: string): boolean {
  if (!file.endsWith('.ts')) return false;
  if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) return false;
  return SCOPE.some(dir => file.startsWith(dir));
}

/**
 * Head-side line numbers this branch added or edited, per file, read from
 * `git diff -U0`. Deleted lines have no head-side counterpart and cannot be
 * duplicated by anything, so only the `+` side of each hunk is collected.
 */
export function collectChangedLines(diffOutput: string): Map<string, ChangedLines> {
  const changed = new Map<string, ChangedLines>();
  let current: ChangedLines | null = null;

  for (const line of diffOutput.split('\n')) {
    const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fileMatch) {
      const file = fileMatch[1]!;
      if (inScope(file)) {
        current = { lines: new Set() };
        changed.set(file, current);
      } else {
        current = null;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i++) current.lines.add(start + i);
    }
  }
  for (const [file, entry] of [...changed]) {
    if (entry.lines.size === 0) changed.delete(file);
  }
  return changed;
}

/** Runs the repo's own jscpd config, with the threshold neutralised — this gate owns the verdict. */
function detectClones(): Clone[] {
  const out = mkdtempSync(join(tmpdir(), 'jscpd-diff-'));
  try {
    execFileSync(
      'npx',
      ['jscpd', '--config', '.jscpd.json', '--reporters', 'json', '--output', out, '--threshold', '100', '--silent'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const report = JSON.parse(readFileSync(join(out, 'jscpd-report.json'), 'utf8')) as {
      duplicates: {
        firstFile: { name: string; startLoc: { line: number }; endLoc: { line: number } };
        secondFile: { name: string; startLoc: { line: number }; endLoc: { line: number } };
      }[];
    };
    return report.duplicates.map(d => ({
      a: { name: normalise(d.firstFile.name), start: d.firstFile.startLoc.line, end: d.firstFile.endLoc.line },
      b: { name: normalise(d.secondFile.name), start: d.secondFile.startLoc.line, end: d.secondFile.endLoc.line },
    }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function normalise(name: string): string {
  return relative(ROOT, resolve(ROOT, name)).split('\\').join('/');
}

/** Attributes each clone to the changed lines it covers, and totals the result. */
export function attribute(changed: Map<string, ChangedLines>, clones: Clone[]): DiffDuplicationReport {
  const dupPerFile = new Map<string, { lines: Set<number>; against: Set<string> }>();

  for (const clone of clones) {
    for (const [side, other] of [[clone.a, clone.b], [clone.b, clone.a]] as const) {
      const entry = changed.get(side.name);
      if (!entry) continue;
      let bucket = dupPerFile.get(side.name);
      if (!bucket) {
        bucket = { lines: new Set(), against: new Set() };
        dupPerFile.set(side.name, bucket);
      }
      let covered = false;
      for (let line = side.start; line <= side.end; line++) {
        if (entry.lines.has(line)) { bucket.lines.add(line); covered = true; }
      }
      if (covered) bucket.against.add(`${other.name}:${other.start}-${other.end}`);
    }
  }

  let changedLines = 0;
  for (const entry of changed.values()) changedLines += entry.lines.size;

  let duplicatedLines = 0;
  const hits: DiffDuplicationReport['hits'] = [];
  for (const [file, bucket] of dupPerFile) {
    if (bucket.lines.size === 0) continue;
    duplicatedLines += bucket.lines.size;
    hits.push({ file, lines: bucket.lines.size, against: [...bucket.against].sort() });
  }
  hits.sort((x, y) => y.lines - x.lines);

  return {
    changedFiles: changed.size,
    changedLines,
    duplicatedLines,
    percentage: changedLines === 0 ? 0 : Math.round((duplicatedLines / changedLines) * 10000) / 100,
    hits,
  };
}

function resolveBase(explicit?: string): string {
  if (explicit) return explicit;
  const baseRef = process.env['GITHUB_BASE_REF'];
  return baseRef ? `origin/${baseRef}` : 'origin/main';
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const baseArg = argv[argv.indexOf('--base') + 1];
  const thresholdArg = argv[argv.indexOf('--threshold') + 1];
  const base = resolveBase(argv.includes('--base') ? baseArg : undefined);
  const threshold = argv.includes('--threshold') ? Number(thresholdArg) : DEFAULT_THRESHOLD;

  if (!Number.isFinite(threshold) || threshold < 0) {
    console.error(`qualimetry-diff: --threshold must be a non-negative number, got "${thresholdArg}"`);
    process.exit(2);
  }

  let mergeBase: string;
  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim();
  } catch {
    // Fail closed: a base we cannot read is not a clean diff, it is no diff.
    console.error(
      `qualimetry-diff: cannot resolve "${base}". Fetch it first `
      + '(actions/checkout needs fetch-depth: 0), or pass --base <ref>.',
    );
    process.exit(2);
  }

  const changed = collectChangedLines(git(['diff', '-U0', `${mergeBase}..HEAD`, '--', ...SCOPE]));
  if (changed.size === 0) {
    console.log(`No src/ or scripts/ TypeScript changed against ${base} — diff duplication gate passes trivially.`);
    process.exit(0);
  }

  const report = attribute(changed, detectClones());

  if (asJson) {
    console.log(JSON.stringify({ base, threshold, ...report }, null, 2));
  } else {
    console.log(`Diff duplication vs ${base} (${mergeBase.slice(0, 8)})`);
    console.log(`  changed files : ${report.changedFiles}`);
    console.log(`  changed lines : ${report.changedLines}`);
    console.log(`  duplicated    : ${report.duplicatedLines} (${report.percentage}%)`);
    console.log(`  threshold     : ${threshold}%`);
    if (report.hits.length > 0) {
      console.log('\nDuplicated lines introduced, by file:');
      for (const hit of report.hits) {
        console.log(`  ${hit.file} — ${hit.lines} line(s)`);
        for (const against of hit.against) console.log(`      clones ${against}`);
      }
    }
  }

  const failed = report.percentage > threshold;
  if (!asJson) {
    console.log(
      failed
        ? `\nFAILED — ${report.percentage}% of the changed lines are duplicated, over the ${threshold}% ceiling.`
        : `\nOK — ${report.percentage}% of the changed lines are duplicated, at or under the ${threshold}% ceiling.`,
    );
  }
  process.exit(failed ? 1 : 0);
}

// Run only when invoked as a CLI; imported by its unit test, the module stays
// side-effect free — main() ends in process.exit().
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) main();
