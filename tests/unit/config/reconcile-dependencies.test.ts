// BlastSimulator2026 — Dependency reconciliation
//
// A pause writes its dependency twice: the issue body's `## Blocked by` section
// and GitHub's own `blocked_by` relationship. `blockedByFor` reads the union of
// the two, which is exactly what makes writing only the section invisible — the
// queue holds the issue correctly, nothing goes red, and the authoritative
// source is simply empty. #1090 paused that way on 16 Sep 2026.
//
// `handle-failure.yml` derives the relationship from the section on the
// `paused`/`blocked` label and on an edit to an issue already carrying one.
// These tests pin the rule that decides what to write, the two states it must
// refuse to write in, and the race that made the label event alone insufficient
// (#1127): a run applies the label before it edits the body, so the label event
// reads a section that does not name the dependency yet.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, '../../..');

const { declaredDependencies, missingRelationships, reconcileDependencies } = require(
  join(ROOT, '.github/scripts/reconcile-dependencies.cjs')
);

const BODY = `## Context

Background that cites #55 and must declare nothing.

## Blocked by

- #1089 — already recorded
- #1118 — declared in prose only

## Conventions

Nothing here counts, not even #999.
`;

/** The same issue as the halt label lands, before the run's second write. */
const BODY_BEFORE_THE_SECTION = `## Context

Background that cites #55 and must declare nothing.

## Blocked by

None
`;

/** A stand-in for the real IssueApi, carrying only what the reconciler reads. */
function fakeApi(overrides: Record<string, unknown> = {}) {
  const calls: { number: number; blockerId: number }[] = [];
  return {
    calls,
    getIssue: async (n: number) => ({ number: n, id: 5_000_000 + n, body: BODY, labels: ['paused'] }),
    declaredBlockedBy: async () => ({ numbers: [1089], available: true, unknown: false }),
    addBlockedBy: async (number: number, blockerId: number) => {
      calls.push({ number, blockerId });
      return { ok: true };
    },
    ...overrides,
  };
}

describe('declaredDependencies', () => {
  it('reads only the section, never a number mentioned elsewhere', () => {
    expect(declaredDependencies(1090, BODY)).toEqual([1089, 1118]);
  });

  it('is empty before the run has written its section', () => {
    expect(declaredDependencies(1090, BODY_BEFORE_THE_SECTION)).toEqual([]);
  });
});

describe('missingRelationships', () => {
  it('returns only what the section declares and GitHub does not record', () => {
    expect(missingRelationships(1090, BODY, { numbers: [1089] })).toEqual([1118]);
  });

  // The union is the reason this job exists; it must not undo it by treating a
  // recorded relationship as something to write again.
  it('is empty once every declared dependency is recorded', () => {
    expect(missingRelationships(1090, BODY, { numbers: [1089, 1118] })).toEqual([]);
  });

  // Delegated to `parseDependencies`, and pinned here because a second parser
  // that drifted from it would make the relationship disagree with the queue.
  it('ignores issue numbers mentioned outside the section', () => {
    const missing = missingRelationships(1090, BODY, { numbers: [] });
    expect(missing).toEqual([1089, 1118]);
    expect(missing).not.toContain(55);
    expect(missing).not.toContain(999);
  });

  // Mirrors `blockedByFor`'s own `union.delete(issue.number)`.
  it('never blocks an issue on itself', () => {
    expect(missingRelationships(1090, '## Blocked by\n\n- #1090\n', { numbers: [] })).toEqual([]);
  });
});

describe('reconcileDependencies', () => {
  it('records the declared dependency by database id, not by number', async () => {
    const api = fakeApi();
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([1118]);
    expect(result.failed).toEqual([]);
    // 5_001_118 is the fake's id for #1118. Passing 1118 here is the silent
    // failure the endpoint accepts without complaint.
    expect(api.calls).toEqual([{ number: 1090, blockerId: 5_001_118 }]);
  });

  it('writes nothing on a second run', async () => {
    const api = fakeApi({
      declaredBlockedBy: async () => ({ numbers: [1089, 1118], available: true, unknown: false }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  // Rule 4: a fact that could not be read is not an absent fact. Writing
  // against an unreadable list would mask a permission problem as success.
  it('fails closed when the existing relationships cannot be read', async () => {
    const api = fakeApi({
      declaredBlockedBy: async () => ({ numbers: [], available: false, unknown: true }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([]);
    expect(api.calls).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });

  // The endpoint genuinely not being on the repository is a supported
  // configuration — the body section is then the only source the queue has —
  // and must not read as a failure.
  it('reports rather than fails when dependencies are unavailable on the repository', async () => {
    const api = fakeApi({
      declaredBlockedBy: async () => ({ numbers: [], available: false, unknown: false }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.failed).toEqual([]);
    expect(result.skipped).toBeTruthy();
    expect(api.calls).toEqual([]);
  });

  // #1127. The label event and the body edit are two writes in an order the
  // run chooses, and the label comes first — so the first pass reads a section
  // that declares nothing, and the pass fired by the edit is the one that
  // writes the relationship. Both passes are exercised here against the same
  // fake to pin that the second one is not a no-op.
  it('records a section written after its own first pass found nothing', async () => {
    let body = BODY_BEFORE_THE_SECTION;
    const api = fakeApi({
      getIssue: async (n: number) => ({ number: n, id: 5_000_000 + n, body, labels: ['paused'] }),
      declaredBlockedBy: async () => ({ numbers: [], available: true, unknown: false }),
    });

    const onTheLabel = await reconcileDependencies(api, 1090);
    expect(onTheLabel.created).toEqual([]);
    expect(api.calls).toEqual([]);

    body = BODY;
    const onTheEdit = await reconcileDependencies(api, 1090);
    expect(onTheEdit.created).toEqual([1089, 1118]);
    expect(api.calls).toEqual([
      { number: 1090, blockerId: 5_001_089 },
      { number: 1090, blockerId: 5_001_118 },
    ]);
  });

  // The wording is what made #1090 invisible for two hours: a pass that read
  // the section too early logged the same "already a relationship" line as one
  // with genuinely nothing left to do. `unresolved` is how the two are told
  // apart, and the workflow turns it into a `core.notice`.
  it('marks a paused issue that declares nothing as unresolved, not as complete', async () => {
    const api = fakeApi({
      getIssue: async (n: number) => ({
        number: n,
        id: 5_000_000 + n,
        body: BODY_BEFORE_THE_SECTION,
        labels: ['agent-task', 'ready', 'paused'],
      }),
      declaredBlockedBy: async () => ({ numbers: [], available: true, unknown: false }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.unresolved).toBeTruthy();
    expect(api.calls).toEqual([]);
  });

  // A `blocked` run waits on a human's answer and need not depend on any
  // issue, so declaring nothing there is an ordinary green outcome. Reporting
  // it would be a notice on every human-answerable halt.
  it('says nothing about a blocked issue that declares no dependency', async () => {
    const api = fakeApi({
      getIssue: async (n: number) => ({
        number: n,
        id: 5_000_000 + n,
        body: BODY_BEFORE_THE_SECTION,
        labels: ['agent-task', 'blocked'],
      }),
      declaredBlockedBy: async () => ({ numbers: [], available: true, unknown: false }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.unresolved).toBeNull();
    expect(result.failed).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  // An issue whose relationships are already complete is not unresolved —
  // otherwise the notice would fire on every redelivered webhook and mean
  // nothing.
  it('is resolved once the section is recorded, however often it runs', async () => {
    const api = fakeApi({
      declaredBlockedBy: async () => ({ numbers: [1089, 1118], available: true, unknown: false }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.unresolved).toBeNull();
    expect(result.declared).toEqual([1089, 1118]);
  });

  it('reports a relationship it could not write', async () => {
    const api = fakeApi({
      addBlockedBy: async () => ({ ok: false, reason: '403' }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([{ number: 1118, reason: '403' }]);
  });
});
