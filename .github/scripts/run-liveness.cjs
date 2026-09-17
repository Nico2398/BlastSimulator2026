'use strict';

/**
 * Decides whether a candidate issue's in-flight pipeline run is genuinely
 * lost, or merely not yet visible because `listWorkflowRuns` is eventually
 * consistent.
 *
 * `.github/actions/agentic-recover-blocked/action.yml` used to decide this
 * inline, in github-script JS, and treated an empty status-filtered
 * `listWorkflowRuns` read as proof the run was gone. That read can come back
 * empty for a run seconds old, which is exactly what happened on the
 * incident this module exists to prevent: a live run was falsely declared
 * lost, labelled `blocked`, and cascaded into parking the whole pipeline
 * queue. See issue #1136.
 *
 * Fails closed toward LIVE, the opposite polarity from `assignability.cjs`.
 * There, a fact the module cannot establish blocks — starting a run on
 * ground that is not there is the unrecoverable mistake. Here, declaring a
 * live run lost is the unrecoverable mistake, so anything this module cannot
 * establish is treated as `'undetermined'`, and callers must treat
 * `'undetermined'` exactly like `'live'` — never declare a run lost, label an
 * issue blocked, or post a comment on an uncertain read.
 */

/** Minutes a run is given to become visible before its absence counts. */
const DEFAULT_GRACE_WINDOW_MINUTES = 5; // TODO: implementer fills in actual default per plan

/** Matches an assignment comment naming the run this issue's session is on. */
const ASSIGNMENT_COMMENT_PATTERN = /placeholder/; // TODO: implementer fills in

/** Workflow run statuses that count as still live. */
const LIVE_RUN_STATUSES = []; // TODO: implementer fills in, e.g. queued/in_progress/waiting/requested/pending

/**
 * The full verdict on one candidate's in-flight run.
 *
 * @param {{
 *   issueNumber: number,
 *   assignmentComments: Array<{body: string, created_at: string}>,
 *   assignmentCommentsUnknown?: boolean,
 *   workflowRuns: Array<{id: number, status: string, created_at: string}>,
 *   workflowRunsUnknown?: boolean,
 *   now: number,
 *   graceWindowMinutes?: number,
 *   excludeRunId?: number,
 * }} input
 * @returns {{ verdict: 'live'|'lost'|'undetermined', reason: string, evidence: object }}
 */
function decideRunLiveness(input) {
  throw new Error('not implemented');
}

/**
 * Reads the configured grace window. A value that is not a positive number is
 * a misconfiguration, so it falls back rather than being obeyed.
 *
 * @param {string | undefined | null} raw
 * @returns {number}
 */
function resolveGraceWindowMinutes(raw) {
  throw new Error('not implemented');
}

module.exports = {
  decideRunLiveness,
  resolveGraceWindowMinutes,
  DEFAULT_GRACE_WINDOW_MINUTES,
  ASSIGNMENT_COMMENT_PATTERN,
  LIVE_RUN_STATUSES,
};
