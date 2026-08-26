/**
 * BlastSimulator2026 — Label-gated job verification
 *
 * Extracted from scripts/await-pr-ci.ts (#785).
 *
 * @module label-gated-jobs
 */

import type { WorkflowJob } from './phantom-cancelled-runs.js';

/**
 * A label that gates a job (`full-ci` -> the interaction-mode shards,
 * `build-check` -> the production build) makes a CI run's own `success`
 * conclusion insufficient evidence on its own: the run reports `success` the
 * moment every job in it either passed or was skipped, and a job skipped
 * because its `if:` guard was evaluated before the label existed is
 * indistinguishable from that at the run level. PR #615 merged exactly that
 * way. Kept in step with the same-named check in
 * `.github/actions/agentic-auto-merge/action.yml` — the two decide whether a
 * PR may end a run and whether it may merge, and must not disagree about it.
 */
const LABEL_GATED_JOBS: { label: string; jobNamePrefix: string }[] = [
  { label: 'full-ci', jobNamePrefix: 'Scenarios (interaction mode)' },
  { label: 'build-check', jobNamePrefix: 'Production build' },
];

/** Gated labels whose job did not fully report `success` among `jobs`. */
export function missingGatedJobs(labels: string[], jobs: WorkflowJob[]): string[] {
  const wanted = LABEL_GATED_JOBS.filter((g) => labels.includes(g.label));
  return wanted
    .filter((g) => {
      const matches = jobs.filter((j) => j.name.startsWith(g.jobNamePrefix));
      return matches.length === 0 || !matches.every((j) => j.conclusion === 'success');
    })
    .map((g) => g.label);
}

/**
 * Which of `LABEL_GATED_JOBS`' labels a PR carries — the fail-closed answer
 * for when no `ci.yml` run exists on the head at all to ask `missingGatedJobs`
 * about (a workflow-file syntax error, or a run not yet indexed by the runs
 * API). Mirrors `agentic-auto-merge/action.yml`'s own `ciRuns.length === 0`
 * branch, which already treats "no run found" as every wanted label missing
 * rather than as a pass — the two must not disagree about it, and reporting
 * green on a run that never happened is exactly the absence-of-evidence gap
 * this whole check exists to close.
 */
export function wantedGatedLabels(labels: string[]): string[] {
  return LABEL_GATED_JOBS.filter((g) => labels.includes(g.label)).map((g) => g.label);
}
