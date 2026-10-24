// BlastSimulator2026 — The TDD cycle's git choreography (scripts/lib/pipeline/tdd.ts)
//
// The five-agent cycle kept the implementer blind with branches and a prompt.
// The lead now writes the skeleton and the implementation itself, so the
// separation rests on this module: the tests live in their own worktree on
// their own branch, a blind marker exists exactly while the implementation is
// being written, and the feature branch is assembled only from committed work.
// Each case below drives a real git repository in a temp directory; `red` is
// exercised through its pure judge in pipeline-paths.test.ts, since it shells
// out to Vitest.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { joinCycle, PipelineError, red, split, start, worktreePath } from '../../../scripts/lib/pipeline/tdd.js';
import { dirtyPaths } from '../../../scripts/lib/pipeline/git.js';
import { readBlind, readState, writeState } from '../../../scripts/lib/pipeline/tdd-state.js';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'pipeline-test',
  GIT_AUTHOR_EMAIL: 'pipeline-test@example.invalid',
  GIT_COMMITTER_NAME: 'pipeline-test',
  GIT_COMMITTER_EMAIL: 'pipeline-test@example.invalid',
};

// Paths inside the throwaway repository, built so the repo-wide dangling-reference lint does not read them as ours.
const SOURCE = ['src', 'score.ts'].join('/');
const TEST = ['tests', 'unit', 'score.test.ts'].join('/');

let sandbox: string;
let repo: string;
const saved: Record<string, string | undefined> = {};

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function commitAll(root: string, message: string): void {
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', message);
}

/** What the test-writer and `tdd red` leave behind: a committed test, and RED recorded. */
function recordRed(label: string): void {
  const state = readState(repo, label)!;
  write(state.worktree!, TEST, "it('adds', () => expect(score(1, 2)).toBe(3));\n");
  commitAll(state.worktree!, 'test-writer: failing tests (#42)');
  writeState(repo, { ...state, phase: 'red', red: sh(state.worktree!, 'rev-parse', 'HEAD'), redFiles: [TEST] });
}

beforeEach(() => {
  for (const [key, value] of Object.entries(IDENTITY)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  sandbox = mkdtempSync(join(tmpdir(), 'pipeline-tdd-'));
  repo = join(sandbox, 'game');
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(repo, '.gitignore', '.agentic/\n');
  write(repo, SOURCE, 'export const version = 1;\n');
  commitAll(repo, 'initial');
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('tdd start', () => {
  it('cuts the impl branch from the base and records the cycle', () => {
    start(repo, { label: '42-7' });
    expect(sh(repo, 'branch', '--show-current')).toBe('pipeline/impl-42-7');
    const state = readState(repo, '42-7')!;
    expect(state).toMatchObject({ issue: '42', base: 'main', phase: 'skeleton', featureBranch: 'pipeline/feature-42-7' });
    expect(state.baseSha).toBe(sh(repo, 'rev-parse', 'main'));
  });

  it('never reuses a label', () => {
    start(repo, { label: '42-7' });
    sh(repo, 'checkout', '-q', 'main');
    expect(() => start(repo, { label: '42-7' })).toThrow(PipelineError);
  });

  it('refuses a dirty working tree', () => {
    write(repo, SOURCE, 'export const version = 2;\n');
    expect(() => start(repo, { label: '42-7' })).toThrow(/uncommitted/);
  });
});

describe('tdd split', () => {
  beforeEach(() => {
    start(repo, { label: '42-7' });
  });

  it('needs a skeleton commit', () => {
    expect(() => split(repo, '42-7')).toThrow(/No skeleton commit/);
  });

  it('refuses a skeleton that writes tests — they are the test-writer\'s', () => {
    write(repo, TEST, '// sneaked in\n');
    commitAll(repo, 'skeleton');
    expect(() => split(repo, '42-7')).toThrow(/test paths/);
  });

  it('puts the tests branch at the skeleton in a sibling worktree and opens the blind phase', () => {
    write(repo, SOURCE, "export function score(a: number, b: number): number { throw new Error('stub'); }\n");
    commitAll(repo, 'skeleton');
    const skeleton = sh(repo, 'rev-parse', 'HEAD');
    split(repo, '42-7');

    const worktree = worktreePath(repo, '42-7');
    expect(dirname(worktree)).toBe(dirname(repo));
    expect(sh(worktree, 'rev-parse', 'HEAD')).toBe(skeleton);
    expect(sh(worktree, 'branch', '--show-current')).toBe('pipeline/tests-42-7');
    expect(readBlind(repo)).toEqual({ label: '42-7', testsBranch: 'pipeline/tests-42-7', worktree });
    expect(readState(repo, '42-7')).toMatchObject({ phase: 'tests', skeleton, worktree });
    // The implementing side keeps working where it was.
    expect(sh(repo, 'branch', '--show-current')).toBe('pipeline/impl-42-7');
  });
});

describe('tdd join', () => {
  beforeEach(() => {
    start(repo, { label: '42-7' });
    write(repo, SOURCE, "export function score(a: number, b: number): number { throw new Error('stub'); }\n");
    commitAll(repo, 'skeleton');
    split(repo, '42-7');
  });

  it('waits for RED', () => {
    expect(() => joinCycle(repo, '42-7')).toThrow(/RED is not proven/);
    expect(readBlind(repo)).toBeDefined();
  });

  it('waits for a committed implementation', () => {
    recordRed('42-7');
    expect(() => joinCycle(repo, '42-7')).toThrow(/No implementation commit/);
    write(repo, SOURCE, 'export function score(a: number, b: number): number { return a + b; }\n');
    expect(() => joinCycle(repo, '42-7')).toThrow(/uncommitted/);
    expect(readBlind(repo)).toBeDefined();
  });

  it('assembles base + skeleton + tests + implementation, closes the blind phase and removes the worktree', () => {
    recordRed('42-7');
    const worktree = readState(repo, '42-7')!.worktree!;
    write(repo, SOURCE, 'export function score(a: number, b: number): number { return a + b; }\n');
    commitAll(repo, 'implement: score (#42)');

    joinCycle(repo, '42-7');

    expect(sh(repo, 'branch', '--show-current')).toBe('pipeline/feature-42-7');
    expect(readFileSync(join(repo, SOURCE), 'utf8')).toContain('return a + b');
    expect(existsSync(join(repo, TEST))).toBe(true);
    expect(sh(repo, 'log', '--format=%s', 'main..HEAD').split('\n')).toEqual([
      'implement: score (#42)',
      'test-writer: failing tests (#42)',
      'skeleton',
    ]);
    expect(readBlind(repo)).toBeUndefined();
    expect(existsSync(worktree)).toBe(false);
    expect(readState(repo, '42-7')).toMatchObject({ phase: 'joined' });
  });

  it('stops on a conflict and resumes after it is resolved', () => {
    recordRed('42-7');
    // The implementation also touched the file the test-writer created.
    write(repo, TEST, '// implementer version\n');
    commitAll(repo, 'implement: score (#42)');

    const stopped = joinCycle(repo, '42-7');
    expect(stopped.join('\n')).toContain(`conflict in:\n  ${TEST}`);
    expect(() => joinCycle(repo, '42-7')).toThrow(/cherry-pick is waiting/);

    write(repo, TEST, '// both sides\n');
    sh(repo, 'add', '-A');
    execFileSync('git', ['cherry-pick', '--continue'], { cwd: repo, env: { ...process.env, GIT_EDITOR: 'true' } });
    joinCycle(repo, '42-7');
    expect(readState(repo, '42-7')).toMatchObject({ phase: 'joined' });
  });

  it('refuses to call a join done when an aborted cherry-pick dropped commits', () => {
    recordRed('42-7');
    write(repo, TEST, '// implementer version\n');
    commitAll(repo, 'implement: score (#42)');
    joinCycle(repo, '42-7');
    sh(repo, 'cherry-pick', '--abort');
    expect(() => joinCycle(repo, '42-7')).toThrow(/holds 2 of the 3 commits/);
    expect(readState(repo, '42-7')).not.toMatchObject({ phase: 'joined' });
  });
});

describe('tdd red', () => {
  beforeEach(() => {
    start(repo, { label: '42-7' });
    write(repo, SOURCE, "export function score(a: number, b: number): number { throw new Error('stub'); }\n");
    commitAll(repo, 'skeleton');
    split(repo, '42-7');
  });

  it('refuses a tests worktree that changed production code or deleted a test, and commits nothing', () => {
    const worktree = readState(repo, '42-7')!.worktree!;
    write(worktree, SOURCE, 'export function score(): number { return 3; }\n');
    const result = red(repo, { label: '42-7', commit: true });
    expect(result.verdict.red).toBe(false);
    expect(result.lines.join('\n')).toContain(`${SOURCE}: not a test path`);
    expect(result.lines.join('\n')).toContain('--detail');
    expect(readState(repo, '42-7')).toMatchObject({ phase: 'tests' });
  });
});

describe('git status paths', () => {
  it('keeps the first path whole', () => {
    write(repo, SOURCE, 'export const version = 2;\n');
    expect(dirtyPaths(repo)).toEqual([SOURCE]);
  });
});
