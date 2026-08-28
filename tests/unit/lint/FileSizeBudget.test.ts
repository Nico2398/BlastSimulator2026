// BlastSimulator2026 — file-size budget, enforced here instead of by review
//
// `dev-coding-conventions` caps a code file at 300 lines. Until this test
// existed the cap lived only in prose read by @quality-reviewer, which meant
// it could not fail at write time and was instead re-discovered on every
// pull request and filed as a fresh issue. Eight such issues were filed in
// six days against a standing stock of 166 over-limit files; each split
// spawned its own follow-ups (stale doc references, mirrored tests, residual
// duplication), so the class reproduced faster than it was consumed.
//
// The cap is a growth brake, not a cleanup mandate. This test enforces it as
// a ratchet:
//
//   - a file absent from the baseline must be at or under LINE_LIMIT
//   - a file in the baseline must not exceed its recorded size — existing
//     long files are grandfathered and may only shrink
//   - a baselined file that drops to LINE_LIMIT or below leaves the baseline
//   - a baseline entry whose file is gone leaves the baseline
//
// Because the machine now owns the rule, file length is never issue
// material: a run that trips this test fixes it or shrinks nothing, and no
// follow-up issue is filed for a length the baseline already accepts. See
// `agentic-pipeline-finalization`'s filing gate.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '../../..');

/** Line cap for a code file newly added to a scanned root. */
const LINE_LIMIT = 300;

/**
 * Directories scanned. `tests/` is deliberately absent: a test file grows one
 * independent case at a time, so its length carries no cohesion signal, and
 * splitting one mints near-duplicate fixtures and helpers — trading a length
 * finding for a duplication finding.
 */
const SCAN_ROOTS = ['src', 'scripts'];

const SCANNED_EXTENSIONS = ['.ts', '.tsx'];

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', 'scenario-defs']);

/**
 * Pure data modules: tables whose length tracks how much game there is, not
 * how much responsibility one module carries. Splitting a table by line count
 * makes it harder to read, and ratcheting one blocks the balance edits that
 * every new building, vehicle and material legitimately needs.
 */
const DATA_MODULE_EXEMPTIONS: readonly string[] = [
  'src/core/config/balance.ts',
  'src/ui/tokens.ts',
  'src/ui/styles.ts',
];

const BASELINE_PATH = join(import.meta.dirname, 'file-size-baseline.json');

type Baseline = Record<string, number>;

function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Baseline;
}

function collectFiles(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) acc.push(full);
  }
  return acc;
}

function countLines(path: string): number {
  return readFileSync(path, 'utf-8').split('\n').length;
}

function scan(): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of collectFiles(abs, [])) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (DATA_MODULE_EXEMPTIONS.includes(rel)) continue;
      sizes.set(rel, countLines(file));
    }
  }
  return sizes;
}

describe('file-size budget', () => {
  const baseline = loadBaseline();
  const sizes = scan();

  it('scans the code roots', () => {
    expect(sizes.size).toBeGreaterThan(100);
  });

  it('keeps every file outside the baseline at or under the line limit', () => {
    const over = [...sizes.entries()]
      .filter(([path, lines]) => baseline[path] === undefined && lines > LINE_LIMIT)
      .map(([path, lines]) => `${path} — ${lines} lines (limit ${LINE_LIMIT})`);

    expect(
      over,
      `Split these files, or move a genuine data table into DATA_MODULE_EXEMPTIONS.\n` +
        `Never file an issue for a file length: this test owns the rule.\n${over.join('\n')}`,
    ).toEqual([]);
  });

  it('never lets a grandfathered file grow', () => {
    const grown = [...sizes.entries()]
      .filter(([path, lines]) => baseline[path] !== undefined && lines > baseline[path])
      .map(([path, lines]) => `${path} — ${lines} lines, baseline ${baseline[path]}`);

    expect(
      grown,
      `A file already over the limit may only shrink. Put the addition in a new module.\n${grown.join('\n')}`,
    ).toEqual([]);
  });

  it('holds no baseline entry that has dropped to the limit or been deleted', () => {
    const stale = Object.entries(baseline)
      .filter(([path]) => {
        const lines = sizes.get(path);
        return lines === undefined || lines <= LINE_LIMIT;
      })
      .map(([path]) => `${path} — ${sizes.get(path) ?? 'deleted'}`);

    expect(
      stale,
      `Remove these from tests/unit/lint/file-size-baseline.json — a stale entry re-opens the budget.\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
