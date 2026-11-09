// BlastSimulator2026 — `verify`'s focused and full `logic` runs, and what the cache
// may answer (scripts/lib/pipeline/verify.ts)
//
// `logic` runs a focused selection by default and the whole suite on `--full`
// (the full suite is CI's: running it five to seven times a pipeline run was
// 49 of 159 measured wall-hours). Two things must not blur between the modes:
// a cached focused pass must never answer a `--full` request, and `context`
// may drop its own Vitest half only when a full `logic` run covers it. The pure
// rules are pinned first; then `verify` itself runs in a throwaway repository
// whose channels need no network — an empty focused selection runs nothing,
// and `npm` fails at once where there is no package.json.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { CHANNEL_COMMANDS } from '../../../scripts/lib/pipeline/paths.js';
import {
  cachedLogic,
  contextSubsumedBy,
  focusedLogicKey,
  logicPlanFor,
  verify,
  type LogicMode,
  type VerifyCache,
} from '../../../scripts/lib/pipeline/verify.js';

const FORK = 'a'.repeat(40);
const OTHER_FORK = 'b'.repeat(40);
const FULL: LogicMode = { full: true, key: 'logic' };
const FOCUSED: LogicMode = { full: false, key: focusedLogicKey(FORK) };
// Built rather than written literally: these files exist only in the selections below.
const testPath = (name: string): string => ['tests', 'unit', 'demo', name].join('/');

describe('cachedLogic', () => {
  it('answers a focused request from a full pass, and a full request only from a full pass', () => {
    const full: VerifyCache = { logic: 'pass' };
    expect(cachedLogic(full, false, FORK)).toEqual(FULL);
    expect(cachedLogic(full, true, FORK)).toEqual(FULL);
  });

  it('never answers --full from a focused pass', () => {
    const focused: VerifyCache = { [focusedLogicKey(FORK)]: 'pass' };
    expect(cachedLogic(focused, false, FORK)).toEqual(FOCUSED);
    expect(cachedLogic(focused, true, FORK)).toBeUndefined();
  });

  it('answers a focused request only for the fork point it was selected against', () => {
    expect(cachedLogic({ [focusedLogicKey(FORK)]: 'pass' }, false, OTHER_FORK)).toBeUndefined();
    expect(cachedLogic({}, false, FORK)).toBeUndefined();
    expect(cachedLogic({ static: 'pass' }, false, FORK)).toBeUndefined();
  });
});

describe('contextSubsumedBy', () => {
  it("drops context's own suites only under a full logic run", () => {
    expect(contextSubsumedBy(FULL)).toBe(true);
    expect(contextSubsumedBy(FOCUSED)).toBe(false);
    expect(contextSubsumedBy(undefined)).toBe(false);
  });
});

describe('logicPlanFor', () => {
  const reasons = new Map([[testPath('A.test.ts'), 'importer' as const], [testPath('B.test.ts'), 'changed' as const]]);

  it('runs Vitest on the focused files, records the pass under the fork point, and says the rest is CI\'s', () => {
    const plan = logicPlanFor({ full: false, files: [testPath('A.test.ts'), testPath('B.test.ts')], reasons, total: 1005, notes: [] }, FORK);
    expect(plan.mode).toEqual(FOCUSED);
    expect(plan.commands).toEqual([['npx', 'vitest', 'run', '--reporter=dot', testPath('A.test.ts'), testPath('B.test.ts')]]);
    expect(plan.detail).toBe("focused: 2 of 1005 test files (1 changed test, 1 direct importer); the full suite is CI's");
    expect(plan.log).toEqual([`# logic — focused: 2 of 1005 test files (1 changed test, 1 direct importer)`, `#   importer: ${testPath('A.test.ts')}`, `#   changed: ${testPath('B.test.ts')}`]);
  });

  it('runs the whole suite when the selection escalates, and records it as a full pass', () => {
    const plan = logicPlanFor({ full: true, fullReason: 'package.json changes how every test runs', files: [], reasons: new Map(), total: 1005, notes: [] }, FORK);
    expect(plan.mode).toEqual(FULL);
    expect(plan.commands).toEqual(CHANNEL_COMMANDS.logic);
    expect(plan.detail).toBe('full suite: 1005 test files (package.json changes how every test runs)');
  });

  it('runs nothing for an empty selection', () => {
    expect(logicPlanFor({ full: false, files: [], reasons: new Map(), total: 0, notes: [] }, FORK).commands).toEqual([]);
  });
});

describe("the static channel's typecheck", () => {
  // `verify` runs `npm run typecheck` on every call. Incremental, a re-check of
  // an unchanged tree or a function-body edit took 8-11 s against 32-39 s
  // cold on a contended 4-core box; each project needs its own build-info
  // file, or the three would overwrite each other's and always start cold.
  it('is incremental, with one build-info file per project', () => {
    const script = (JSON.parse(readFileSync(join(import.meta.dirname, '../../../package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['typecheck']!;
    const runs = script.split('&&').map((run) => run.trim());
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(run).toMatch(/^tsc --noEmit --incremental --tsBuildInfoFile node_modules\/\.cache\/tsc\/\w+\.tsbuildinfo/);
    expect(new Set(runs.map((run) => /tsBuildInfoFile (\S+)/.exec(run)![1])).size).toBe(3);
  });
});

describe('verify in a repository', () => {
  const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  let repo: string;
  const sh = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const source = ['src', 'score.ts'].join('/');

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pipeline-verify-'));
    sh('init', '-q', '-b', 'main');
    write('.gitignore', '.agentic/\n');
    write(source, 'export const score = 1;\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'base');
    sh('checkout', '-q', '-b', 'feature');
    write(source, 'export const score = 2;\n');
    sh('commit', '-q', '-am', 'change');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('caches a focused pass apart from a full one, and never answers --full with it', () => {
    const first = verify(repo, { only: ['logic'] });
    expect(first.ok).toBe(true);
    expect(first.lines).toContain("PASS logic — focused: 0 of 0 test files; the full suite is CI's");

    expect(verify(repo, { only: ['logic'] }).lines).toContain('PASS (cached: this exact tree already passed) logic — focused selection');

    const full = verify(repo, { only: ['logic'], full: true });
    expect(full.ok).toBe(false);
    expect(full.lines.find((line) => line.startsWith('FAIL logic'))).toMatch(/full suite \(--full\)/);
  });

  it("keeps context's own suites beside a focused logic run, and drops them beside a full one", () => {
    const progress: string[] = [];
    verify(repo, { only: ['context', 'logic'], noCache: true, progress: (line) => progress.push(line) });
    expect(progress[0]).toBe(`running context: ${CHANNEL_COMMANDS.context.map((c) => c.join(' ')).join(' && ')}`);

    progress.length = 0;
    verify(repo, { only: ['context', 'logic'], noCache: true, full: true, progress: (line) => progress.push(line) });
    expect(progress[0]).toBe('running context: npm run validate:context');
  });
});
