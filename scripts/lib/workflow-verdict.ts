/**
 * BlastSimulator2026 — Workflow-run verdict logic
 *
 * Extracted from scripts/await-pr-ci.ts (#785).
 *
 * @module workflow-verdict
 */

import type { WorkflowRun } from './phantom-cancelled-runs.js';

export type Verdict = 'green' | 'red' | 'pending';

/**
 * Conclusions that mean nothing is going to repeat this run. `cancelled` and
 * `stale` sit with the failures because the dedup below already drops a
 * superseded run — one that survives it was cancelled for good. `skipped` and
 * `neutral` are not failures: `claude-code-review.yml` reports `skipped` on
 * every pipeline PR, and `Production build` does the same without `build-check`.
 *
 * Kept in step with `RUN_FAILURES` in `.github/actions/agentic-auto-merge`: the
 * action decides whether the PR merges, this script decides whether the run
 * that opened it may end, and the two must not disagree about what red means.
 */
export const RUN_FAILURES = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'stale']);

/**
 * Workflows that are the merge machinery rather than a verification channel.
 *
 * `agentic-auto-merge.yml` runs on `workflow_run`, so its own run carries the
 * head SHA of the CI run that woke it and shows up in this list. Counting it
 * would be circular twice over: it is pending until CI has been read, and it
 * fails the step on a marked PR it could not arm — which is a report about the
 * merge, not about the code. The runners are here for the sharper version of
 * the same circularity: this script runs *inside* the runner job, so counting
 * that job's own run would make every wait pend until the 360-minute timeout.
 *
 * **Named one by one, never by prefix.** This was `/^\.github\/workflows\/
 * (agentic-|auto-assign-next|handle-failure)/` and it failed open: every new
 * workflow whose file happened to start with `agentic-` exempted itself from
 * the verdict by its name alone. `agentic-closing-keyword-guard.yml` (#765) is
 * a verification check that did exactly that, and PR #773 is the bill — its
 * guard job failed at 23:52, this script read GREEN at 00:06 because the run
 * was filtered out here, the session ended having done everything it was told,
 * and the pull request sat `unstable` and unmergeable with nobody watching.
 *
 * So the direction is inverted: a workflow counts as a channel unless it is
 * named below. A new verification workflow is read with no edit here; a new
 * machinery workflow that forgets this list costs a wait, which is the safe
 * half of the mistake.
 */
const MACHINERY_WORKFLOWS: ReadonlySet<string> = new Set([
  'agentic-auto-merge.yml',
  'agentic-ci-failure.yml',
  'agentic-intake.yml',
  'agentic-trigger.yml',
  'agentic-watchdog.yml',
  'auto-assign-next.yml',
  'claude-runner.yml',
  'handle-failure.yml',
  'opencode-runner.yml',
]);

export const isMachineryWorkflow = (path: string): boolean => {
  void path;
  void MACHINERY_WORKFLOWS;
  throw new Error('not implemented');
};

/**
 * One run per workflow: the newest. CI declares `cancel-in-progress: true`, so a
 * pushed fix leaves the superseded run on the same head, `cancelled` forever. Read
 * without this dedup, every fix a run pushes makes its own PR permanently red.
 */
export function latestRunPerWorkflow(runs: WorkflowRun[]): WorkflowRun[] {
  void runs;
  throw new Error('not implemented');
}

/**
 * `pending` on an empty list, deliberately. A head read in the second before its
 * CI run is created has nothing failing and nothing running, and calling that
 * green reports a pass on channels no machine ever ran — the same trap
 * `agentic-auto-merge`'s `total === 0` guard exists for.
 */
export function verdictOf(runs: WorkflowRun[]): Verdict {
  void runs;
  throw new Error('not implemented');
}
