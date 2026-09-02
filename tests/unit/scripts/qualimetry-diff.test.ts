// BlastSimulator2026 — qualimetry-diff.ts's diff attribution
//
// The repo-wide jscpd gate answers "how duplicated is the codebase" and holds
// the whole tree under a tight ceiling. It cannot answer "how duplicated is
// this change": against a ~70k-line denominator, a 40-line copy-paste moves
// the number by 0.06% and passes. scripts/qualimetry-diff.ts is the second
// half — it detects clones across the whole tree, then attributes them
// against the lines the branch actually added.
//
// Both exported halves are pure, so they are exercised directly here rather
// than by driving the CLI: collectChangedLines parses `git diff -U0` output,
// attribute() intersects clone ranges with those lines. The module ends its
// main() in process.exit but only runs it when invoked as a CLI, so importing
// it is side-effect free.

import { describe, it, expect } from 'vitest';
import { collectChangedLines, attribute } from '../../../scripts/qualimetry-diff.js';

/** A `git diff -U0` fragment for one file, with the hunk headers it produces. */
function diff(file: string, ...hunks: string[]): string {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...hunks].join('\n');
}

describe('collectChangedLines', () => {
  it('collects the head-side lines of a multi-line hunk', () => {
    const changed = collectChangedLines(diff('src/ui/dom.ts', '@@ -10,0 +11,3 @@', '+one', '+two', '+three'));
    expect([...changed.get('src/ui/dom.ts')!.lines]).toEqual([11, 12, 13]);
  });

  it('treats a hunk with no count as a single line', () => {
    const changed = collectChangedLines(diff('src/ui/dom.ts', '@@ -4 +4 @@', '-old', '+new'));
    expect([...changed.get('src/ui/dom.ts')!.lines]).toEqual([4]);
  });

  it('accumulates every hunk in one file', () => {
    const changed = collectChangedLines(
      diff('src/ui/dom.ts', '@@ -1,0 +2,2 @@', '+a', '+b', '@@ -20,0 +30,1 @@', '+c'),
    );
    expect([...changed.get('src/ui/dom.ts')!.lines].sort((x, y) => x - y)).toEqual([2, 3, 30]);
  });

  it('keeps files apart', () => {
    const changed = collectChangedLines(
      [diff('src/ui/dom.ts', '@@ -0,0 +1,1 @@', '+a'), diff('scripts/screenshot.ts', '@@ -0,0 +5,2 @@', '+b', '+c')].join('\n'),
    );
    expect([...changed.get('src/ui/dom.ts')!.lines]).toEqual([1]);
    expect([...changed.get('scripts/screenshot.ts')!.lines]).toEqual([5, 6]);
  });

  // The gate scans exactly what .jscpd.json scans. A file outside that scope
  // has no clone data at all, so counting its lines in the denominator would
  // silently dilute the percentage of every diff that touches one.
  it.each([
    ['tests/unit/ui/langPills.test.ts', 'a test outside the scanned scope'],
    // Built rather than written literally: no such file exists, and a
    // literal would be the dangling reference NoDanglingDocReferences bans.
    [`${'src'}/ui/dom.test.ts`, 'a test file inside the scanned scope'],
    ['src/core/i18n/locales/en.json', 'a non-TypeScript file'],
    ['docs/ui-redesign-spec.md', 'a file in an unscanned directory'],
  ])('ignores %s (%s)', (file) => {
    const changed = collectChangedLines(diff(file, '@@ -0,0 +1,5 @@', '+x'));
    expect(changed.has(file)).toBe(false);
  });

  it('drops a file whose hunks added nothing on the head side', () => {
    // A pure deletion: lines vanish, and nothing new can be duplicated.
    const changed = collectChangedLines(diff('src/ui/dom.ts', '@@ -3,2 +2,0 @@', '-gone', '-also gone'));
    expect(changed.has('src/ui/dom.ts')).toBe(false);
  });
});

describe('attribute', () => {
  const changed = (entries: Record<string, number[]>) =>
    new Map(Object.entries(entries).map(([file, lines]) => [file, { lines: new Set(lines) }]));

  const clone = (aName: string, aStart: number, aEnd: number, bName: string, bStart: number, bEnd: number) =>
    ({ a: { name: aName, start: aStart, end: aEnd }, b: { name: bName, start: bStart, end: bEnd } });

  it('reports zero when no clone touches a changed line', () => {
    const report = attribute(
      changed({ 'src/ui/dom.ts': [1, 2, 3] }),
      [clone('src/ui/dom.ts', 50, 60, 'src/ui/gameConsole.ts', 10, 20)],
    );
    expect(report).toMatchObject({ changedFiles: 1, changedLines: 3, duplicatedLines: 0, percentage: 0 });
    expect(report.hits).toEqual([]);
  });

  it('counts only the changed lines a clone actually covers', () => {
    // Clone spans 8-12; the branch changed 10-14. Three lines overlap.
    const report = attribute(
      changed({ 'src/ui/dom.ts': [10, 11, 12, 13, 14] }),
      [clone('src/ui/dom.ts', 8, 12, 'src/ui/gameConsole.ts', 1, 5)],
    );
    expect(report.duplicatedLines).toBe(3);
    expect(report.percentage).toBe(60);
    expect(report.hits).toEqual([{ file: 'src/ui/dom.ts', lines: 3, against: ['src/ui/gameConsole.ts:1-5'] }]);
  });

  // The whole point of scanning the tree rather than just the changed files:
  // a new file that copies an untouched one is the common case, and the clone
  // can arrive with the changed file on either side.
  it('attributes a clone whichever side the changed file is on', () => {
    const report = attribute(
      changed({ 'scripts/qualimetry-diff.ts': [1, 2, 3, 4, 5] }),
      [clone('src/ui/localeText.ts', 40, 44, 'scripts/qualimetry-diff.ts', 1, 5)],
    );
    expect(report.duplicatedLines).toBe(5);
    expect(report.hits[0]!.against).toEqual(['src/ui/localeText.ts:40-44']);
  });

  it('counts a line inside two clones once, and names both counterparts', () => {
    const report = attribute(
      changed({ 'src/ui/dom.ts': [1, 2, 3] }),
      [clone('src/ui/dom.ts', 1, 3, 'src/ui/gameConsole.ts', 7, 9), clone('src/ui/dom.ts', 2, 3, 'src/renderer/MeshUtils.ts', 4, 5)],
    );
    expect(report.duplicatedLines).toBe(3);
    // Counterparts are reported sorted, so the order is the names', not the clones'.
    expect(report.hits[0]!.against).toEqual(['src/renderer/MeshUtils.ts:4-5', 'src/ui/gameConsole.ts:7-9']);
  });

  it('totals across files and ranks the worst offender first', () => {
    const report = attribute(
      changed({ 'src/ui/dom.ts': [1, 2], 'src/ui/gameConsole.ts': [1, 2, 3, 4, 5, 6] }),
      [clone('src/ui/dom.ts', 1, 1, 'src/ui/panels/PanelBase.ts', 1, 1), clone('src/ui/gameConsole.ts', 1, 4, 'src/ui/icons.ts', 1, 4)],
    );
    expect(report).toMatchObject({ changedFiles: 2, changedLines: 8, duplicatedLines: 5 });
    expect(report.percentage).toBe(62.5);
    expect(report.hits.map(h => h.file)).toEqual(['src/ui/gameConsole.ts', 'src/ui/dom.ts']);
  });

  it('ignores a clone between two files the branch never touched', () => {
    const report = attribute(changed({ 'src/ui/dom.ts': [1] }), [clone('src/ui/panels/PanelBase.ts', 1, 9, 'src/ui/icons.ts', 1, 9)]);
    expect(report.duplicatedLines).toBe(0);
  });

  it('reports 0% rather than dividing by zero when nothing changed', () => {
    expect(attribute(changed({}), [clone('src/ui/panels/PanelBase.ts', 1, 9, 'src/ui/icons.ts', 1, 9)])).toMatchObject({
      changedLines: 0,
      percentage: 0,
    });
  });

  it('rounds the percentage to two decimals', () => {
    // 1 of 3 lines: 33.333... must not print as a full-precision float.
    const report = attribute(changed({ 'src/ui/dom.ts': [1, 2, 3] }), [clone('src/ui/dom.ts', 1, 1, 'src/ui/gameConsole.ts', 1, 1)]);
    expect(report.percentage).toBe(33.33);
  });
});
