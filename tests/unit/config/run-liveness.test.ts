// BlastSimulator2026 — Is a candidate's in-flight run genuinely lost?
//
// `.github/actions/agentic-recover-blocked/action.yml` used to decide this
// inline: one empty status-filtered `listWorkflowRuns` read meant "gone".
// That read is eventually consistent and can come back empty for a run
// seconds old — issue #1130's run #817 was alive and running when this exact
// check declared it lost, labelled the issue `blocked`, and cascaded into
// parking the whole pipeline queue. See issue #1136.
//
// `run-liveness.cjs` replaces that single read with a verdict that also
// weighs a wall-clock grace window against the candidate's own
// assignment-comment age and the run's own `created_at`, and fails closed
// toward `'live'`/`'undetermined'` — the opposite polarity from
// `assignability.cjs`, where an unreadable fact blocks. Declaring a live run
// lost is the unrecoverable mistake here, not the reverse.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const liveness = require(join(ROOT, '.github/scripts/run-liveness.cjs'));
const {
  decideRunLiveness,
  resolveGraceWindowMinutes,
  DEFAULT_GRACE_WINDOW_MINUTES,
  LIVE_RUN_STATUSES,
  isTrustedAssignmentAuthor,
} = liveness;

const NOW = 1_700_000_000_000; // fixed instant, epoch ms
const isoSecondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const isoMinutesAgo = (minutes: number) => isoSecondsAgo(minutes * 60);

// The identity `agentic-recover-blocked` resolves via `users.getAuthenticated()`
// for the token it shares with `agentic-assign` — see issue #1136's security
// finding. Every fixture below that is meant to read as a genuine assignment
// comment carries this author; `trustedAuthorLogin` in `baseInput` names it as
// the trusted one, mirroring what the real caller passes in.
const PIPELINE_LOGIN = 'agentic-pipeline-bot';
const pipelineUser = { login: PIPELINE_LOGIN, type: 'User' };

/** Base input every case overrides from — everything readable, nothing found. */
const baseInput = (overrides: Partial<Record<string, unknown>> = {}) => ({
  issueNumber: 1130,
  assignmentComments: [] as { body: string; created_at: string; user?: unknown }[],
  assignmentCommentsUnknown: false,
  workflowRuns: [] as { id: number; status?: string; created_at: string }[],
  workflowRunsUnknown: false,
  now: NOW,
  trustedAuthorLogin: PIPELINE_LOGIN,
  ...overrides,
});

const assignmentComment = (body: string, created_at: string, user: unknown = pipelineUser) => ({
  body,
  created_at,
  user,
});

const ASSIGNMENT_BODY = 'The autonomous pipeline assignment for issue #1130 is now in progress.';

describe('LIVE_RUN_STATUSES', () => {
  // Mirrors the array agentic-recover-blocked/action.yml carried inline
  // before this module existed, plus agentic-ci-failure.yml's #614 fix
  // (`pending`) — none of that existing coverage may regress.
  it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])(
    'treats %s as a live status',
    (status) => {
      expect(LIVE_RUN_STATUSES).toContain(status);
    }
  );
});

describe('resolveGraceWindowMinutes', () => {
  it('returns the configured value when it is a valid positive number', () => {
    expect(resolveGraceWindowMinutes('10')).toBe(10);
  });

  it('falls back to the default on an empty value', () => {
    expect(resolveGraceWindowMinutes('')).toBe(DEFAULT_GRACE_WINDOW_MINUTES);
  });

  it('falls back to the default when undefined', () => {
    expect(resolveGraceWindowMinutes(undefined)).toBe(DEFAULT_GRACE_WINDOW_MINUTES);
  });

  it('falls back to the default on an unparseable value', () => {
    expect(resolveGraceWindowMinutes('not-a-number')).toBe(DEFAULT_GRACE_WINDOW_MINUTES);
  });

  it('falls back to the default on a negative value', () => {
    expect(resolveGraceWindowMinutes('-5')).toBe(DEFAULT_GRACE_WINDOW_MINUTES);
  });

  it('falls back to the default on zero — not a positive window', () => {
    expect(resolveGraceWindowMinutes('0')).toBe(DEFAULT_GRACE_WINDOW_MINUTES);
  });
});

describe('decideRunLiveness — case 1: a run seconds old is not yet lost', () => {
  // The real incident, reproduced faithfully: the status-filtered
  // `listWorkflowRuns` read came back completely empty six seconds after the
  // run's assignment comment posted. Nothing found is exactly what a run that
  // has not yet started produces — it must not read the same as a run that
  // was cancelled hours ago.
  it('reads live when nothing is found yet but the assignment comment is seconds old', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6))],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).not.toBe('lost');
  });

  it('reads live when a matching run exists with no job status yet and a fresh created_at', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6))],
        workflowRuns: [{ id: 817, status: undefined as unknown as string, created_at: isoSecondsAgo(6) }],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).not.toBe('lost');
  });

  it('reads live for a run reported "requested" or "queued" moments after creation', () => {
    for (const status of ['requested', 'queued']) {
      const result = decideRunLiveness(
        baseInput({
          assignmentComments: [assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6))],
          workflowRuns: [{ id: 817, status, created_at: isoSecondsAgo(6) }],
          graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
        })
      );
      expect(result.verdict, status).not.toBe('lost');
    }
  });
});

describe('decideRunLiveness — case 2: a genuinely cancelled run stays lost', () => {
  // Preserves #572/#610 coverage: nothing queued or live, and the candidate's
  // own assignment is old enough that "not yet visible" is no longer a
  // credible explanation.
  it('reads lost when nothing is found and the assignment comment is older than the grace window', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('lost');
  });

  it('reads lost when the only matching run is cancelled and the assignment is old', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        workflowRuns: [
          { id: 817, status: 'cancelled', created_at: isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25) },
        ],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('lost');
  });

  it('reads lost when the only matching run has already completed and the assignment is old', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        workflowRuns: [
          { id: 817, status: 'completed', created_at: isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25) },
        ],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('lost');
  });
});

describe('decideRunLiveness — case 3: status alone is authoritative', () => {
  // #614: a run concurrency-blocked behind another can report `pending` for a
  // long time. Its age must never count against it — status wins outright.
  it.each(['pending', 'queued', 'in_progress', 'waiting', 'requested'])(
    'reads live for status %s no matter how old created_at is',
    (status) => {
      const result = decideRunLiveness(
        baseInput({
          assignmentComments: [
            assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 500)),
          ],
          workflowRuns: [
            { id: 817, status, created_at: isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 500) },
          ],
          graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
        })
      );
      expect(result.verdict, status).toBe('live');
    }
  );

  it('reads live for a queued run past the grace window even with no fresh assignment comment', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [],
        workflowRuns: [
          { id: 817, status: 'queued', created_at: isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 500) },
        ],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('live');
  });
});

describe('decideRunLiveness — case 4: fails closed toward undetermined, never lost', () => {
  it('reads undetermined when the workflow-run read itself failed', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        workflowRuns: [],
        workflowRunsUnknown: true,
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });

  it('reads undetermined when the assignment-comment read itself failed', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [],
        assignmentCommentsUnknown: true,
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });

  it('reads undetermined when no assignment comment was found at all, but the read itself succeeded', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [],
        assignmentCommentsUnknown: false,
        workflowRuns: [],
        workflowRunsUnknown: false,
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });

  it('reads undetermined when every record carries an unparseable created_at', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [assignmentComment(ASSIGNMENT_BODY, 'not-a-real-timestamp')],
        // Non-live status deliberately (matches the `cancelled`/`completed`
        // fixtures above) — this test isolates the unparseable-timestamp
        // path, not the live-status short-circuit, which case 3 already
        // covers.
        workflowRuns: [{ id: 817, status: 'completed', created_at: 'also-not-a-timestamp' }],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });
});

describe('decideRunLiveness — multiple assignment comments', () => {
  // An issue reassigned minutes ago must not be judged by a stale comment
  // from days earlier — only the newest assignment comment's age counts.
  it('judges the run by the newest assignment comment, not the oldest', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(60 * 24 * 3)), // 3 days old
          assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(10)), // just posted
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).not.toBe('lost');
  });

  it('is not fooled by comment order in the array', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(10)), // just posted, listed first
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(60 * 24 * 3)), // 3 days old
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).not.toBe('lost');
  });
});

describe('decideRunLiveness — return shape', () => {
  it('always names a reason alongside the verdict', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('lost');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    expect(typeof result.evidence).toBe('object');
  });
});

describe('isTrustedAssignmentAuthor', () => {
  it('trusts a login matching the trusted author, case-insensitively', () => {
    expect(isTrustedAssignmentAuthor({ login: PIPELINE_LOGIN.toUpperCase() }, PIPELINE_LOGIN)).toBe(true);
  });

  it('rejects a different login', () => {
    expect(isTrustedAssignmentAuthor({ login: 'some-random-account' }, PIPELINE_LOGIN)).toBe(false);
  });

  it('rejects when there is no trusted author to compare against', () => {
    expect(isTrustedAssignmentAuthor({ login: PIPELINE_LOGIN }, null)).toBe(false);
    expect(isTrustedAssignmentAuthor({ login: PIPELINE_LOGIN }, undefined)).toBe(false);
    expect(isTrustedAssignmentAuthor({ login: PIPELINE_LOGIN }, '')).toBe(false);
  });

  it('rejects a comment with no user at all', () => {
    expect(isTrustedAssignmentAuthor(null, PIPELINE_LOGIN)).toBe(false);
    expect(isTrustedAssignmentAuthor(undefined, PIPELINE_LOGIN)).toBe(false);
    expect(isTrustedAssignmentAuthor({}, PIPELINE_LOGIN)).toBe(false);
  });
});

describe('decideRunLiveness — comment-spoofing (issue #1136 security finding)', () => {
  // This repository is public: anyone can post a comment containing the exact
  // assignment phrase, and GitHub timestamps it with real wall-clock time, so
  // it always reads as fresh. Only a comment from the trusted pipeline
  // identity may count toward the age check — a phrase match alone must not.
  it('does not treat a phrase-matching comment from an untrusted author as this issue\'s assignment', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6), { login: 'attacker', type: 'User' }),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    // Read as "no genuine assignment comment found" rather than "live" or
    // "lost" — the module's fail-closed direction, never a spoofed comment
    // manufacturing liveness.
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });

  it('does not fall back to "live" just because an untrusted comment is fresh, when a real stale one exists', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          // The real assignment, old enough that its run should be lost...
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
          // ...and an attacker re-posting the phrase every few seconds to try
          // to keep it reading as fresh.
          assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6), { login: 'attacker', type: 'User' }),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    // The spoofed comment must not be picked as "the newest assignment
    // comment" — only the trusted one counts, so this reads lost, not live.
    expect(result.verdict).toBe('lost');
  });

  it('trusts nothing when the caller could not resolve its own identity', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6))],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
        trustedAuthorLogin: null,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });
});

describe('ASSIGNMENT_COMMENT_PATTERN — discriminating boundary', () => {
  // Every fixture above pairs issue #1130 with a body mentioning #1130. These
  // prove the pattern actually distinguishes this issue's own assignment
  // phrasing from a comment that happens to mention the number, or the
  // phrasing for some other issue.
  it('does not match a comment mentioning the right issue number for an unrelated reason', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment('See also #1130\'s original report for context.', isoSecondsAgo(6)),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });

  it('does not match the assignment phrasing written for a different issue', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(
            '@claude — autonomous pipeline assignment for issue #999 (ready).',
            isoSecondsAgo(6)
          ),
        ],
        workflowRuns: [],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
      })
    );
    expect(result.verdict).toBe('undetermined');
    expect(result.verdict).not.toBe('lost');
  });
});

describe('decideRunLiveness — excludeRunId', () => {
  // `action.yml` passes `excludeRunId: context.runId` — the sweeping run's
  // own workflow run must never count toward the live-status short-circuit,
  // or every sweep would read itself as proof the candidate is live.
  it('does not let the caller\'s own run short-circuit to live, and falls through to the age check', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [
          assignmentComment(ASSIGNMENT_BODY, isoMinutesAgo(DEFAULT_GRACE_WINDOW_MINUTES + 25)),
        ],
        // The only workflow run present is the caller's own — excluded, so
        // nothing here should read as a live status.
        workflowRuns: [{ id: 4242, status: 'in_progress', created_at: isoSecondsAgo(6) }],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
        excludeRunId: 4242,
      })
    );
    expect(result.verdict).toBe('lost');
    expect(result.evidence.mostRecentRun).toBeNull();
  });

  it('still counts a different run as live even when excludeRunId names another one', () => {
    const result = decideRunLiveness(
      baseInput({
        assignmentComments: [assignmentComment(ASSIGNMENT_BODY, isoSecondsAgo(6))],
        workflowRuns: [{ id: 999, status: 'in_progress', created_at: isoSecondsAgo(6) }],
        graceWindowMinutes: DEFAULT_GRACE_WINDOW_MINUTES,
        excludeRunId: 4242,
      })
    );
    expect(result.verdict).toBe('live');
  });
});
