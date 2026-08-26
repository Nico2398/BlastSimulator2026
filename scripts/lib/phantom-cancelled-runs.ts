/**
 * BlastSimulator2026 — Phantom-cancelled workflow run detection
 *
 * Extracted from `scripts/await-pr-ci.ts` (#780).
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
  html_url?: string;
}

/**
 * A job counts as "never actually ran" below this duration. 5s sits above
 * scheduling/HTTP overhead and below the fastest real job in ci.yml
 * (typecheck, tens of seconds). Reverse by changing this constant.
 */
export const PHANTOM_JOB_MAX_DURATION_MS = 5_000;

function jobDurationMs(job: WorkflowJob): number {
  if (!job.started_at || !job.completed_at) return 0;
  return new Date(job.completed_at).getTime() - new Date(job.started_at).getTime();
}

/**
 * True when a completed-cancelled run never did real work: no jobs at all
 * (matrix never expanded), or every job cancelled at ~0 duration.
 */
export function isPhantomCancelledRun(jobs: WorkflowJob[]): boolean {
  if (jobs.length === 0) return true;
  return jobs.every((job) => job.conclusion === 'cancelled' && jobDurationMs(job) <= PHANTOM_JOB_MAX_DURATION_MS);
}

/**
 * Drops a cancelled run this script would otherwise treat as authoritative
 * but that never actually ran — GitHub firing two `pull_request` events for
 * one head under one concurrency group (#772). Dropped only when a sibling
 * run of the same workflow on the same head has real job activity to fall
 * back on. If every run for a workflow is phantom, none are dropped and a
 * clear message is logged instead — fail loud, not silent.
 */
export function dropPhantomCancelledRuns(
  runs: WorkflowRun[],
  fetchJobs: (runId: number) => WorkflowJob[],
  isMachineryWorkflow: (path: string) => boolean
): WorkflowRun[] {
  // Machinery workflows are ignored by the verdict downstream (`verdictOf` /
  // `latestRunPerWorkflow` already drop them), so grouping them here would
  // only ever cost a wasted `fetchJobs` call on a phantom machinery run.
  // Skipped from grouping only — still passed through in the return value.
  const byWorkflow = new Map<number, WorkflowRun[]>();
  for (const run of runs) {
    if (isMachineryWorkflow(run.path)) continue;
    const group = byWorkflow.get(run.workflow_id);
    if (group) group.push(run);
    else byWorkflow.set(run.workflow_id, [run]);
  }

  const toDrop = new Set<number>();
  for (const [workflowId, group] of byWorkflow) {
    if (group.length < 2) continue;

    const cancelled = group.filter((run) => run.status === 'completed' && run.conclusion === 'cancelled');
    if (cancelled.length === 0) continue;

    const phantomRuns = cancelled.filter((run) => isPhantomCancelledRun(fetchJobs(run.id)));
    if (phantomRuns.length === 0) continue;

    if (phantomRuns.length === group.length) {
      const [first] = group;
      if (!first) continue;
      console.error(
        `await-pr-ci: every run of workflow "${first.name}" (workflow_id ${workflowId}) looks `
        + 'phantom-cancelled (no jobs ever ran) — keeping all of them since none has real data to fall back on.'
      );
      continue;
    }

    for (const run of phantomRuns) toDrop.add(run.id);
  }

  return runs.filter((run) => !toDrop.has(run.id));
}
