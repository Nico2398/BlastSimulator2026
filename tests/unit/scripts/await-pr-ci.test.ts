// BlastSimulator2026 — `npm run ci:await` verdict logic
//
// The script is how a pipeline run reads the channels CI owns instead of ending
// before they report — PR #581 was green on every channel its session ran and
// red on two interaction-mode shards, and the run had already exited. Every
// interesting case here is a way of reading red as green, which is the one
// mistake that puts the queue back where #581 left it.

import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  reportFailure,
  type WorkflowJob,
  type WorkflowRun,
} from '../../../scripts/await-pr-ci.js';

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

describe('arguments', () => {
  it('takes a pull request number', () => {
    expect(parseArgs(['--pr', '581'])).toMatchObject({ pr: 581 });
  });

  it('takes a head branch, which is what a run knows before its PR number', () => {
    expect(parseArgs(['--head', 'pipeline/feature-552'])).toMatchObject({
      head: 'pipeline/feature-552',
    });
  });

  // Any default here would be a guess about how long CI takes, and a wrong guess
  // turns "still running" into a reported outcome — #581's ending, reintroduced
  // the first time a shard count or a scenario suite grows. The wait ends when
  // the runs end; its real bound is the runner's own job timeout, and hitting
  // that hands the PR to `agentic-ci-failure.yml` rather than losing it.
  it('sets no deadline of its own', () => {
    expect(parseArgs(['--pr', '1'])).not.toHaveProperty('timeoutMinutes', expect.anything());
    expect((parseArgs(['--pr', '1']) as { timeoutMinutes?: number }).timeoutMinutes).toBeUndefined();
  });

  // Still available for a human who wants to stop looking.
  it('accepts a deadline when one is asked for', () => {
    expect(parseArgs(['--pr', '1', '--timeout-minutes', '20'])).toMatchObject({ timeoutMinutes: 20 });
  });

  // The poll interval is how often the question is asked, not a threshold any
  // verdict is taken on.
  it('polls on an interval that decides nothing', () => {
    expect(parseArgs(['--pr', '1'])).toMatchObject({ intervalSeconds: 30 });
    expect(parseArgs(['--pr', '1', '--interval-seconds', '5'])).toMatchObject({ intervalSeconds: 5 });
  });

  it.each([[[]], [['--pr']], [['--pr', '0']], [['--pr', 'x']], [['--nope', '1']]])(
    'refuses %j rather than waiting on the wrong thing',
    (argv) => {
      expect(parseArgs(argv as string[])).toHaveProperty('error');
    }
  );
});

// reportFailure used to shell out to `gh api` itself for a failing run's jobs.
// It now takes an injected fetchJobs function (#781) — the same shape
// dropPhantomCancelledRuns already takes — so a test can prove what it does
// with the jobs it's handed without mocking `gh`. Mocking precedent: "never
// calls fetchJobs for a solo cancelled run" in phantom-cancelled-runs.test.ts.
describe('reportFailure uses the injected job-fetch function', () => {
  it('calls fetchJobs once per failing run, with that run\'s id', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = run({ conclusion: 'failure' });
    const fetchJobs = vi.fn((): WorkflowJob[] => []);

    reportFailure([failing], fetchJobs);

    expect(fetchJobs).toHaveBeenCalledTimes(1);
    expect(fetchJobs).toHaveBeenCalledWith(failing.id);
    logSpy.mockRestore();
  });

  it('never calls fetchJobs when no run failed', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const passing = run({ conclusion: 'success' });
    const fetchJobs = vi.fn((): WorkflowJob[] => []);

    reportFailure([passing], fetchJobs);

    expect(fetchJobs).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('never calls fetchJobs for a run still in progress', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const inProgress = run({ status: 'in_progress', conclusion: null });
    const fetchJobs = vi.fn((): WorkflowJob[] => []);

    reportFailure([inProgress], fetchJobs);

    expect(fetchJobs).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("logs the failing job's name (and not a passing job's name) from what fetchJobs returns", () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = run({ conclusion: 'failure' });
    const failingJob = job({ name: 'Scenarios (interaction mode) — shard 2/4', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/1/job/2' });
    const passingJob = job({ name: 'Scenarios (interaction mode) — shard 1/4', conclusion: 'success' });
    const fetchJobs = (): WorkflowJob[] => [passingJob, failingJob];

    reportFailure([failing], fetchJobs);

    const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain(failingJob.name);
    expect(logged).not.toContain(passingJob.name);
    logSpy.mockRestore();
  });

  it('falls back to the existing "could not be listed" message when fetchJobs throws', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failing = run({ conclusion: 'failure' });
    const fetchJobs = (): WorkflowJob[] => { throw new Error('gh api failed'); };

    reportFailure([failing], fetchJobs);

    const logged = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('(jobs could not be listed; open the run URL above)');
    logSpy.mockRestore();
  });

  it('calls fetchJobs once per distinct failing run across multiple workflows, not for a passing one', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const failingA = run({ workflow_id: 1, conclusion: 'failure' });
    const failingB = run({ workflow_id: 2, conclusion: 'timed_out' });
    const passing = run({ workflow_id: 3, conclusion: 'success' });
    const fetchJobs = vi.fn((_runId: number): WorkflowJob[] => []);

    reportFailure([failingA, failingB, passing], fetchJobs);

    expect(fetchJobs).toHaveBeenCalledTimes(2);
    const calledIds = fetchJobs.mock.calls.map((args) => args[0]).sort((a, b) => a - b);
    expect(calledIds).toEqual([failingA.id, failingB.id].sort((a, b) => a - b));
    logSpy.mockRestore();
  });
});

// The phantom-cancelled-run detection tests (#772) -- "dropping a phantom
// cancelled run (#772)" and "isPhantomCancelledRun" -- live in
// tests/unit/scripts/phantom-cancelled-runs.test.ts alongside the extracted
// module (#780).
//
// The verdict tests ("reading the workflow runs on a pull request head", "one
// run per workflow, the newest", "the merge machinery is not a verification
// channel") live in tests/unit/scripts/workflow-verdict.test.ts alongside the
// extracted scripts/lib/workflow-verdict.ts (#785).
//
// The label-gate tests ("asking a CI run's own jobs before trusting its
// conclusion", "wantedGatedLabels") live in
// tests/unit/scripts/label-gated-jobs.test.ts alongside the extracted
// scripts/lib/label-gated-jobs.ts (#785).
