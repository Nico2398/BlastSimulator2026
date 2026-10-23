// BlastSimulator2026 — What a change owes, and what counts as RED
//
// `npm run pipeline -- verify` and `review-brief` replace a validator agent and
// five reviewers' worth of "which checks apply here" reasoning. These cases pin
// the mapping from changed paths to channels and review sections, the RED
// judge `tdd red` applies to a Vitest report, and the failure excerpt `verify`
// prints instead of a whole log.

import { describe, expect, it } from 'vitest';
import { channelsFor, issueFromLabel, isValidLabel, reviewSectionsFor } from '../../../scripts/lib/pipeline/paths.js';
import { judgeRed, summarizeVitest, typeErrorsIn } from '../../../scripts/lib/pipeline/red.js';
import { failureExcerpt } from '../../../scripts/lib/pipeline/verify.js';
import { groupByArea } from '../../../scripts/lib/pipeline/review-brief.js';
import { parseArgs } from '../../../scripts/pipeline.js';

describe('channelsFor', () => {
  it('owes static, duplication, logic and scenario for a gameplay change', () => {
    expect(channelsFor(['src/core/config/balance.ts'])).toEqual(['static', 'duplication', 'logic', 'scenario']);
  });

  it('owes i18n for a UI or locale change, and no scenario for a UI-only one', () => {
    expect(channelsFor(['src/ui/RampTool.ts'])).toEqual(['i18n', 'static', 'duplication', 'logic']);
    expect(channelsFor(['src/core/i18n/locales/en.json'])).toEqual(['i18n', 'logic', 'scenario']);
  });

  it('owes only the context channel for a skill edit — never the whole suite', () => {
    expect(channelsFor(['.claude/skills/dev-architecture/SKILL.md'])).toEqual(['context']);
  });

  it('owes logic for pipeline code and hooks', () => {
    expect(channelsFor(['.github/scripts/assignability.cjs'])).toEqual(['logic']);
    expect(channelsFor(['.claude/hooks/blind-to-tests.mjs'])).toEqual(['context', 'logic']);
  });

  it('owes scenario for a scenario definition', () => {
    expect(channelsFor(['scripts/scenario-defs/blast-basic.json'])).toEqual(['logic', 'scenario']);
  });

  it('owes nothing for nothing', () => {
    expect(channelsFor([])).toEqual([]);
  });
});

describe('reviewSectionsFor', () => {
  it('always owes acceptance', () => {
    expect(reviewSectionsFor([])).toEqual(['acceptance']);
  });

  it('owes durability only for core code, i18n only for player-facing code', () => {
    expect(reviewSectionsFor(['src/core/nav/Pathfinding.ts'])).toEqual(['acceptance', 'tests', 'architecture', 'durability', 'duplication']);
    expect(reviewSectionsFor(['src/renderer/GameRenderer.ts'])).toContain('i18n');
    expect(reviewSectionsFor(['src/core/nav/Pathfinding.ts'])).not.toContain('i18n');
  });

  it('owes security where untrusted input or the pipeline is touched', () => {
    expect(reviewSectionsFor(['src/core/state/SaveLoad.ts'])).toContain('security');
    expect(reviewSectionsFor(['.github/workflows/ci.yml'])).toEqual(['acceptance', 'security', 'workflows']);
    expect(reviewSectionsFor(['src/ui/RampTool.ts'])).not.toContain('security');
  });

  it('owes the context section for context files and nothing code-shaped', () => {
    expect(reviewSectionsFor(['.claude/skills/dev-architecture/SKILL.md'])).toEqual(['acceptance', 'context']);
  });
});

describe('labels', () => {
  it('reads the issue off a run label', () => {
    expect(issueFromLabel('2045-39747036229')).toBe('2045');
    expect(issueFromLabel('2045-39747036229-s2')).toBe('2045');
  });

  it('rejects labels that are unsafe as branch and file names', () => {
    expect(isValidLabel('2045-local-1a2b3c4d')).toBe(true);
    expect(isValidLabel('../2045')).toBe(false);
    expect(isValidLabel('')).toBe(false);
  });
});

describe('RED judge', () => {
  // Built rather than written literally: these files exist only inside the
  // fabricated report, and a literal would be a dangling reference.
  const t = (name: string): string => ['tests', 'unit', name].join('/');
  const root = '/repo';
  const report = {
    testResults: [
      { name: `/repo/${t('a.test.ts')}`, status: 'failed', assertionResults: [{ status: 'failed' }, { status: 'passed' }] },
      { name: `/repo/${t('b.test.ts')}`, status: 'failed', message: "Error: Cannot find module './nope'\n  at x", assertionResults: [] },
      { name: `/repo/${t('c.test.ts')}`, status: 'passed', assertionResults: [{ status: 'passed' }] },
    ],
  };

  it('counts failures per file and names a file that never loaded', () => {
    expect(summarizeVitest(report, root, [t('a.test.ts'), t('b.test.ts'), t('missing.test.ts')])).toEqual([
      { file: t('a.test.ts'), total: 2, failed: 1 },
      { file: t('b.test.ts'), total: 0, failed: 0, loadError: "Error: Cannot find module './nope'" },
      { file: t('missing.test.ts'), total: 0, failed: 0, loadError: 'not in the Vitest report (not collected)' },
    ]);
  });

  it('is RED when a new test fails on an assertion and every file loaded', () => {
    const verdict = judgeRed(summarizeVitest(report, root, [t('a.test.ts'), t('c.test.ts')]), []);
    expect(verdict.red).toBe(true);
    expect(verdict.passingOnStubs).toEqual([t('c.test.ts')]);
  });

  it('is not RED when a file fails to load — it would fail on a correct implementation too', () => {
    const verdict = judgeRed(summarizeVitest(report, root, [t('a.test.ts'), t('b.test.ts')]), []);
    expect(verdict.red).toBe(false);
    expect(verdict.problems[0]).toMatch(/b\.test\.ts: did not load/);
  });

  it('is not RED when nothing fails, when nothing was written, or when a test does not type-check', () => {
    expect(judgeRed(summarizeVitest(report, root, [t('c.test.ts')]), []).problems).toEqual([
      'no new test fails against the stubs — nothing proves the behaviour is missing',
    ]);
    expect(judgeRed([], []).red).toBe(false);
    const typed = typeErrorsIn(`${t('a.test.ts')}(3,7): error TS2554: Expected 2 arguments.\nlib/other.ts(1,1): error TS1`, [
      t('a.test.ts'),
    ]);
    expect(typed).toEqual([`${t('a.test.ts')}(3,7): error TS2554: Expected 2 arguments.`]);
    expect(judgeRed(summarizeVitest(report, root, [t('a.test.ts')]), typed).red).toBe(false);
  });

  it('is not RED when a must-pass guard fails', () => {
    const verdict = judgeRed(summarizeVitest(report, root, [t('a.test.ts')]), [], [{ file: t('scenario-defs-validation/x.test.ts'), total: 3, failed: 1 }]);
    expect(verdict.red).toBe(false);
  });
});

describe('failureExcerpt', () => {
  const failing = ' FAIL  tests/unit/nav/Pathfinding.test.ts > finds a path';

  it("starts at the tool's failure report and keeps the totals at the end", () => {
    const log = [
      ' ✓ tests/unit/nav/NavGrid.test.ts > logs the FAILED line when a cell is blocked',
      'noise',
      '⎯⎯⎯ Failed Tests 1 ⎯⎯⎯',
      failing,
      'AssertionError: expected 2 to be 3',
      ...Array.from({ length: 100 }, (_, i) => `detail ${i}`),
      ' Tests  1 failed | 9 passed',
    ].join('\n');
    const excerpt = failureExcerpt(log, 5, 2);
    expect(excerpt.slice(0, 3)).toEqual(['⎯⎯⎯ Failed Tests 1 ⎯⎯⎯', failing, 'AssertionError: expected 2 to be 3']);
    expect(excerpt).toContain('…');
    expect(excerpt.at(-1)).toBe(' Tests  1 failed | 9 passed');
    expect(excerpt).toHaveLength(5 + 1 + 2);
  });

  it('falls back to the first failure-looking line when the tool printed no report', () => {
    expect(failureExcerpt('ok\nError: boom\nat x', 60, 1)).toEqual(['Error: boom', 'at x']);
  });

  it('strips colour codes and falls back to the tail when no line looks like a failure', () => {
    expect(failureExcerpt('\x1b[31mone\x1b[0m\ntwo\nthree', 60, 2)).toEqual(['two', 'three']);
  });
});

describe('review brief', () => {
  it('groups changed files by area', () => {
    expect(groupByArea(['src/core/nav/Pathfinding.ts', 'tests/unit/nav/Pathfinding.test.ts', 'src/core/config/balance.ts', 'package.json'])).toEqual([
      '(root) (1): package.json',
      'src/core/ (2): src/core/nav/Pathfinding.ts, src/core/config/balance.ts',
      'tests/ (1): tests/unit/nav/Pathfinding.test.ts',
    ]);
  });
});

describe('pipeline CLI arguments', () => {
  it('reads repeated values and bare flags', () => {
    const parsed = parseArgs(['tdd', 'red', '--label', '42-7', '--no-commit', '--label', '42-7-s2']);
    expect(parsed.positional).toEqual(['tdd', 'red']);
    expect(parsed.values.get('label')).toEqual(['42-7', '42-7-s2']);
    expect(parsed.flags.has('no-commit')).toBe(true);
  });

  it('rejects an option with no value', () => {
    expect(() => parseArgs(['verify', '--base'])).toThrow(/needs a value/);
  });
});
