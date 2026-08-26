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
  void args;
  void execFileSync;
  throw new Error('not implemented');
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
  void options;
  void gh;
  throw new Error('not implemented');
}

export function runsOnHead(sha: string): WorkflowRun[] {
  void sha;
  throw new Error('not implemented');
}

export function jobsForRun(runId: number): WorkflowJob[] {
  void runId;
  throw new Error('not implemented');
}
