/**
 * BlastSimulator2026 — `gh`-backed fetch helpers for PR/workflow-run/job data
 *
 * Extracted from scripts/await-pr-ci.ts (#785).
 *
 * @module github-ci-fetch
 */

import { execFileSync } from 'child_process';
import type { WorkflowRun, WorkflowJob } from './phantom-cancelled-runs.js';

/** `gh api` output, parsed. Throws with gh's own stderr, which names the real problem. */
function gh<T>(args: string[]): T {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out) as T;
}

export interface PullRequest {
  number: number;
  state: string;
  merged_at: string | null;
  draft: boolean;
  head: { ref: string; sha: string };
  labels: { name: string }[];
}

export function resolvePr(options: { pr?: number; head?: string }): PullRequest | undefined {
  if (options.pr !== undefined) {
    return gh<PullRequest>(['api', `repos/{owner}/{repo}/pulls/${options.pr}`]);
  }
  const { owner } = gh<{ owner: { login: string } }>(['repo', 'view', '--json', 'owner']);
  const open = gh<PullRequest[]>([
    'api',
    `repos/{owner}/{repo}/pulls?state=open&head=${owner.login}:${options.head}&per_page=10`,
  ]);
  return open[0];
}

export function runsOnHead(sha: string): WorkflowRun[] {
  const page = gh<{ workflow_runs: WorkflowRun[] }>([
    'api',
    `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`,
  ]);
  return page.workflow_runs ?? [];
}

export function jobsForRun(runId: number): WorkflowJob[] {
  const page = gh<{ jobs: WorkflowJob[] }>([
    'api',
    `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`,
  ]);
  return page.jobs ?? [];
}
