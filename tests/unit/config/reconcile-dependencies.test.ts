// BlastSimulator2026 — Dependency reconciliation
//
// A pause writes its dependency twice: the issue body's `## Blocked by` section
// and GitHub's own `blocked_by` relationship. `blockedByFor` reads the union of
// the two, which is exactly what makes writing only the section invisible — the
// queue holds the issue correctly, nothing goes red, and the authoritative
// source is simply empty. #1090 paused that way on 16 Sep 2026.
//
// `handle-failure.yml` now derives the relationship from the section on the
// `paused`/`blocked` label. These tests pin the rule that decides what to write
// and the two states it must refuse to write in.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, '../../..');

const { missingRelationships, reconcileDependencies, declaredDependencies } = require(
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

/** A stand-in for the real IssueApi, carrying only what the reconciler reads. */
function fakeApi(overrides: Record<string, unknown> = {}) {
  const calls: { number: number; blockerId: number }[] = [];
  return {
    calls,
    getIssue: async (n: number) => ({ number: n, id: 5_000_000 + n, body: BODY }),
    declaredBlockedBy: async () => ({ numbers: [1089], available: true, unknown: false }),
    addBlockedBy: async (number: number, blockerId: number) => {
      calls.push({ number, blockerId });
      return { ok: true };
    },
    ...overrides,
  };
}

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

  it('reports a relationship it could not write', async () => {
    const api = fakeApi({
      addBlockedBy: async () => ({ ok: false, reason: '403' }),
    });
    const result = await reconcileDependencies(api, 1090);

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([{ number: 1118, reason: '403' }]);
  });

  // #1090 itself: the label and the body edit that declares a dependency are
  // two separate API calls that can land in either order. A job that only ever
  // read the body once, before the edit landed, would find nothing declared and
  // never get a second chance — no event fires for a later body edit alone.
  // This proves the reconciler itself does the right thing on a second call
  // once the body has caught up; `handle-failure.yml` firing that second call
  // at all is pinned separately in `autonomy-loop.test.ts`.
  it('creates the relationship once the body gains the section, on a later call', async () => {
    let body = '## Context\n\nNothing declared yet.\n';
    const api = fakeApi({
      getIssue: async (n: number) => ({ number: n, id: 5_000_000 + n, body }),
      declaredBlockedBy: async () => ({ numbers: [], available: true, unknown: false }),
    });

    const first = await reconcileDependencies(api, 1090);
    expect(first.created).toEqual([]);
    expect(api.calls).toEqual([]);

    body = '## Blocked by\n\n- #1125\n';
    const second = await reconcileDependencies(api, 1090);

    expect(second.created).toEqual([1125]);
    expect(api.calls).toEqual([{ number: 1090, blockerId: 5_001_125 }]);
  });

  // "Nothing declared" and "declared but already recorded" are the same
  // `missing.length === 0` branch today, and read as the identical log line —
  // which is exactly what made the #1090 race a silent no-op instead of a
  // visible retry-me signal. The two must be distinguishable in the log.
  it('logs "no dependency declared" distinctly from "already a relationship"', async () => {
    const logsA: string[] = [];
    await reconcileDependencies(
      fakeApi({
        getIssue: async (n: number) => ({ number: n, id: 5_000_000 + n, body: '## Context\n\nNothing here.\n' }),
        declaredBlockedBy: async () => ({ numbers: [], available: true, unknown: false }),
      }),
      1090,
      { log: (m: string) => logsA.push(m) }
    );
    expect(logsA.some((m) => m.includes('no dependency declared'))).toBe(true);

    const logsB: string[] = [];
    await reconcileDependencies(
      fakeApi({ declaredBlockedBy: async () => ({ numbers: [1089, 1118], available: true, unknown: false }) }),
      1090,
      { log: (m: string) => logsB.push(m) }
    );
    expect(logsB.some((m) => m.includes('already a relationship'))).toBe(true);
    expect(logsB.some((m) => m.includes('no dependency declared'))).toBe(false);
  });
});

describe('declaredDependencies', () => {
  it("returns the section's numbers minus self-reference", () => {
    const body = '## Blocked by\n\n- #1089\n- #1118\n- #1090\n'; // #1090 is self
    expect(declaredDependencies(1090, body)).toEqual([1089, 1118]);
  });

  it('is empty when the section is absent', () => {
    expect(declaredDependencies(1090, '## Context\n\nNothing here.\n')).toEqual([]);
  });

  it('is empty for a missing body', () => {
    expect(declaredDependencies(1090, undefined)).toEqual([]);
  });
});
