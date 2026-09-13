'use strict';

/**
 * Whether a pipeline pull request's head is red, and whether a handback for it
 * is new, a repeat, or past the attempt limit.
 *
 * `agentic-ci-failure.yml`'s nudge job carries this logic inline today, woken
 * only by `agentic-watchdog.yml`'s hourly cron sweep — a delivery gap of 3-5
 * hours has been observed. This module is the pure decision core, extracted so
 * a `workflow_run` trigger on `claude-runner.yml`/`opencode-runner.yml`
 * completion can re-scan open pipeline PRs event-driven instead, reusing the
 * same marker-based attempt ledger and attempt limit rather than opening a
 * second, uncoordinated nudge path. `.cjs` because the nudge job has no
 * checkout and runs inside `actions/github-script`'s CommonJS context.
 *
 * No network, no octokit: every function here takes plain data already fetched
 * by the caller and returns a plain verdict. See `assignability.cjs` for the
 * house style this follows.
 */

/**
 * Workflow paths excluded from "a channel ran on this head" — the pipeline's
 * own machinery, not a verification channel. Kept in shape with the inline
 * copies in `agentic-ci-failure.yml`'s nudge job and `agentic-watchdog.yml`'s
 * re-raise step; `autonomy-loop.test.ts` pins all three to the same set.
 */
const MACHINERY = new Set([
  '.github/workflows/agentic-auto-merge.yml',
  '.github/workflows/agentic-ci-failure.yml',
  '.github/workflows/agentic-intake.yml',
  '.github/workflows/agentic-trigger.yml',
  '.github/workflows/agentic-watchdog.yml',
  '.github/workflows/auto-assign-next.yml',
  '.github/workflows/claude-runner.yml',
  '.github/workflows/handle-failure.yml',
  '.github/workflows/opencode-runner.yml',
]);

/** Run conclusions that count as red. */
const RUN_FAILURES = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'stale']);

/** A pipeline pull request's head branch, issue number in group 1. */
const PIPELINE_HEAD = /^pipeline\/feature-(\d+)(?:-\d+)?$/;

/** Identifies a handback comment among a pull request's comments. */
const MARKER = '<!-- agentic-ci-failure -->';

/**
 * One run per workflow_id, newest wins (machinery workflows excluded).
 *
 * @param {Array<{workflow_id: number, id: number, created_at: string}>} runs
 * @returns {Array<object>}
 */
function latestPerWorkflow(runs) {
  // TODO: implement
  return [];
}

/**
 * Issue number embedded in a pipeline branch ref, or null if head is not a
 * pipeline branch.
 *
 * @param {{head?: {ref?: string}}} pr
 * @returns {number|null}
 */
function pipelineIssueFor(pr) {
  // TODO: implement
  return null;
}

/**
 * Whether a PR's head is currently red, and which run identifies it.
 *
 * @param {{state: string, draft: boolean, head?: {ref?: string}}} pr
 * @param {Array<object>} runsOnHead
 * @returns {{issueNumber: number, redRunId: number}|null}
 */
function redVerdict(pr, runsOnHead) {
  // TODO: implement
  return null;
}

/**
 * Whether a handback for redRunId is new, a repeat, or past the attempt limit.
 *
 * @param {{comments: Array<{body?: string}>, redRunId: number, limit: number}} args
 * @returns {'needs-handback'|'already-asked'|'at-limit'}
 */
function handbackVerdict(args) {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Full decision for one already-fetched PR.
 *
 * @param {{pr: object, runsOnHead: Array<object>, comments: Array<object>, limit: number}} args
 * @returns {{dispatch: boolean, issueNumber: number|null, reason: string}}
 */
function assessPipelinePr(args) {
  // TODO: implement
  return { dispatch: false, issueNumber: null, reason: 'not implemented' };
}

module.exports = {
  MACHINERY,
  RUN_FAILURES,
  PIPELINE_HEAD,
  MARKER,
  latestPerWorkflow,
  pipelineIssueFor,
  redVerdict,
  handbackVerdict,
  assessPipelinePr,
};
