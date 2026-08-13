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
  parseArgs,
  verdictOf,
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
  it.each([
    '.github/workflows/agentic-auto-merge.yml',
    '.github/workflows/agentic-watchdog.yml',
    '.github/workflows/auto-assign-next.yml',
    '.github/workflows/handle-failure.yml',
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

  // Long enough to outlive the sharded interaction-mode job, which is the
  // slowest channel CI owns.
  it('waits long enough for the slowest channel by default', () => {
    const parsed = parseArgs(['--pr', '1']);
    expect(parsed).toMatchObject({ timeoutMinutes: 45 });
    expect((parsed as { timeoutMinutes: number }).timeoutMinutes).toBeGreaterThan(12);
  });

  it.each([[[]], [['--pr']], [['--pr', '0']], [['--pr', 'x']], [['--nope', '1']]])(
    'refuses %j rather than waiting on the wrong thing',
    (argv) => {
      expect(parseArgs(argv as string[])).toHaveProperty('error');
    }
  );
});
