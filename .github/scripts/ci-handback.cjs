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
  const latest = new Map();
  for (const run of runs) {
    if (MACHINERY.has(run.path)) continue;
    const seen = latest.get(run.workflow_id);
    if (!seen || run.id > seen.id) latest.set(run.workflow_id, run);
  }
  return [...latest.values()];
}

/**
 * Issue number embedded in a pipeline branch ref, or null if head is not a
 * pipeline branch.
 *
 * @param {{head?: {ref?: string}}} pr
 * @returns {number|null}
 */
function pipelineIssueFor(pr) {
  const match = PIPELINE_HEAD.exec(pr.head?.ref || '');
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Why redVerdict returned null, for reporting.
 *
 * @param {{state: string, draft: boolean, head?: {ref?: string}}} pr
 * @param {Array<object>} runsOnHead
 * @returns {string}
 */
function reasonForNoVerdict(pr, runsOnHead) {
  if (pr.state !== 'open') return `PR is ${pr.state}, not open`;
  if (pr.draft) return 'draft';
  if (!PIPELINE_HEAD.test(pr.head?.ref || '')) return 'not a pipeline PR';
  const channels = latestPerWorkflow(runsOnHead);
  if (channels.length === 0) return 'no runs yet on head';
  const redRuns = channels.filter(
    (run) => run.status === 'completed' && RUN_FAILURES.has(run.conclusion)
  );
  if (redRuns.length === 0) return 'head is green';
  return 'no verdict';
}

/**
 * Whether a PR's head is currently red, and which run identifies it.
 *
 * @param {{state: string, draft: boolean, head?: {ref?: string}}} pr
 * @param {Array<object>} runsOnHead
 * @returns {{issueNumber: number, redRunId: number}|null}
 */
function redVerdict(pr, runsOnHead) {
  if (pr.state !== 'open') return null;
  if (pr.draft) return null;
  if (!PIPELINE_HEAD.test(pr.head?.ref || '')) return null;

  const channels = latestPerWorkflow(runsOnHead);
  if (channels.length === 0) return null;

  const redRuns = channels.filter(
    (run) => run.status === 'completed' && RUN_FAILURES.has(run.conclusion)
  );
  if (redRuns.length === 0) return null;

  const redRunId = redRuns.map((run) => run.id).sort((a, b) => b - a)[0];
  const issueNumber = pipelineIssueFor(pr);
  return { issueNumber, redRunId };
}

/**
 * Whether a handback for redRunId is new, a repeat, or past the attempt limit.
 *
 * @param {{comments: Array<{body?: string}>, redRunId: number, limit: number}} args
 * @returns {'needs-handback'|'already-asked'|'at-limit'}
 */
function handbackVerdict(args) {
  const { comments, redRunId, limit } = args;
  const nudges = comments.filter((comment) => (comment.body || '').includes(MARKER));
  if (nudges.length >= limit) return 'at-limit';

  const askedAboutThisRun = nudges.some((comment) => (comment.body || '').includes(`run:${redRunId}`));
  if (askedAboutThisRun) return 'already-asked';

  return 'needs-handback';
}

/**
 * Full decision for one already-fetched PR.
 *
 * @param {{pr: object, runsOnHead: Array<object>, comments: Array<object>, limit: number}} args
 * @returns {{dispatch: boolean, issueNumber: number|null, reason: string}}
 */
function assessPipelinePr(args) {
  const { pr, runsOnHead, comments, limit } = args;
  const verdict = redVerdict(pr, runsOnHead);
  if (!verdict) {
    return { dispatch: false, issueNumber: null, reason: reasonForNoVerdict(pr, runsOnHead) };
  }

  const { issueNumber, redRunId } = verdict;
  const outcome = handbackVerdict({ comments, redRunId, limit });
  if (outcome === 'at-limit') {
    return { dispatch: false, issueNumber, reason: `at-limit: attempt limit (${limit}) already reached` };
  }
  if (outcome === 'already-asked') {
    return { dispatch: false, issueNumber, reason: `already-asked about red run ${redRunId}` };
  }
  return { dispatch: true, issueNumber, reason: `needs-handback: run ${redRunId} is red` };
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
