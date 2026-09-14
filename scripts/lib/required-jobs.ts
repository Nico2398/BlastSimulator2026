/**
 * BlastSimulator2026 — Required-job verification
 *
 * Extracted from scripts/await-pr-ci.ts (#785).
 *
 * @module required-jobs
 */

import type { WorkflowJob } from './phantom-cancelled-runs.js';

/**
 * Jobs every pull request's CI run must actually contain and pass. A CI
 * run's own `success` conclusion is not evidence for them on its own: the
 * run reports `success` the moment every job in it either passed or was
 * skipped, and a job that never ran is indistinguishable from that at the
 * run level. PR #615 merged exactly that way, with its interaction shards
 * silently absent while the run read green. Both run on every pull request
 * unconditionally, and this check is what says so out loud when a run
 * somehow lacks them. Kept in step with the same-named list in
 * `.github/actions/agentic-auto-merge/action.yml` — the two decide whether a
 * PR may end a run and whether it may merge, and must not disagree about it.
 */
const REQUIRED_JOBS: { jobNamePrefix: string }[] = [
  { jobNamePrefix: 'Scenarios (interaction mode)' },
  { jobNamePrefix: 'Production build' },
];

/** Required job-name prefixes that did not fully report `success` among `jobs`. */
export function missingRequiredJobs(jobs: WorkflowJob[]): string[] {
  return REQUIRED_JOBS
    .filter((g) => {
      const matches = jobs.filter((j) => j.name.startsWith(g.jobNamePrefix));
      return matches.length === 0 || !matches.every((j) => j.conclusion === 'success');
    })
    .map((g) => g.jobNamePrefix);
}

/**
 * Every required job-name prefix — the fail-closed answer for when no
 * `ci.yml` run exists on the head at all to ask `missingRequiredJobs` about
 * (a workflow-file syntax error, or a run not yet indexed by the runs API).
 * Mirrors `agentic-auto-merge/action.yml`'s own `ciRuns.length === 0`
 * branch, which treats "no run found" as every required job missing rather
 * than as a pass: reporting green on a run that never happened is exactly
 * the absence-of-evidence gap this check exists to close.
 */
export function allRequiredJobs(): string[] {
  return REQUIRED_JOBS.map((g) => g.jobNamePrefix);
}
