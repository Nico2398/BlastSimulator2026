// BlastSimulator2026 — `npm run pipeline -- open-pr` (scripts/lib/pipeline/open-pr.ts)
//
// A PR opens only with a sound body, and never without its plan comment: VRoom
// PR 228 put READY TO MERGE mid-body and skipped the plan, and the CI-fix
// session after it worked without one. Each case drives a real git repository
// with a bare remote; `gh` is answered by a fake runner.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { bodyProblems, openPr, OpenPrError, PLAN_MARKER, planComment, runStdout, type Runner } from '../../../scripts/lib/pipeline/open-pr.js';
import { runHook } from '../../helpers/claudeHooks';

const ROOT = join(import.meta.dirname, '../../..');
const TEMPLATE = readFileSync(join(ROOT, '.github/PULL_REQUEST_TEMPLATE/pipeline.md'), 'utf8');
const GOOD = 'Closes #42\n\nAdds the thing.\n\n## Verification\n- static: PASS\n\nREADY TO MERGE\n';
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
}

/** Answers `gh` the way GitHub would; everything else runs for real. */
function fakeGh(openLine = '', planIds = ''): Runner & { calls: string[][]; comment?: string } {
  const calls: string[][] = [];
  const runner = ((argv: string[], cwd: string) => {
    if (argv[0] !== 'gh') return runStdout(argv, cwd);
    calls.push(argv);
    if (argv[1] === 'pr' && argv[2] === 'list') return { code: 0, out: openLine };
    if (argv[1] === 'pr' && argv[2] === 'create') return { code: 0, out: 'https://github.com/o/r/pull/7\n' };
    if (argv[1] === 'api') return { code: 0, out: planIds };
    if (argv[1] === 'pr' && argv[2] === 'comment') {
      runner.comment = readFileSync(argv.at(-1)!, 'utf8');
      return { code: 0, out: '' };
    }
    return { code: 1, out: 'unexpected' };
  }) as Runner & { calls: string[][]; comment?: string };
  runner.calls = calls;
  return runner;
}

describe('bodyProblems', () => {
  it('wants the marker last and the Closes line', () => {
    expect(bodyProblems(GOOD, '42', false, TEMPLATE)).toEqual([]);
    expect(bodyProblems('Closes #42\n\nREADY TO MERGE\n\n## What changed\n- x\n', '42', false, TEMPLATE).join()).toContain('last line');
    expect(bodyProblems(GOOD.replace('Closes #42', 'Fixes it'), '42', false, TEMPLATE).join()).toContain('Closes #42');
  });

  it('keeps the marker off a draft and names a placeholder left in', () => {
    expect(bodyProblems(GOOD, '42', true, TEMPLATE).join()).toContain('draft');
    expect(bodyProblems(GOOD.replace('READY TO MERGE\n', ''), '42', true, TEMPLATE)).toEqual([]);
    const placeholder = TEMPLATE.match(/<(?!!--)[^<>\n]+>/)![0];
    expect(bodyProblems(GOOD.replace('PASS', placeholder), '42', false, TEMPLATE).join()).toContain(placeholder);
  });
});

describe('planComment', () => {
  it('opens with the marker, holds every section and stays under 60 000 characters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-'));
    try {
      writeFileSync(join(dir, '42-7-s1.md'), '# Plan s1\n');
      writeFileSync(join(dir, '42-7-s2.md'), `# Plan s2\n${'x'.repeat(70_000)}`);
      const text = planComment([join(dir, '42-7-s1.md'), join(dir, '42-7-s2.md')], '42-7');
      expect(text.startsWith(`${PLAN_MARKER}\n<details>`)).toBe(true);
      expect(text).toContain('### Section 1');
      expect(text).toContain('cut at 60 000');
      expect(text.length).toBeLessThanOrEqual(60_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('openPr', () => {
  let base: string;
  let repo: string;
  let body: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'open-pr-'));
    repo = join(base, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(base, 'remote.git')]);
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    sh(repo, 'remote', 'add', 'origin', join(base, 'remote.git'));
    writeFileSync(join(repo, '.gitignore'), '.agentic/\n');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'initial');
    sh(repo, 'push', '-q', 'origin', 'main');
    sh(repo, 'checkout', '-q', '-b', 'pipeline/feature-42-7');
    writeFileSync(join(repo, 'a.txt'), 'b\n');
    sh(repo, 'commit', '-qam', 'implement: b (#42)');
    mkdirSync(join(repo, '.agentic', 'plan'), { recursive: true });
    writeFileSync(join(repo, '.agentic', 'plan', '42-7.md'), '# Plan — #42 (42-7)\n\n## Contract\n- C1\n');
    body = join(base, 'body.md');
    writeFileSync(body, GOOD);
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('pushes, opens the PR and posts the plan', () => {
    const gh = fakeGh();
    const lines = openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body }, gh);
    expect(lines[0]).toContain('Opened PR #7');
    const create = gh.calls.find((call) => call[2] === 'create')!;
    expect(create).toContain('pipeline/feature-42-7');
    expect(create).not.toContain('--draft');
    expect(gh.comment!.startsWith(PLAN_MARKER)).toBe(true);
    expect(gh.comment).toContain('## Contract');
    expect(sh(join(base, 'remote.git'), 'rev-parse', 'pipeline/feature-42-7')).toBe(sh(repo, 'rev-parse', 'HEAD'));
  });

  it('creates nothing twice on a re-run', () => {
    const gh = fakeGh('7 https://github.com/o/r/pull/7', '123');
    expect(openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body }, gh)).toEqual([
      'PR #7 already open for pipeline/feature-42-7: https://github.com/o/r/pull/7',
      'Plan comment already posted.',
    ]);
    expect(gh.calls.some((call) => call[2] === 'create' || call[2] === 'comment')).toBe(false);
  });

  it('refuses before pushing without a plan or with a bad body', () => {
    unlinkSync(join(repo, '.agentic', 'plan', '42-7.md'));
    expect(() => openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body }, fakeGh())).toThrow(/No plan/);
    writeFileSync(join(repo, '.agentic', 'plan', '42-7.md'), '# Plan\n');
    writeFileSync(body, 'Closes #42\nREADY TO MERGE\nand more\n');
    const gh = fakeGh();
    expect(() => openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body }, gh)).toThrow(OpenPrError);
    expect(gh.calls).toEqual([]);
  });

  it('refuses a closing keyword in the title or a commit of the range', () => {
    expect(() => openPr(repo, { label: '42-7', title: 'feat: b, which fixes #42 for now', bodyFile: body }, fakeGh())).toThrow(/closing keyword in title/);
    writeFileSync(join(repo, 'a.txt'), 'c\n');
    sh(repo, 'commit', '-qam', 'this fixes #9 too');
    expect(() => openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body }, fakeGh())).toThrow(/closing keyword in commit/);
  });

  it('opens a paused handover as a draft labelled on the create call', () => {
    writeFileSync(body, 'Closes #42\n\n⏸️ **Paused — waiting on #50.**\n');
    const gh = fakeGh();
    openPr(repo, { label: '42-7', title: 'feat: b (#42)', bodyFile: body, paused: true }, gh);
    const create = gh.calls.find((call) => call[2] === 'create')!;
    expect(create).toContain('--draft');
    expect(create[create.indexOf('--label') + 1]).toBe('paused');
  });
});

describe('require-open-pr-command.mjs', () => {
  const call = (command: string, unattended: boolean) =>
    runHook('require-open-pr-command.mjs', JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), unattended ? { GITHUB_ACTIONS: 'true' } : {});

  it.each(['gh pr create --title x --body-file b', 'cd x && GH_TOKEN=t gh -R o/r pr create --draft'])('refuses %s unattended', (command) => {
    const run = call(command, true);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('npm run pipeline -- open-pr');
  });

  it('lets other gh calls, the command itself and interactive sessions through', () => {
    expect(call('gh pr view 7 && gh pr comment 7 --body x', true).status).toBe(0);
    expect(call('npm run pipeline -- open-pr --label 42-7 --title t --body-file b', true).status).toBe(0);
    expect(call('gh pr create --title x', false).status).toBe(0);
  });
});
