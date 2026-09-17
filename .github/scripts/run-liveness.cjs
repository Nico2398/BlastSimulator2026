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
const DEFAULT_GRACE_WINDOW_MINUTES = 5;

/**
 * Matches the opening line `agentic-assign` writes for issue `number` — see
 * `.github/actions/agentic-assign/action.yml`:
 *   `${mention} — autonomous pipeline assignment for issue #${n} (${reason}).`
 * The mention differs per agent; the phrase after the dash does not, so it is
 * what identifies the comment as this issue's own assignment rather than some
 * other mention of the issue number.
 *
 * @param {number} number
 * @returns {RegExp}
 */
const ASSIGNMENT_COMMENT_PATTERN = (number) =>
  new RegExp(`autonomous pipeline assignment for issue #${number}\\b`);

/**
 * Workflow run statuses that count as still live — never second-guessed by
 * the grace window once observed. Widened once already for the same
 * eventual-consistency reason this module exists for: see #614, where a
 * narrower two-status check missed a run the Actions API reported as
 * `pending`.
 */
const LIVE_RUN_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];

/** @returns {number|null} epoch ms, or null when unparseable. */
function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function undetermined(issueNumber, reason, evidence) {
  return { verdict: 'undetermined', reason: `#${issueNumber}: ${reason}`, evidence };
}

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
  const {
    issueNumber,
    assignmentComments = [],
    assignmentCommentsUnknown = false,
    workflowRuns = [],
    workflowRunsUnknown = false,
    now,
    graceWindowMinutes,
    excludeRunId = null,
  } = input;

  const effectiveGraceWindowMinutes =
    typeof graceWindowMinutes === 'number' && graceWindowMinutes > 0
      ? graceWindowMinutes
      : DEFAULT_GRACE_WINDOW_MINUTES;
  const graceWindowMs = effectiveGraceWindowMinutes * 60 * 1000;

  // Step 0: a status GitHub is actively reporting is never second-guessed by
  // anything below — not assignment-comment existence, not age, not the
  // grace window. See #614. This must run before every other check: a
  // queued run's own status is authoritative even with no assignment
  // comment at all.
  const candidateRuns = workflowRuns.filter((run) => run.id !== excludeRunId);
  const liveRun = candidateRuns.find((run) => LIVE_RUN_STATUSES.includes(run.status));
  if (liveRun) {
    return {
      verdict: 'live',
      reason: `#${issueNumber}: run #${liveRun.id} is ${liveRun.status} — a reported live status is never second-guessed.`,
      evidence: { run: liveRun },
    };
  }

  // Step 1: no age can be established at all without the comments.
  if (assignmentCommentsUnknown) {
    return undetermined(issueNumber, 'assignment comments could not be read — cannot establish assignment age.', {
      assignmentCommentsUnknown: true,
    });
  }

  // Step 2: find this issue's own assignment comment(s).
  const pattern = ASSIGNMENT_COMMENT_PATTERN(issueNumber);
  const matched = assignmentComments.filter((comment) => pattern.test(comment?.body || ''));
  if (matched.length === 0) {
    return undetermined(issueNumber, 'no assignment comment found — cannot establish assignment age.', {
      assignmentCommentFound: false,
    });
  }

  // Step 3: can't rule out a run existing without the run list.
  if (workflowRunsUnknown) {
    return undetermined(issueNumber, 'workflow runs could not be read — cannot rule out a live run.', {
      workflowRunsUnknown: true,
    });
  }

  // The most recent assignment comment by parseable timestamp — only the
  // newest reassignment's age matters.
  const dated = matched
    .map((comment) => ({ comment, timestamp: parseTimestamp(comment.created_at) }))
    .filter((entry) => entry.timestamp !== null)
    .sort((a, b) => b.timestamp - a.timestamp);

  // Step 6: an assignment comment was found but none of its timestamps parse.
  if (dated.length === 0) {
    return undetermined(issueNumber, 'assignment comment found but its timestamp could not be parsed.', {
      assignmentCommentFound: true,
      assignmentTimestampParseable: false,
    });
  }

  const assignmentTimestamp = dated[0].timestamp;
  const assignmentAgeMs = now - assignmentTimestamp;

  const runsByRecency = candidateRuns
    .map((run) => ({ run, timestamp: parseTimestamp(run.created_at) }))
    .filter((entry) => entry.timestamp !== null)
    .sort((a, b) => b.timestamp - a.timestamp);
  const mostRecentRun = runsByRecency[0] || null;
  const runAgeMs = mostRecentRun ? now - mostRecentRun.timestamp : null;

  const evidence = {
    assignmentComment: {
      createdAt: dated[0].comment.created_at,
      ageMinutes: Math.round(assignmentAgeMs / 60000),
    },
    mostRecentRun: mostRecentRun
      ? {
          id: mostRecentRun.run.id,
          status: mostRecentRun.run.status,
          createdAt: mostRecentRun.run.created_at,
          ageMinutes: Math.round(runAgeMs / 60000),
        }
      : null,
    graceWindowMinutes: effectiveGraceWindowMinutes,
  };

  // Step 5: still within the propagation grace window — not enough time has
  // passed to trust an absence as real.
  if (assignmentAgeMs < graceWindowMs) {
    return {
      verdict: 'live',
      reason: `#${issueNumber}: assignment comment is ${Math.round(assignmentAgeMs / 1000)}s old — within the ${effectiveGraceWindowMinutes}m grace window.`,
      evidence,
    };
  }
  if (runAgeMs !== null && runAgeMs < graceWindowMs) {
    return {
      verdict: 'live',
      reason: `#${issueNumber}: most recent run #${mostRecentRun.run.id} is ${Math.round(runAgeMs / 1000)}s old — within the ${effectiveGraceWindowMinutes}m grace window.`,
      evidence,
    };
  }

  // Step 7: old enough, and nothing live was found.
  return {
    verdict: 'lost',
    reason: mostRecentRun
      ? `#${issueNumber}: assignment comment is ${Math.round(assignmentAgeMs / 60000)}m old (beyond the ${effectiveGraceWindowMinutes}m grace window), and the most recent run #${mostRecentRun.run.id} (${mostRecentRun.run.status}, created ${mostRecentRun.run.created_at}) is not live.`
      : `#${issueNumber}: assignment comment is ${Math.round(assignmentAgeMs / 60000)}m old (beyond the ${effectiveGraceWindowMinutes}m grace window), and no run was found at all.`,
    evidence,
  };
}

/**
 * Reads the configured grace window. A value that is not a positive number is
 * a misconfiguration, so it falls back rather than being obeyed.
 *
 * @param {string | undefined | null} raw
 * @returns {number}
 */
function resolveGraceWindowMinutes(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_GRACE_WINDOW_MINUTES;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_GRACE_WINDOW_MINUTES;
}

module.exports = {
  decideRunLiveness,
  resolveGraceWindowMinutes,
  DEFAULT_GRACE_WINDOW_MINUTES,
  ASSIGNMENT_COMMENT_PATTERN,
  LIVE_RUN_STATUSES,
};
