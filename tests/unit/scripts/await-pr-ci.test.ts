// BlastSimulator2026 — `npm run ci:await` verdict logic
//
// The script is how a pipeline run reads the channels CI owns instead of ending
// before they report — PR #581 was green on every channel its session ran and
// red on two interaction-mode shards, and the run had already exited. Every
// interesting case here is a way of reading red as green, which is the one
// mistake that puts the queue back where #581 left it.

import { describe, it, expect } from 'vitest';
import {
  isMachineryWorkflow,
  latestRunPerWorkflow,
  missingGatedJobs,
  parseArgs,
  verdictOf,
  wantedGatedLabels,
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

describe('reading the workflow runs on a pull request head', () => {
  it('is green only when every run has completed successfully', () => {
    expect(verdictOf([run({ workflow_id: 1 }), run({ workflow_id: 2 })])).toBe('green');
  });

  it('is red when any run failed', () => {
    expect(verdictOf([
      run({ workflow_id: 1 }),
      run({ workflow_id: 2, conclusion: 'failure' }),
    ])).toBe('red');
  });

  it('is pending while a run is still going', () => {
    expect(verdictOf([
      run({ workflow_id: 1 }),
      run({ workflow_id: 2, status: 'in_progress', conclusion: null }),
    ])).toBe('pending');
  });

  // The trap `agentic-auto-merge`'s `total === 0` guard exists for: a head read
  // before its CI run is created has nothing failing and nothing running.
  it('is pending, never green, on a head that has reported nothing', () => {
    expect(verdictOf([])).toBe('pending');
  });

  it('reads a failure as red even while another run is still going', () => {
    expect(verdictOf([
      run({ workflow_id: 1, conclusion: 'failure' }),
      run({ workflow_id: 2, status: 'in_progress', conclusion: null }),
    ])).toBe('red');
  });

  it.each(['cancelled', 'timed_out', 'startup_failure', 'stale'])(
    'treats a %s run as red — nothing is going to repeat it',
    (conclusion) => {
      expect(verdictOf([run({ conclusion })])).toBe('red');
    }
  );

  // `claude-code-review.yml` reports `skipped` on every pipeline PR, and
  // `Production build` does the same without the `build-check` label.
  it.each(['skipped', 'neutral'])('treats a %s run as green', (conclusion) => {
    expect(verdictOf([run({ conclusion })])).toBe('green');
  });
});

describe('one run per workflow, the newest', () => {
  // CI declares `cancel-in-progress: true`, so every fix a run pushes leaves a
  // `cancelled` run behind on the same head. Counted, it makes the PR
  // permanently red and the run can never converge.
  it('drops a run superseded by a newer one of the same workflow', () => {
    const runs = [
      run({ id: 10, workflow_id: 7, status: 'completed', conclusion: 'cancelled' }),
      run({ id: 11, workflow_id: 7, status: 'completed', conclusion: 'success' }),
    ];
    expect(latestRunPerWorkflow(runs).map((r) => r.id)).toEqual([11]);
    expect(verdictOf(runs)).toBe('green');
  });

  it('keeps runs of different workflows apart', () => {
    const runs = [run({ workflow_id: 1 }), run({ workflow_id: 2 })];
    expect(latestRunPerWorkflow(runs)).toHaveLength(2);
  });
});

describe('the merge machinery is not a verification channel', () => {
  // `agentic-auto-merge.yml` runs on `workflow_run`, so it carries the head SHA
  // of the CI run that woke it. It is pending until CI has been read and it
  // fails on a PR it could not arm, so counting it makes the wait circular.
  // The runners are the same circularity, sharper: this script runs inside the
  // runner job, so its own run is never `completed` while it is being read.
  it.each([
    '.github/workflows/agentic-auto-merge.yml',
    '.github/workflows/agentic-ci-failure.yml',
    '.github/workflows/agentic-watchdog.yml',
    '.github/workflows/auto-assign-next.yml',
    '.github/workflows/handle-failure.yml',
    '.github/workflows/claude-runner.yml',
    '.github/workflows/opencode-runner.yml',
  ])('ignores %s', (path) => {
    expect(isMachineryWorkflow(path)).toBe(true);
    expect(verdictOf([run({ path, conclusion: 'failure' })])).toBe('pending');
  });

  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/claude-code-review.yml',
  ])('reads %s', (path) => {
    expect(isMachineryWorkflow(path)).toBe(false);
    expect(verdictOf([run({ path })])).toBe('green');
  });

  // PR #773, exactly. `agentic-closing-keyword-guard.yml` is a verification
  // check whose *name* used to exempt it from the verdict, under a
  // `^agentic-` prefix rule. Its job failed, this script reported GREEN, the
  // session ended as instructed, and the PR sat unmergeable with nobody
  // watching. A check is a check whatever its file is called.
  it('reads the closing-keyword guard, whose name starts with `agentic-`', () => {
    const path = '.github/workflows/agentic-closing-keyword-guard.yml';
    expect(isMachineryWorkflow(path)).toBe(false);
    expect(verdictOf([run({ path, conclusion: 'failure' })])).toBe('red');
  });

  // The direction of the rule, stated as a test: an unknown workflow is a
  // channel. Fail-closed — forgetting to declare new machinery costs a wait,
  // forgetting to declare a new channel used to cost a silent merge failure.
  it('counts an unrecognised workflow as a channel rather than machinery', () => {
    const path = '.github/workflows/some-future-check.yml';
    expect(isMachineryWorkflow(path)).toBe(false);
    expect(verdictOf([run({ path, conclusion: 'failure' })])).toBe('red');
  });
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

// #615's actual failure mode: a workflow run's own `conclusion` is `success`
// the instant every job in it either passed or was skipped, so `verdictOf`
// alone cannot tell a genuinely green full-ci PR from one whose interaction
// shards silently never ran. Kept in step with the same-named check in
// `.github/actions/agentic-auto-merge/action.yml`.
describe("asking a CI run's own jobs before trusting its conclusion", () => {
  const job = (over: Partial<WorkflowJob> = {}): WorkflowJob => ({
    name: 'Scenarios (interaction mode) — shard 1/4',
    conclusion: 'success',
    ...over,
  });

  it('is a no-op when the PR carries no gated label', () => {
    expect(missingGatedJobs([], [])).toEqual([]);
    expect(missingGatedJobs([], [job({ conclusion: null })])).toEqual([]);
  });

  it('clears full-ci once every interaction shard reports success', () => {
    const jobs = [1, 2, 3, 4].map((n) =>
      job({ name: `Scenarios (interaction mode) — shard ${n}/4` })
    );
    expect(missingGatedJobs(['full-ci'], jobs)).toEqual([]);
  });

  // The exact #615 shape: the run reports `success`, but the label's job
  // never appears in its own job list at all.
  it('flags full-ci when the interaction job never ran', () => {
    expect(missingGatedJobs(['full-ci'], [])).toEqual(['full-ci']);
    expect(missingGatedJobs(['full-ci'], [job({ name: 'TypeScript type check' })])).toEqual(['full-ci']);
  });

  it('flags full-ci when a shard is present but did not succeed', () => {
    const jobs = [job({ name: 'Scenarios (interaction mode) — shard 1/4', conclusion: 'success' }),
      job({ name: 'Scenarios (interaction mode) — shard 2/4', conclusion: 'failure' })];
    expect(missingGatedJobs(['full-ci'], jobs)).toEqual(['full-ci']);
  });

  it('checks build-check against the Production build job independently of full-ci', () => {
    expect(missingGatedJobs(['build-check'], [job({ name: 'Production build' })])).toEqual([]);
    expect(missingGatedJobs(['build-check'], [])).toEqual(['build-check']);
  });

  it('reports every missing gated label when a PR carries more than one', () => {
    expect(missingGatedJobs(['full-ci', 'build-check'], [])).toEqual(['full-ci', 'build-check']);
  });

  it('does not flag a `skipped` job as failing when its label is absent', () => {
    // Production build reports `skipped` on every PR without build-check —
    // that is the normal, correct case, not evidence of anything missing.
    expect(missingGatedJobs([], [job({ name: 'Production build', conclusion: 'skipped' })])).toEqual([]);
  });
});

// wantedGatedLabels is the fail-closed answer for when no ci.yml run exists
// on the head at all -- main() used to fall through to `missing = []` (a
// pass) in exactly that case, disagreeing with agentic-auto-merge's own
// `ciRuns.length === 0` branch, which already failed closed. A code-review
// round on PR #638 found the disagreement independently twice before this
// test existed.
describe('wantedGatedLabels — the fail-closed case when no ci.yml run exists at all', () => {
  it('is empty when the PR carries no gated label', () => {
    expect(wantedGatedLabels([])).toEqual([]);
    expect(wantedGatedLabels(['agent-task', 'ready'])).toEqual([]);
  });

  it('names every gated label the PR carries, with no jobs to consult', () => {
    expect(wantedGatedLabels(['full-ci'])).toEqual(['full-ci']);
    expect(wantedGatedLabels(['build-check'])).toEqual(['build-check']);
    expect(wantedGatedLabels(['full-ci', 'build-check'])).toEqual(['full-ci', 'build-check']);
  });
});
