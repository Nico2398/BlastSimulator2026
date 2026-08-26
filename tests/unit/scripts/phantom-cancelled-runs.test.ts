// BlastSimulator2026 — phantom-cancelled workflow run detection
//
// Extracted from `tests/unit/scripts/await-pr-ci.test.ts` (#780). #772: GitHub
// firing two `pull_request` events for one head (PR-open + label-attach
// near-simultaneously) starts two `CI` runs under one concurrency group. One
// completes green; the other is cancelled before its matrix ever expanded —
// zero real jobs. Read naively, that phantom cancellation reads RED even
// though every real check passed. `dropPhantomCancelledRuns` is the
// fix's fact-finder: it drops a cancelled run only when a sibling of the same
// workflow on the same head has real job activity to fall back on.

import { describe, it, expect, vi } from 'vitest';
import {
  dropPhantomCancelledRuns,
  isPhantomCancelledRun,
  type WorkflowJob,
  type WorkflowRun,
} from '../../../scripts/lib/phantom-cancelled-runs.js';

let nextId = 1;

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => {
  const id = over.id ?? nextId++;
  return {
    id,
    path: '.github/workflows/ci.yml',
    name: 'CI',
    workflow_id: 100,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    ...over,
  };
};

/**
 * `started_at`/`completed_at` are omitted by default (rather than set to
 * `undefined`) so every pre-existing call site — which never passed them —
 * stays valid unchanged, and so this satisfies `exactOptionalPropertyTypes`:
 * `T | null` accepts a missing key or an explicit `null`, never `undefined`.
 */
const job = (over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  name: 'Scenarios (interaction mode) — shard 1/4',
  conclusion: 'success',
  ...over,
});

// None of these fixtures ever build a run on a machinery workflow path (they
// all default to `.github/workflows/ci.yml`), so a stub that always answers
// "not machinery" matches the real predicate's behavior for every input this
// suite exercises.
const isMachineryWorkflow = (_path: string): boolean => false;

describe('dropping a phantom cancelled run (#772)', () => {
  const ZERO_DURATION = '2026-01-01T00:00:00.000Z';

  it('drops a cancelled run whose matrix never expanded, sibling reports success', () => {
    const successRun = run({ id: 20, workflow_id: 50, status: 'completed', conclusion: 'success' });
    const cancelledRun = run({ id: 21, workflow_id: 50, status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = (): WorkflowJob[] => [];

    const dropped = dropPhantomCancelledRuns([successRun, cancelledRun], fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id)).toEqual([20]);
  });

  it('drops a cancelled run whose jobs are present but all cancelled at ~0 duration', () => {
    const successRun = run({ id: 30, workflow_id: 60, status: 'completed', conclusion: 'success' });
    const cancelledRun = run({ id: 31, workflow_id: 60, status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = (runId: number): WorkflowJob[] =>
      runId === cancelledRun.id
        ? [
            job({ conclusion: 'cancelled', started_at: ZERO_DURATION, completed_at: ZERO_DURATION }),
            job({ conclusion: 'cancelled', started_at: ZERO_DURATION, completed_at: ZERO_DURATION }),
          ]
        : [];

    const dropped = dropPhantomCancelledRuns([successRun, cancelledRun], fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id)).toEqual([30]);
  });

  it('leaves the existing genuine-supersede scenario unchanged when run through the phantom filter', () => {
    // Same fixture shape as await-pr-ci's own "drops a run superseded by a
    // newer one of the same workflow" test — cancel-in-progress leaving an
    // old cancelled run behind a newer success. Its own job ran for real, so
    // it is not phantom.
    const cancelledRun = run({ id: 10, workflow_id: 7, status: 'completed', conclusion: 'cancelled' });
    const successRun = run({ id: 11, workflow_id: 7, status: 'completed', conclusion: 'success' });
    const runs = [cancelledRun, successRun];
    const fetchJobs = (runId: number): WorkflowJob[] =>
      runId === cancelledRun.id
        ? [job({ conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:45.000Z' })]
        : [];

    const dropped = dropPhantomCancelledRuns(runs, fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it('keeps a genuinely cancelled run when it has no sibling to fall back on', () => {
    const soloRun = run({ id: 40, workflow_id: 70, status: 'completed', conclusion: 'cancelled' });
    const realJobs = [
      job({ conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:45.000Z' }),
    ];
    expect(isPhantomCancelledRun(realJobs)).toBe(false);

    const fetchJobs = (runId: number): WorkflowJob[] => (runId === soloRun.id ? realJobs : []);
    const dropped = dropPhantomCancelledRuns([soloRun], fetchJobs, isMachineryWorkflow);

    expect(dropped).toEqual([soloRun]);
  });

  // The test above never actually exercises real-vs-phantom job data — it
  // exits on `group.length < 2` before `fetchJobs` is ever called. This is
  // the case its name implies: a solo cancelled run whose jobs, if they were
  // consulted, would look phantom. It still stays, because with no
  // sibling to fall back on there is nothing to justify dropping it — proving
  // the "no sibling" guard, not the phantom check, is what protects it.
  it('keeps a solo cancelled run even when its own jobs look phantom', () => {
    const soloRun = run({ id: 41, workflow_id: 71, status: 'completed', conclusion: 'cancelled' });
    const phantomJobs = [
      job({ conclusion: 'cancelled', started_at: ZERO_DURATION, completed_at: ZERO_DURATION }),
    ];
    expect(isPhantomCancelledRun(phantomJobs)).toBe(true);
    expect(isPhantomCancelledRun([])).toBe(true);

    const fetchJobs = (runId: number): WorkflowJob[] => (runId === soloRun.id ? phantomJobs : []);
    const dropped = dropPhantomCancelledRuns([soloRun], fetchJobs, isMachineryWorkflow);

    expect(dropped).toEqual([soloRun]);
  });

  it('keeps a cancelled run with a sibling when at least one of its own jobs ran for real', () => {
    const successRun = run({ id: 50, workflow_id: 80, status: 'completed', conclusion: 'success' });
    const cancelledRun = run({ id: 51, workflow_id: 80, status: 'completed', conclusion: 'cancelled' });
    const mixedJobs = [
      job({ name: 'TypeScript type check', conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:30.000Z' }),
      job({ name: 'Unit tests', conclusion: 'cancelled', started_at: ZERO_DURATION, completed_at: ZERO_DURATION }),
    ];
    const fetchJobs = (runId: number): WorkflowJob[] => (runId === cancelledRun.id ? mixedJobs : []);

    const dropped = dropPhantomCancelledRuns([successRun, cancelledRun], fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id).sort((a, b) => a - b)).toEqual([50, 51]);
  });

  it('drops every phantom cancelled run when more than one exists alongside a real success', () => {
    const runA = run({ id: 60, workflow_id: 90, status: 'completed', conclusion: 'success' });
    const runB = run({ id: 61, workflow_id: 90, status: 'completed', conclusion: 'cancelled' });
    const runC = run({ id: 62, workflow_id: 90, status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = (): WorkflowJob[] => [];

    const dropped = dropPhantomCancelledRuns([runA, runB, runC], fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id)).toEqual([60]);
  });

  it('keeps every run and logs when a whole workflow group is phantom, dropping nothing', () => {
    const runX = run({ id: 70, workflow_id: 95, name: 'Phantom Only Workflow', status: 'completed', conclusion: 'cancelled' });
    const runY = run({ id: 71, workflow_id: 95, name: 'Phantom Only Workflow', status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = (): WorkflowJob[] => [
      job({ conclusion: 'cancelled', started_at: ZERO_DURATION, completed_at: ZERO_DURATION }),
    ];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dropped = dropPhantomCancelledRuns([runX, runY], fetchJobs, isMachineryWorkflow);

    expect(dropped.map((r) => r.id).sort((a, b) => a - b)).toEqual([70, 71]);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes('Phantom Only Workflow'))).toBe(true);
    errorSpy.mockRestore();
  });

  it('never calls fetchJobs for a solo cancelled run with no sibling on the head', () => {
    const soloRun = run({ id: 80, workflow_id: 99, status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = vi.fn((): WorkflowJob[] => []);

    const dropped = dropPhantomCancelledRuns([soloRun], fetchJobs, isMachineryWorkflow);

    expect(fetchJobs).not.toHaveBeenCalled();
    expect(dropped).toEqual([soloRun]);
  });

  // Machinery workflows are skipped from grouping (they're ignored by the
  // verdict downstream in await-pr-ci.ts anyway), so a phantom-cancelled
  // machinery run's sibling is never consulted and the run passes through
  // untouched — proving the injected predicate is actually applied, not just
  // accepted and ignored.
  it('skips grouping entirely for a machinery workflow, even when phantom-cancelled', () => {
    const machineryPath = '.github/workflows/agentic-auto-merge.yml';
    const runA = run({ id: 90, workflow_id: 200, path: machineryPath, status: 'completed', conclusion: 'success' });
    const runB = run({ id: 91, workflow_id: 200, path: machineryPath, status: 'completed', conclusion: 'cancelled' });
    const fetchJobs = vi.fn((): WorkflowJob[] => []);
    const realIsMachineryWorkflow = (path: string): boolean => path === machineryPath;

    const dropped = dropPhantomCancelledRuns([runA, runB], fetchJobs, realIsMachineryWorkflow);

    expect(fetchJobs).not.toHaveBeenCalled();
    expect(dropped.map((r) => r.id).sort((a, b) => a - b)).toEqual([90, 91]);
  });
});

describe('isPhantomCancelledRun', () => {
  it('is true for an empty job list — the matrix never expanded', () => {
    expect(isPhantomCancelledRun([])).toBe(true);
  });

  it('is true when every job is cancelled at ~0 duration', () => {
    const t = '2026-01-01T00:00:00.000Z';
    expect(isPhantomCancelledRun([
      job({ conclusion: 'cancelled', started_at: t, completed_at: t }),
      job({ conclusion: 'cancelled', started_at: t, completed_at: t }),
    ])).toBe(true);
  });

  it('is false when a job succeeded for real', () => {
    expect(isPhantomCancelledRun([
      job({ conclusion: 'success', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:30.000Z' }),
    ])).toBe(false);
  });

  it('is false when a cancelled job ran for a real duration before being killed', () => {
    expect(isPhantomCancelledRun([
      job({ conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:01:00.000Z' }),
    ])).toBe(false);
  });

  // The code uses `<=`, so exactly PHANTOM_JOB_MAX_DURATION_MS (5000ms) counts
  // as phantom — this pins the boundary rather than just either side of it.
  it('is true at exactly the 5000ms phantom-duration boundary', () => {
    expect(isPhantomCancelledRun([
      job({ conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z', completed_at: '2026-01-01T00:00:05.000Z' }),
    ])).toBe(true);
  });

  // jobDurationMs is not exported; a job missing either timestamp is the only
  // way to exercise its "treat as 0 duration" branch from here.
  it('treats a job with a missing timestamp as zero duration — phantom if cancelled', () => {
    expect(isPhantomCancelledRun([
      job({ conclusion: 'cancelled', completed_at: '2026-01-01T00:01:00.000Z' }),
    ])).toBe(true);
    expect(isPhantomCancelledRun([
      job({ conclusion: 'cancelled', started_at: '2026-01-01T00:00:00.000Z' }),
    ])).toBe(true);
  });
});
