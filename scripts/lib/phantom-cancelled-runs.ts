/**
 * BlastSimulator2026 — Phantom-cancelled workflow run detection
 *
 * Extracted from `scripts/await-pr-ci.ts` (#780). Skeleton stubs only —
 * behavior to follow in the implementer step.
 *
 * @module phantom-cancelled-runs
 */

/** A workflow run on the head, reduced to what the verdict depends on. */
export interface WorkflowRun {
  id: number;
  /** `.github/workflows/<file>.yml` — how a run names the workflow that owns it. */
  path: string;
  name: string;
  /** Grouping key for "latest run of this workflow", stable across re-runs. */
  workflow_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/** A job on a workflow run, reduced to what a label-gate check depends on. */
export interface WorkflowJob {
  name: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export const PHANTOM_JOB_MAX_DURATION_MS = 5_000;

export function isPhantomCancelledRun(jobs: WorkflowJob[]): boolean {
  throw new Error('not implemented');
}

export function dropPhantomCancelledRuns(
  runs: WorkflowRun[],
  fetchJobs: (runId: number) => WorkflowJob[],
  isMachineryWorkflow: (path: string) => boolean
): WorkflowRun[] {
  throw new Error('not implemented');
}
