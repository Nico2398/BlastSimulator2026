// BlastSimulator2026 — Whether a pipeline PR's head is red, and whether a
// handback for it is new, a repeat, or past the attempt limit.
//
// `.github/scripts/ci-handback.cjs` is the pure decision core extracted out of
// `agentic-ci-failure.yml`'s nudge job so a `workflow_run` trigger on
// `claude-runner.yml`/`opencode-runner.yml` completion can re-scan open
// pipeline PRs event-driven, instead of waiting on the hourly watchdog cron
// (observed delivery gaps of 3-5 hours). See the module's own header comment.
//
// Loaded the same way `assignability.test.ts` loads `assignability.cjs`: this
// drives the source that actually ships, not a copy of it.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const rules = require(join(ROOT, '.github/scripts/ci-handback.cjs'));

interface FakeRun {
  id: number;
  workflow_id: number;
  path: string;
  created_at: string;
  status: string;
  conclusion: string | null;
}

const run = (overrides: Partial<FakeRun> = {}): FakeRun => ({
  id: 1,
  workflow_id: 100,
  path: '.github/workflows/some-channel.yml',
  created_at: '2026-09-01T00:00:00Z',
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});

interface FakePr {
  state: string;
  draft: boolean;
  head: { ref: string };
}

const pr = (overrides: Partial<FakePr> = {}): FakePr => ({
  state: 'open',
  draft: false,
  head: { ref: 'pipeline/feature-1059-32908623869' },
  ...overrides,
});

const comment = (body: string) => ({ body });

describe('latestPerWorkflow', () => {
  it('keeps one run per workflow_id, the newest by id', () => {
    const runs = [
      run({ id: 1, workflow_id: 100, conclusion: 'failure' }),
      run({ id: 2, workflow_id: 100, conclusion: 'success' }),
    ];
    const latest = rules.latestPerWorkflow(runs);
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ id: 2, conclusion: 'success' });
  });

  it('returns one entry for an empty input', () => {
    expect(rules.latestPerWorkflow([])).toEqual([]);
  });

  it('excludes machinery workflows entirely', () => {
    const runs = [
      run({ id: 1, workflow_id: 200, path: '.github/workflows/claude-runner.yml' }),
      run({ id: 2, workflow_id: 300, path: '.github/workflows/some-channel.yml' }),
    ];
    const latest = rules.latestPerWorkflow(runs);
    expect(latest.map((r: FakeRun) => r.workflow_id)).toEqual([300]);
  });

  it('keeps distinct workflow_ids separate', () => {
    const runs = [run({ id: 1, workflow_id: 100 }), run({ id: 2, workflow_id: 200 })];
    expect(rules.latestPerWorkflow(runs)).toHaveLength(2);
  });
});

describe('pipelineIssueFor', () => {
  it('extracts the issue number from a bare pipeline branch', () => {
    expect(rules.pipelineIssueFor(pr({ head: { ref: 'pipeline/feature-1059' } }))).toBe(1059);
  });

  it('extracts the issue number from a run-id-suffixed pipeline branch', () => {
    expect(rules.pipelineIssueFor(pr({ head: { ref: 'pipeline/feature-1059-34567' } }))).toBe(1059);
  });

  it.each([
    ['main', 'main'],
    ['a tests-phase branch', 'pipeline/tests-1059-32908623869'],
    ['an impl-phase branch', 'pipeline/impl-1059-32908623869'],
    ['an unrelated branch', 'feature/something'],
  ])('returns null for %s', (_name, ref) => {
    expect(rules.pipelineIssueFor(pr({ head: { ref } }))).toBeNull();
  });

  it('returns null when the PR carries no head ref at all', () => {
    expect(rules.pipelineIssueFor({ head: {} })).toBeNull();
    expect(rules.pipelineIssueFor({})).toBeNull();
  });
});

describe('redVerdict', () => {
  const runsOnHead = (list: Partial<FakeRun>[]) => list.map((r) => run(r));

  it('reports null on an all-green head', () => {
    const runs = runsOnHead([
      { id: 1, workflow_id: 100, conclusion: 'success' },
      { id: 2, workflow_id: 200, conclusion: 'success' },
    ]);
    expect(rules.redVerdict(pr(), runs)).toBeNull();
  });

  it('reports null while every channel is still running, with nothing red', () => {
    const runs = runsOnHead([
      { id: 1, workflow_id: 100, status: 'in_progress', conclusion: null },
      { id: 2, workflow_id: 200, status: 'queued', conclusion: null },
    ]);
    expect(rules.redVerdict(pr(), runs)).toBeNull();
  });

  it('names the one red channel among several green ones', () => {
    const runs = runsOnHead([
      { id: 1, workflow_id: 100, conclusion: 'success' },
      { id: 2, workflow_id: 200, conclusion: 'failure' },
    ]);
    const verdict = rules.redVerdict(pr({ head: { ref: 'pipeline/feature-1059-1' } }), runs);
    expect(verdict).toEqual({ issueNumber: 1059, redRunId: 2 });
  });

  it.each(
    [...(rules.RUN_FAILURES ?? new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'stale']))]
  )('treats a %s conclusion as red', (conclusion: string) => {
    const runs = runsOnHead([{ id: 7, workflow_id: 100, conclusion }]);
    const verdict = rules.redVerdict(pr(), runs);
    expect(verdict).toEqual({ issueNumber: 1059, redRunId: 7 });
  });

  it('reports null on a closed pull request', () => {
    const runs = runsOnHead([{ id: 1, workflow_id: 100, conclusion: 'failure' }]);
    expect(rules.redVerdict(pr({ state: 'closed' }), runs)).toBeNull();
  });

  it('reports null on a merged pull request', () => {
    const runs = runsOnHead([{ id: 1, workflow_id: 100, conclusion: 'failure' }]);
    expect(rules.redVerdict(pr({ state: 'closed', ...({ merged: true } as object) }), runs)).toBeNull();
  });

  it('reports null on a draft pull request', () => {
    const runs = runsOnHead([{ id: 1, workflow_id: 100, conclusion: 'failure' }]);
    expect(rules.redVerdict(pr({ draft: true }), runs)).toBeNull();
  });

  it('reports null when the head is not a pipeline branch', () => {
    const runs = runsOnHead([{ id: 1, workflow_id: 100, conclusion: 'failure' }]);
    expect(rules.redVerdict(pr({ head: { ref: 'main' } }), runs)).toBeNull();
    expect(rules.redVerdict(pr({ head: { ref: 'pipeline/tests-1059-1' } }), runs)).toBeNull();
  });

  it('reports null (pending, not red) when nothing has run on the head yet', () => {
    expect(rules.redVerdict(pr(), [])).toBeNull();
  });

  it('does not count a stale superseded run once a newer one supersedes it', () => {
    // `cancel-in-progress` leaves the older run on the head forever; only the
    // newest run per workflow_id decides the verdict.
    const runs = runsOnHead([
      { id: 1, workflow_id: 100, conclusion: 'cancelled', created_at: '2026-09-01T00:00:00Z' },
      { id: 2, workflow_id: 100, conclusion: 'success', created_at: '2026-09-01T00:05:00Z' },
    ]);
    expect(rules.redVerdict(pr(), runs)).toBeNull();
  });
});

describe('handbackVerdict', () => {
  it('needs a handback when nobody has asked about this run and the count is under the limit', () => {
    const verdict = rules.handbackVerdict({ comments: [], redRunId: 42, limit: 3 });
    expect(verdict).toBe('needs-handback');
  });

  it('reports already-asked when a marker comment names this exact run id', () => {
    const comments = [comment(`${rules.MARKER} abc1234 run:42`)];
    const verdict = rules.handbackVerdict({ comments, redRunId: 42, limit: 3 });
    expect(verdict).toBe('already-asked');
  });

  it('reports at-limit once the nudge count meets the limit, even for a run never asked about', () => {
    const comments = [
      comment(`${rules.MARKER} abc1234 run:1`),
      comment(`${rules.MARKER} def5678 run:2`),
      comment(`${rules.MARKER} ghi9012 run:3`),
    ];
    const verdict = rules.handbackVerdict({ comments, redRunId: 99, limit: 3 });
    expect(verdict).toBe('at-limit');
  });

  it('reports at-limit when the count exceeds the limit', () => {
    const comments = [
      comment(`${rules.MARKER} abc1234 run:1`),
      comment(`${rules.MARKER} def5678 run:2`),
      comment(`${rules.MARKER} ghi9012 run:3`),
      comment(`${rules.MARKER} jkl3456 run:4`),
    ];
    const verdict = rules.handbackVerdict({ comments, redRunId: 99, limit: 3 });
    expect(verdict).toBe('at-limit');
  });

  it('ignores a comment that carries the marker for a different run', () => {
    const comments = [comment(`${rules.MARKER} abc1234 run:1`)];
    const verdict = rules.handbackVerdict({ comments, redRunId: 2, limit: 3 });
    expect(verdict).toBe('needs-handback');
  });

  it('ignores an ordinary comment with no marker', () => {
    const comments = [comment('looks green to me')];
    const verdict = rules.handbackVerdict({ comments, redRunId: 1, limit: 3 });
    expect(verdict).toBe('needs-handback');
  });
});

describe('assessPipelinePr', () => {
  const redRunOnHead = (redRunId: number) => [run({ id: redRunId, workflow_id: 100, conclusion: 'failure' })];
  const greenRunOnHead = () => [run({ id: 1, workflow_id: 100, conclusion: 'success' })];

  it('dispatches on a red head with no prior ask, under the limit', () => {
    const result = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(5),
      comments: [],
      limit: 3,
    });
    expect(result).toMatchObject({ dispatch: true, issueNumber: 1059 });
  });

  it('does not dispatch on a green head', () => {
    const result = rules.assessPipelinePr({
      pr: pr(),
      runsOnHead: greenRunOnHead(),
      comments: [],
      limit: 3,
    });
    expect(result.dispatch).toBe(false);
  });

  it('does not dispatch when this exact red run has already been asked about', () => {
    const comments = [comment(`${rules.MARKER} abc1234 run:5`)];
    const result = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(5),
      comments,
      limit: 3,
    });
    expect(result.dispatch).toBe(false);
    expect(result.reason).toMatch(/already.asked/i);
  });

  it('does not dispatch once the attempt limit has been reached', () => {
    const comments = [
      comment(`${rules.MARKER} abc1234 run:1`),
      comment(`${rules.MARKER} def5678 run:2`),
      comment(`${rules.MARKER} ghi9012 run:3`),
    ];
    const result = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(4),
      comments,
      limit: 3,
    });
    expect(result.dispatch).toBe(false);
    expect(result.reason).toMatch(/limit/i);
  });

  // The planner's explicit edge case: an older run id was nudged about before,
  // but the head has since produced a *new* red run — the PR must still get a
  // handback for the new run, bounded by the limit rather than blocked by
  // history that belongs to a run id that no longer applies.
  it('dispatches for a new run id even though older nudges exist for a prior one', () => {
    const comments = [comment(`${rules.MARKER} abc1234 run:1`)];
    const result = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(2),
      comments,
      limit: 3,
    });
    expect(result).toMatchObject({ dispatch: true, issueNumber: 1059 });
  });

  // Idempotency under near-simultaneous runner completions: the second
  // `nudge` job run reads the comments the first one already posted.
  it('does not double-dispatch when re-assessed after its own nudge landed', () => {
    const first = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(5),
      comments: [],
      limit: 3,
    });
    expect(first.dispatch).toBe(true);

    const commentsAfterFirstNudge = [comment(`${rules.MARKER} abc1234 run:5`)];
    const second = rules.assessPipelinePr({
      pr: pr({ head: { ref: 'pipeline/feature-1059-1' } }),
      runsOnHead: redRunOnHead(5),
      comments: commentsAfterFirstNudge,
      limit: 3,
    });
    expect(second.dispatch).toBe(false);
    expect(second.reason).toMatch(/already.asked/i);
  });
});
