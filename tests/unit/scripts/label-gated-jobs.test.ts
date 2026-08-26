// BlastSimulator2026 — label-gated job verification
//
// Extracted from `tests/unit/scripts/await-pr-ci.test.ts` (#785) alongside
// `scripts/lib/label-gated-jobs.ts`. #615's actual failure mode: a workflow
// run's own `conclusion` is `success` the instant every job in it either
// passed or was skipped, so a run-level verdict alone cannot tell a genuinely
// green full-ci PR from one whose interaction shards silently never ran.
// Kept in step with the same-named check in
// `.github/actions/agentic-auto-merge/action.yml`.

import { describe, it, expect } from 'vitest';
import {
  missingGatedJobs,
  wantedGatedLabels,
} from '../../../scripts/lib/label-gated-jobs.js';
import type { WorkflowJob } from '../../../scripts/lib/phantom-cancelled-runs.js';

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

describe("asking a CI run's own jobs before trusting its conclusion", () => {
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
