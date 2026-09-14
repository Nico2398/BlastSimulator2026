// BlastSimulator2026 — required-job verification
//
// Extracted from `tests/unit/scripts/await-pr-ci.test.ts` (#785) alongside
// `scripts/lib/required-jobs.ts` (then `label-gated-jobs`). #615's actual
// failure mode: a workflow run's own `conclusion` is `success` the instant
// every job in it either passed or was skipped, so a run-level verdict alone
// cannot tell a genuinely green PR from one whose interaction shards silently
// never ran. The jobs are unconditional now, and this is what says so out
// loud when a run somehow lacks them. Kept in step with the same-named check
// in `.github/actions/agentic-auto-merge/action.yml`.

import { describe, it, expect } from 'vitest';
import { missingRequiredJobs, allRequiredJobs } from '../../../scripts/lib/required-jobs.js';
import type { WorkflowJob } from '../../../scripts/lib/phantom-cancelled-runs.js';

/**
 * `started_at`/`completed_at` are omitted by default (rather than set to
 * `undefined`) so every call site — which never passes them — stays valid
 * unchanged, and so this satisfies `exactOptionalPropertyTypes`:
 * `T | null` accepts a missing key or an explicit `null`, never `undefined`.
 */
const job = (over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  name: 'Scenarios (interaction mode) — shard 1/4',
  conclusion: 'success',
  ...over,
});

const INTERACTION = 'Scenarios (interaction mode)';
const BUILD = 'Production build';
const shards = (n: number, conclusion = 'success') =>
  Array.from({ length: n }, (_, i) => job({ name: `${INTERACTION} — shard ${i + 1}/${n}`, conclusion }));

describe("asking a CI run's own jobs before trusting its conclusion", () => {
  it('clears once every interaction shard and the build report success', () => {
    expect(missingRequiredJobs([...shards(4), job({ name: BUILD })])).toEqual([]);
  });

  // The exact #615 shape: the run reports `success`, but the job never
  // appears in its own job list at all.
  it('flags the interaction job when it never ran', () => {
    expect(missingRequiredJobs([job({ name: BUILD })])).toEqual([INTERACTION]);
    expect(missingRequiredJobs([job({ name: 'TypeScript type check' }), job({ name: BUILD })])).toEqual([INTERACTION]);
  });

  it('flags the interaction job when a shard is present but did not succeed', () => {
    const jobs = [job({ name: `${INTERACTION} — shard 1/4`, conclusion: 'success' }),
      job({ name: `${INTERACTION} — shard 2/4`, conclusion: 'failure' }), job({ name: BUILD })];
    expect(missingRequiredJobs(jobs)).toEqual([INTERACTION]);
  });

  it('flags a skipped shard as missing — skipped is the #615 shape, not a pass', () => {
    expect(missingRequiredJobs([...shards(2, 'skipped'), job({ name: BUILD })])).toEqual([INTERACTION]);
  });

  it('checks the build independently of the shards', () => {
    expect(missingRequiredJobs(shards(4))).toEqual([BUILD]);
    expect(missingRequiredJobs([...shards(4), job({ name: BUILD, conclusion: 'skipped' })])).toEqual([BUILD]);
  });

  it('reports every missing required job when more than one is absent', () => {
    expect(missingRequiredJobs([])).toEqual([INTERACTION, BUILD]);
    expect(missingRequiredJobs([job({ name: 'Coverage thresholds' })])).toEqual([INTERACTION, BUILD]);
  });
});

// allRequiredJobs is the fail-closed answer for when no ci.yml run exists on
// the head at all -- main() used to fall through to `missing = []` (a pass)
// in exactly that case, disagreeing with agentic-auto-merge's own
// `ciRuns.length === 0` branch, which already failed closed. A code-review
// round on PR #638 found the disagreement independently twice before this
// test existed.
describe('allRequiredJobs — the fail-closed case when no ci.yml run exists at all', () => {
  it('names every required job, with no jobs to consult', () => {
    expect(allRequiredJobs()).toEqual([INTERACTION, BUILD]);
  });

  it('is exactly the set missingRequiredJobs reports for an empty job list', () => {
    expect(allRequiredJobs()).toEqual(missingRequiredJobs([]));
  });
});
