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
const { decideRunLiveness, resolveGraceWindowMinutes, DEFAULT_GRACE_WINDOW_MINUTES, LIVE_RUN_STATUSES } =
  liveness;

const NOW = 1_700_000_000_000; // fixed instant, epoch ms
const isoSecondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const isoMinutesAgo = (minutes: number) => isoSecondsAgo(minutes * 60);

/** Base input every case overrides from — everything readable, nothing found. */
const baseInput = (overrides: Partial<Record<string, unknown>> = {}) => ({
  issueNumber: 1130,
  assignmentComments: [] as { body: string; created_at: string }[],
  assignmentCommentsUnknown: false,
  workflowRuns: [] as { id: number; status?: string; created_at: string }[],
  workflowRunsUnknown: false,
  now: NOW,
  ...overrides,
});

const assignmentComment = (body: string, created_at: string) => ({ body, created_at });

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
