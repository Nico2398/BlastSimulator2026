// BlastSimulator2026 — repo-wide: no dead code
//
// `tsc` already refuses unused locals, parameters and imports
// (`noUnusedLocals`/`noUnusedParameters`), so dead code *inside* a file cannot
// survive a typecheck. This covers the layer above: the module graph, where a
// file nobody imports and an export nobody imports both typecheck perfectly.
// A 46-line table of typed i18n key constants sat there, imported by nothing,
// until this check went looking; deleting it is what made the first gate below
// pass at zero.
//
// Two gates, because the two findings differ in kind:
//
//   Unused files are held at zero. A file nothing imports is not partly dead,
//   and there is no version of the codebase where keeping one is right.
//
//   Unused exports are held against a baseline. There are 246 of them, mostly
//   types and constants used inside their own file and exported out of habit,
//   so the code behind them is alive and only the `export` is not. Fixing all
//   246 is its own job; what must not happen meanwhile is a 247th. The
//   baseline shrinks and never grows, and a stale entry fails too — so
//   removing an export means removing its line.
//
// The analysis is in scripts/dead-code.ts (`npm run check:dead-code`), which
// parses with the TypeScript compiler API and deliberately stays quiet about
// anything it cannot prove: a namespace import or a star re-export marks the
// whole module used.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findDeadCode } from '../../../scripts/dead-code.js';

const BASELINE_PATH = resolve(import.meta.dirname, 'dead-code-baseline.json');

interface Baseline { unusedExports: string[] }

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
const report = findDeadCode();

describe('repo-wide — no dead code', () => {
  it('every file under src/ and scripts/ is imported by something', () => {
    expect(
      report.unusedFiles,
      report.unusedFiles.length === 0 ? '' :
        `${report.unusedFiles.length} file(s) nothing imports:\n`
        + report.unusedFiles.map(f => `  ${f}`).join('\n')
        + '\n\nDelete them. If something reaches one in a way the module graph cannot show'
        + ' (a bare `window` assignment, an HTML script tag), add it to ALWAYS_LIVE in'
        + ' scripts/dead-code.ts with the reason.',
    ).toEqual([]);
  });

  it('introduces no export that nothing imports', () => {
    const known = new Set(baseline.unusedExports);
    const added = report.unusedExports.filter(e => !known.has(e));
    expect(
      added,
      added.length === 0 ? '' :
        `${added.length} new unused export(s):\n` + added.map(e => `  ${e}`).join('\n')
        + '\n\nDrop the `export` keyword (the symbol stays, its module surface shrinks),'
        + ' delete the symbol if nothing uses it at all, or import it where it was meant'
        + ' to be used.',
    ).toEqual([]);
  });

  // The other half of a ratchet: without this the baseline would record
  // exports that were cleaned up years ago, and its count would stop meaning
  // anything.
  it('carries no baseline entry that is already clean', () => {
    const current = new Set(report.unusedExports);
    const stale = baseline.unusedExports.filter(e => !current.has(e));
    expect(
      stale,
      stale.length === 0 ? '' :
        `${stale.length} baseline entr(ies) no longer unused — delete these lines from`
        + ` tests/unit/lint/dead-code-baseline.json:\n` + stale.map(e => `  ${e}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the baseline shrinking, never growing', () => {
    // Pins the count so a bulk re-generation of the baseline cannot quietly
    // raise the ceiling: lowering this number is the only allowed edit.
    expect(baseline.unusedExports.length).toBeLessThanOrEqual(246);
  });
});
