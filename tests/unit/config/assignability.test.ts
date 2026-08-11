// BlastSimulator2026 — What the pipeline is allowed to assign
//
// The pipeline is fully autonomous: nothing between a filed issue and a merged
// PR waits for a human. That makes assignment the one decision with no reviewer.
// An issue put in front of an agent before the work it builds on has landed
// produces a run that cannot succeed — it burns a session, ends `blocked`, and
// leaves a branch cut from a `main` that is missing the ground under it.
//
// Issue #547 is the case: labelled `blocked` with PR #566 open and unmerged, its
// whole batch of follow-ups declaring `Blocked by #547`. Every rule below is a
// way that state could have been misread as assignable.
//
// The rules live in `.github/scripts/assignability.cjs` rather than inline in
// the composite action, so these tests drive the source that actually ships.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const rules = require(join(ROOT, '.github/scripts/assignability.cjs'));
const { createIssueApi } = require(join(ROOT, '.github/scripts/issue-api.cjs'));

interface FakeIssue {
  number: number;
  state?: string;
  stateReason?: string | null;
  labels?: string[];
  body?: string;
  isPullRequest?: boolean;
  prMergedAt?: string | null;
  /** The PR from this issue's own `pipeline/feature-<N>` branch, if one exists. */
  pipelinePr?: { number: number; merged: boolean } | null;
  /** PRs GitHub records as closing this issue (open and merged only). */
  closers?: { number: number; merged: boolean }[];
  /** The deliverable-PR read failed — callers must fail closed. */
  deliverableUnknown?: boolean;
  /** When `blocked` was last applied, epoch ms. */
  blockedAt?: number | null;
  /** Whether a run ever owned this issue (it carried `in-progress` at some point). */
  everInProgress?: boolean;
  /** Issue numbers GitHub records as blocking this one (the Relationships panel). */
  blockedBy?: number[];
  /** The relationships call failed for a reason other than the feature being absent. */
  relationshipsUnknown?: boolean;
}

/** The shape `deliverableFor` returns. */
const deliverable = (
  overrides: Partial<{
    pipeline: { number: number; merged: boolean } | null;
    closers: { number: number; merged: boolean }[];
    unknown: boolean;
  }> = {}
) => ({ pipeline: null, closers: [], unknown: false, ...overrides });

const issue = (partial: FakeIssue): Required<FakeIssue> => ({
  state: 'open',
  stateReason: null,
  labels: [],
  body: '',
  isPullRequest: false,
  prMergedAt: null,
  pipelinePr: null,
  closers: [],
  deliverableUnknown: false,
  blockedAt: null,
  everInProgress: true,
  blockedBy: [],
  relationshipsUnknown: false,
  ...partial,
});

/**
 * Stands in for the GitHub half. `unreadable` is the important one: an issue the
 * API cannot return must be indistinguishable from a deleted one, and both must
 * block.
 */
function fakeApi(issues: FakeIssue[], options: { lastMergeAt?: number | null } = {}) {
  const byNumber = new Map(issues.map((i) => [i.number, issue(i)]));
  return {
    calls: [] as string[],
    async listIssuesByLabel(label: string) {
      return [...byNumber.values()].filter((i) => i.state === 'open' && i.labels.includes(label));
    },
    async getIssue(number: number) {
      return byNumber.get(number) ?? null;
    },
    async deliverableFor(number: number) {
      const found = byNumber.get(number);
      return {
        pipeline: found?.pipelinePr ?? null,
        closers: found?.closers ?? [],
        unknown: found?.deliverableUnknown ?? false,
      };
    },
    async declaredBlockedBy(number: number) {
      const found = byNumber.get(number);
      return {
        numbers: found?.blockedBy ?? [],
        available: true,
        unknown: found?.relationshipsUnknown ?? false,
      };
    },
    async blockedLabelledAt(number: number) {
      return byNumber.get(number)?.blockedAt ?? null;
    },
    async everCarriedInProgress(number: number) {
      return byNumber.get(number)?.everInProgress ?? true;
    },
    async latestPipelineMergeAt() {
      return options.lastMergeAt ?? null;
    },
  };
}

const select = (api: any, completedIssue: number | null = null) =>
  rules.selectNextAssignable(api, { completedIssue });

describe('reading declared dependencies out of an issue body', () => {
  const deps = rules.parseDependencies as (body: string) => number[];

  it('reads the `Blocked by` section the issue form and issue skill produce', () => {
    expect(deps('### Blocked by\n\n- #302 — level definition must exist first\n')).toEqual([302]);
  });

  it('reads the inline `Depends on` spelling older issues carry', () => {
    expect(deps('Depends on: #12\n')).toEqual([12]);
  });

  // The reason the body is only the *secondary* source: a reference in prose is
  // a mention, not a declaration. These are the shapes that must declare nothing,
  // and a looser opener — any list item containing the words — read them all as
  // dependencies, blocking on every issue a body happened to cite.
  it.each([
    ['a bullet inside another section', '## Context\n\n- depends on the rework in #123\n'],
    ['a sentence', 'This depends on #123 landing first, roughly.\n'],
    ['a quoted issue', '## Context\n\nSame bug as #55, see also #56.\n'],
    ['a checklist item citing an issue', '## Task\n\n- [ ] mirror what #77 did\n'],
  ])('declares nothing from %s', (_name, body) => {
    expect(deps(body)).toEqual([]);
  });

  it.each([
    ['a heading', '## Blocked by\n\n- #7\n'],
    ['a bold line', '**Blocked by**\n\n- #7\n'],
    ['a line-initial phrase', 'Blocked by: #7\n'],
  ])('declares a dependency from %s', (_name, body) => {
    expect(deps(body)).toEqual([7]);
  });

  it('collects every dependency in the section, not only the first', () => {
    expect(deps('## Blocked by\n- #7\n- #9\n')).toEqual([7, 9]);
  });

  it('stops at the next section', () => {
    const body = '## Blocked by\n\n- #7\n\n## Conventions\n\n- matches the pattern in #999\n';
    expect(deps(body)).toEqual([7]);
  });

  it('treats a section with no issue reference as unblocked', () => {
    expect(deps('## Blocked by\n\nNone\n')).toEqual([]);
    expect(deps('## Context\n\nSee #55 for background.\n')).toEqual([]);
  });

  it('survives an empty or missing body', () => {
    expect(deps('')).toEqual([]);
    expect((rules.parseDependencies as (b: unknown) => number[])(null)).toEqual([]);
  });
});

// GitHub's own "Blocked by" relationships — the Relationships panel on an issue.
// A relationship is a declaration; a body reference is a mention, and nothing
// about quoting an issue in prose can produce one. So this is the authority, and
// the body section is kept only because every issue written before relationships
// existed carries its dependencies there and nowhere else.
describe('combining GitHub relationships with the body section', () => {
  const collect = (api: any, body = '', number = 20) =>
    rules.blockedByFor(api, { number, body });

  it('reads a relationship the body never mentions', async () => {
    const api = fakeApi([{ number: 20, blockedBy: [547] }]);
    expect((await collect(api, '')).numbers).toEqual([547]);
  });

  it('still reads a body section on an issue with no relationship set', async () => {
    const api = fakeApi([{ number: 20 }]);
    expect((await collect(api, '## Blocked by\n\n- #547\n')).numbers).toEqual([547]);
  });

  // A union, not a choice. Preferring one source would either ignore the
  // authority or make every pre-relationship issue instantly assignable.
  it('takes the union when the two sources disagree', async () => {
    const api = fakeApi([{ number: 20, blockedBy: [547] }]);
    const result = await collect(api, '## Blocked by\n\n- #548\n');
    expect(result.numbers.sort()).toEqual([547, 548]);
  });

  it('deduplicates a dependency declared in both', async () => {
    const api = fakeApi([{ number: 20, blockedBy: [547] }]);
    expect((await collect(api, '## Blocked by\n\n- #547\n')).numbers).toEqual([547]);
  });

  it('ignores a self-reference from either source', async () => {
    const api = fakeApi([{ number: 20, blockedBy: [20] }]);
    expect((await collect(api, '## Blocked by\n\n- #20\n')).numbers).toEqual([]);
  });

  // The distinction that matters most: a repository without the feature is a
  // fact about the repository, but a call that failed is a fact about nothing.
  it('reports a failed relationship read as unknown', async () => {
    const api = fakeApi([{ number: 20, relationshipsUnknown: true }]);
    expect((await collect(api, '')).unknown).toBe(true);
  });

  it('blocks a candidate whose relationships could not be read', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready'], relationshipsUnknown: true }]);
    const result = await select(api);
    expect(result.issue).toBeNull();
  });

  it('blocks when a dependency of a dependency cannot report its relationships', async () => {
    const api = fakeApi([
      { number: 10, state: 'closed', stateReason: 'completed', relationshipsUnknown: true },
      { number: 20, labels: ['ready'], blockedBy: [10] },
    ]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#10');
  });

  // The pipeline predates the feature, so an API that does not offer it at all
  // must degrade to the body section rather than stalling the queue forever.
  it('falls back to the body when the API has no relationships at all', async () => {
    const bare = fakeApi([{ number: 20, labels: ['ready'], body: '## Blocked by\n\n- #547\n' }]) as any;
    delete bare.declaredBlockedBy;
    bare.getIssue = async (n: number) => (n === 547 ? issue({ number: 547 }) : issue({ number: 20, labels: ['ready'], body: '## Blocked by\n\n- #547\n' }));
    const result = await select(bare);
    expect(result.issue).toBeNull();
  });

  // End to end, the way the queue sees it: #548 is blocked by #547 through the
  // Relationships panel, with nothing in its body saying so.
  it('refuses an issue blocked only by a relationship', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready'], blockedBy: [547] },
      { number: 550, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(550);
  });
});

describe('conditions readable off the candidate itself', () => {
  it('assigns an ordinary ready issue', () => {
    expect(rules.labelVerdict(issue({ number: 1, labels: ['ready'] })).assignable).toBe(true);
  });

  it.each([
    ['blocked', ['ready', 'blocked']],
    ['in-progress', ['ready', 'in-progress']],
    ['done', ['ready', 'done']],
  ])('refuses an issue labelled `%s`', (_label, labels) => {
    const verdict = rules.labelVerdict(issue({ number: 1, labels }));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain(_label);
  });

  // `listForRepo` returns pull requests alongside issues, and a PR carrying
  // `ready` would otherwise be assigned as if it were a task.
  it('refuses a pull request', () => {
    expect(rules.labelVerdict(issue({ number: 1, isPullRequest: true })).assignable).toBe(false);
  });

  it('refuses a closed issue', () => {
    expect(rules.labelVerdict(issue({ number: 1, state: 'closed' })).assignable).toBe(false);
  });
});

describe('whether one dependency has actually landed', () => {
  it('accepts a dependency closed as completed with no open PR', () => {
    const dep = issue({ number: 5, state: 'closed', stateReason: 'completed' });
    expect(rules.dependencyVerdict(dep, deliverable()).assignable).toBe(true);
  });

  it('refuses a dependency that is still open', () => {
    const verdict = rules.dependencyVerdict(issue({ number: 5 }), null);
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#5');
  });

  // The state #547 is in. Its own label already says the work stopped.
  it('names `blocked` when the open dependency is itself blocked', () => {
    const verdict = rules.dependencyVerdict(issue({ number: 547, labels: ['blocked'] }), null);
    expect(verdict.reason).toContain('blocked');
  });

  // "Closed" is not the same as "delivered". Closing as not planned abandons the
  // work, and everything declaring it a dependency is still missing its ground.
  it('refuses a dependency closed as not planned', () => {
    const dep = issue({ number: 5, state: 'closed', stateReason: 'not_planned' });
    const verdict = rules.dependencyVerdict(dep, deliverable());
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('not planned');
  });

  // The headline case: the dependency is closed, but the pull request carrying
  // its code has not merged, so `main` does not have it. Both arms of the
  // deliverable predicate must catch it — the pipeline's own branch, and a PR
  // GitHub records as closing the issue.
  it('refuses a dependency whose pipeline pull request is still open', () => {
    const dep = issue({ number: 547, state: 'closed', stateReason: 'completed' });
    const verdict = rules.dependencyVerdict(
      dep,
      deliverable({ pipeline: { number: 566, merged: false } })
    );
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#566');
  });

  it('refuses a dependency whose closing pull request is still open', () => {
    const dep = issue({ number: 547, state: 'closed', stateReason: 'completed' });
    const verdict = rules.dependencyVerdict(
      dep,
      deliverable({ closers: [{ number: 566, merged: false }] })
    );
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#566');
  });

  it('accepts a dependency whose pull requests all merged', () => {
    const dep = issue({ number: 5, state: 'closed', stateReason: 'completed' });
    const done = deliverable({
      pipeline: { number: 6, merged: true },
      closers: [{ number: 6, merged: true }],
    });
    expect(rules.dependencyVerdict(dep, done).assignable).toBe(true);
  });

  // A read that failed is not an empty list — fail closed, never open.
  it('refuses a dependency whose pull requests could not be read', () => {
    const dep = issue({ number: 5, state: 'closed', stateReason: 'completed' });
    const verdict = rules.dependencyVerdict(dep, deliverable({ unknown: true }));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('could not be read');
  });

  // A `Blocked by` line may name the PR rather than the issue it closes.
  it('refuses a dependency that is an unmerged pull request', () => {
    const dep = issue({ number: 566, isPullRequest: true, state: 'open' });
    expect(rules.dependencyVerdict(dep, null).assignable).toBe(false);
  });

  it('accepts a dependency that is a merged pull request', () => {
    const dep = issue({
      number: 566,
      isPullRequest: true,
      state: 'closed',
      prMergedAt: '2026-08-11T12:00:00Z',
    });
    expect(rules.dependencyVerdict(dep, null).assignable).toBe(true);
  });

  // A closed PR that never merged is a rejected deliverable, not a landed one.
  it('refuses a dependency that is a closed but unmerged pull request', () => {
    const dep = issue({ number: 566, isPullRequest: true, state: 'closed', prMergedAt: null });
    expect(rules.dependencyVerdict(dep, null).assignable).toBe(false);
  });
});

describe('walking the whole dependency graph', () => {
  const closed = (number: number, body = '') =>
    issue({ number, state: 'closed', stateReason: 'completed', body });

  it('assigns when every declared dependency has landed', async () => {
    const api = fakeApi([closed(10), { number: 20, labels: ['ready'], body: '## Blocked by\n- #10\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(true);
  });

  // Stopping at depth one reads a contradictory graph as satisfied: a human can
  // close an issue by hand while the issue it declared as its own dependency is
  // still open.
  it('follows dependencies of dependencies', async () => {
    const api = fakeApi([
      { number: 5 },
      closed(10, '## Blocked by\n- #5\n'),
      { number: 20, labels: ['ready'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#5');
  });

  // A typo in a `Blocked by` line used to read as "no dependency" and start the
  // run anyway. A dependency that cannot be verified is unmet, not absent.
  it('refuses when a declared dependency cannot be read', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready'], body: '## Blocked by\n- #999\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#999');
  });

  it('terminates on a dependency cycle', async () => {
    const api = fakeApi([
      closed(10, '## Blocked by\n- #20\n'),
      closed(20, '## Blocked by\n- #10\n'),
    ]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(true);
  });

  it('ignores a self-reference', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready'], body: '## Blocked by\n- #20\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(true);
  });

  // A graph this size is a malformed body, and an unwalked graph is unverified.
  it('refuses a graph larger than it will walk', async () => {
    const size = rules.MAX_DEPENDENCY_NODES + 5;
    const chain = Array.from({ length: size }, (_, index) =>
      closed(100 + index, `## Blocked by\n- #${101 + index}\n`)
    );
    const api = fakeApi([...chain, { number: 20, labels: ['ready'], body: '## Blocked by\n- #100\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain(String(rules.MAX_DEPENDENCY_NODES));
  });
});

describe('picking the next issue', () => {
  it('picks the oldest assignable ready issue', async () => {
    const api = fakeApi([
      { number: 30, labels: ['ready'] },
      { number: 20, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(20);
  });

  it('skips a blocked issue and takes the next one', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'blocked'] },
      { number: 30, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(30);
  });

  // The rescued-branch shape. #547 keeps PR #566 open; re-adding `ready` to it
  // by hand would otherwise start a second run against a branch that already has
  // commits on it. Both deliverable arms must catch it.
  it('skips an issue whose pipeline pull request is open', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready'], pipelinePr: { number: 566, merged: false } },
      { number: 548, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  it('skips an issue an open pull request closes', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  // The predicate is deliverable PRs, never mentions: an open PR that cites the
  // issue in prose raises a timeline cross-reference and nothing else, so it
  // appears in neither arm and must not block. PR #567's own body cites half
  // the backlog — under the mention predicate that PR froze it.
  it('assigns an issue an open pull request merely mentions', async () => {
    const api = fakeApi([{ number: 548, labels: ['ready'] }]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  it('assigns an issue whose pull request was closed without merging', async () => {
    // A closed-unmerged PR is a rejected deliverable: deliverableFor reports
    // neither arm, so the issue is assignable again.
    const api = fakeApi([{ number: 547, labels: ['ready'] }]);
    expect((await select(api)).issue?.number).toBe(547);
  });

  it('skips an issue whose pull requests could not be read', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready'], deliverableUnknown: true },
      { number: 548, labels: ['ready'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  // The requirement in one test: #547 is blocked with PR #566 unmerged, and its
  // whole follow-up batch declares `Blocked by #547`. None of them may run.
  it('assigns nothing when every candidate waits on the unmerged run', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready'], body: '## Blocked by\n\n- #547\n' },
      { number: 549, labels: ['ready'], body: '## Blocked by\n\n- #548\n' },
    ]);
    const result = await select(api);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('no assignable');
  });

  it('assigns the unblocked issue in that batch', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready'], body: '## Blocked by\n\n- #547\n' },
      { number: 550, labels: ['ready'], body: '## Blocked by\n\nNone\n' },
    ]);
    expect((await select(api)).issue?.number).toBe(550);
  });

  // Single flight. Two sessions would compete over the same `pipeline/*` branches.
  it('assigns nothing while another issue is in progress', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress'] },
      { number: 30, labels: ['ready'] },
    ]);
    const result = await select(api);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('#20');
  });

  // The issue the chain is coming *from* still carries its labels while the
  // chaining step runs, and deferring against it would stop the loop dead.
  it('does not defer against the issue it is chaining from', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress'] },
      { number: 30, labels: ['ready'] },
    ]);
    expect((await select(api, 20)).issue?.number).toBe(30);
  });

  it('reports an idle queue rather than failing', async () => {
    const result = await select(fakeApi([]));
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('no assignable');
  });
});

describe('the cascade brake', () => {
  const HOUR = 60 * 60 * 1000;
  const now = Date.parse('2026-08-11T12:00:00Z');
  const lastMergeAt = now - 6 * HOUR;

  const blockedAt = (number: number, at: number): FakeIssue => ({
    number,
    labels: ['blocked'],
    blockedAt: at,
  });

  it('counts the runs that ended blocked since the last pipeline merge', async () => {
    const api = fakeApi(
      [
        blockedAt(1, lastMergeAt - HOUR), // before the merge — a failure already recovered from
        blockedAt(2, lastMergeAt + HOUR),
        blockedAt(3, lastMergeAt + 2 * HOUR),
      ],
      { lastMergeAt }
    );
    expect(await rules.consecutiveBlockedRuns(api, { now })).toBe(2);
  });

  // A merged pipeline PR is proof the loop can still finish something, so it
  // resets the count — otherwise the brake would trip on unrelated history.
  it('is reset by a merge', async () => {
    const api = fakeApi([blockedAt(1, lastMergeAt - HOUR), blockedAt(2, lastMergeAt - 2 * HOUR)], {
      lastMergeAt,
    });
    expect(await rules.consecutiveBlockedRuns(api, { now })).toBe(0);
  });

  // With no merge to count from, an unbounded lookback would count every blocked
  // issue the repository has ever had and refuse to chain at all.
  it('falls back to a window when the pipeline has never merged anything', async () => {
    const api = fakeApi(
      [
        blockedAt(1, now - 30 * 24 * HOUR),
        blockedAt(2, now - HOUR),
      ],
      { lastMergeAt: null }
    );
    expect(await rules.consecutiveBlockedRuns(api, { now })).toBe(1);
  });

  // #474 is a human note labelled `blocked` by hand — no run ever owned it.
  // Notes record problems; only failed runs measure whether the pipeline works.
  it('does not count a blocked issue no run ever held', async () => {
    const api = fakeApi(
      [
        { ...blockedAt(1, lastMergeAt + HOUR), everInProgress: false },
        blockedAt(2, lastMergeAt + 2 * HOUR),
      ],
      { lastMergeAt }
    );
    expect(await rules.consecutiveBlockedRuns(api, { now })).toBe(1);
  });

  it('ignores a blocked issue with no labelling event to age', async () => {
    const api = fakeApi([{ number: 1, labels: ['blocked'], blockedAt: null }], { lastMergeAt });
    expect(await rules.consecutiveBlockedRuns(api, { now })).toBe(0);
  });

  it.each([
    ['', rules.DEFAULT_BLOCKED_CHAIN_LIMIT],
    ['not a number', rules.DEFAULT_BLOCKED_CHAIN_LIMIT],
    ['0', rules.DEFAULT_BLOCKED_CHAIN_LIMIT],
    ['-1', rules.DEFAULT_BLOCKED_CHAIN_LIMIT],
    ['5', 5],
    [' 2 ', 2],
  ])('reads a configured limit of "%s" as %i', (raw, expected) => {
    expect(rules.blockedChainLimit(raw)).toBe(expected);
  });
});

describe('resolving the configured agent', () => {
  it.each([
    ['', '@opencode'],
    ['opencode', '@opencode'],
    ['@opencode', '@opencode'],
    ['claude', '@claude'],
    ['@Claude', '@claude'],
    ['  @CLAUDE  ', '@claude'],
  ])('reads "%s" as %s', (raw, expected) => {
    expect(rules.resolveMention(raw)).toBe(expected);
  });

  // A typo must fail the step, never silently run the other runtime.
  it.each(['copilot', '@gpt', 'claude-code'])('refuses "%s"', (raw) => {
    expect(rules.resolveMention(raw)).toBeNull();
  });
});

describe('the GitHub half', () => {
  const octokit = (overrides: Record<string, unknown> = {}) => ({
    rest: {
      issues: {
        get: async () => ({ data: { number: 1, state: 'open', labels: [], body: '' } }),
        listForRepo: async () => ({ data: [] }),
        listEventsForTimeline: async () => ({ data: [] }),
        ...overrides,
      },
      pulls: { list: async () => ({ data: [] }) },
    },
    graphql: async () => ({
      repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } },
    }),
  });

  const api = (overrides?: Record<string, unknown>) =>
    createIssueApi(octokit(overrides), { owner: 'o', repo: 'r' });

  it('normalises labels arriving as objects', async () => {
    const client = api({
      get: async () => ({
        data: { number: 1, state: 'open', labels: [{ name: 'ready' }, 'blocked'], body: '' },
      }),
    });
    expect((await client.getIssue(1)).labels).toEqual(['ready', 'blocked']);
  });

  // The distinction the dependency rules turn on.
  it('reports a pull request and whether it merged', async () => {
    const client = api({
      get: async () => ({
        data: {
          number: 566,
          state: 'closed',
          labels: [],
          pull_request: { merged_at: '2026-08-11T12:00:00Z' },
        },
      }),
    });
    const pr = await client.getIssue(566);
    expect(pr.isPullRequest).toBe(true);
    expect(pr.prMergedAt).toBe('2026-08-11T12:00:00Z');
  });

  // Fail closed: an unreadable issue must be indistinguishable from a missing
  // one, because every rule treats both as blocking.
  it('returns null for an issue it cannot read', async () => {
    const client = api({
      get: async () => {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      },
    });
    expect(await client.getIssue(999)).toBeNull();
  });

  it('reads label events off the timeline', async () => {
    const client = api({
      listEventsForTimeline: async () => ({
        data: [
          { event: 'cross-referenced', source: { issue: { number: 566, state: 'open', pull_request: {} } } },
          { event: 'labeled', label: { name: 'blocked' }, created_at: '2026-08-11T12:00:00Z' },
        ],
      }),
    });
    expect(await client.blockedLabelledAt(1)).toBe(Date.parse('2026-08-11T12:00:00Z'));
    expect(await client.everCarriedInProgress(1)).toBe(false);
  });

  // The deliverable predicate, per #568: a PR from the issue's own pipeline
  // branch, or one GitHub records as closing it. Never a timeline mention.
  describe('deliverableFor', () => {
    it('asks for the pipeline branch by exact head and reads closers via GraphQL', async () => {
      let askedHead = '';
      let graphqlVariables: Record<string, unknown> | null = null;
      const client = createIssueApi(
        {
          rest: {
            issues: octokit().rest.issues,
            pulls: {
              list: async (params: { head: string }) => {
                askedHead = params.head;
                return { data: [{ number: 566, state: 'open', merged_at: null }] };
              },
            },
          },
          graphql: async (query: string, variables: Record<string, unknown>) => {
            graphqlVariables = variables;
            expect(query).toContain('closedByPullRequestsReferences');
            expect(query).toContain('includeClosedPrs: false');
            return {
              repository: {
                issue: { closedByPullRequestsReferences: { nodes: [{ number: 570, merged: true }] } },
              },
            };
          },
        },
        { owner: 'o', repo: 'r' }
      );
      const result = await client.deliverableFor(547);
      expect(askedHead).toBe('o:pipeline/feature-547');
      expect(graphqlVariables).toMatchObject({ owner: 'o', repo: 'r', number: 547 });
      expect(result).toEqual({
        pipeline: { number: 566, merged: false },
        closers: [{ number: 570, merged: true }],
        unknown: false,
      });
    });

    // A closed-unmerged head-branch PR is a rejected deliverable — reported as
    // no pipeline PR, so the issue becomes assignable again.
    it('ignores a closed-unmerged pipeline pull request', async () => {
      const client = createIssueApi(
        {
          rest: {
            issues: octokit().rest.issues,
            pulls: { list: async () => ({ data: [{ number: 566, state: 'closed', merged_at: null }] }) },
          },
          graphql: async () => ({
            repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } },
          }),
        },
        { owner: 'o', repo: 'r' }
      );
      expect(await client.deliverableFor(547)).toEqual({ pipeline: null, closers: [], unknown: false });
    });

    // Fail closed on any read error: a 500 is not an empty list.
    it('reports unknown when either read fails', async () => {
      const restFails = createIssueApi(
        {
          rest: {
            issues: octokit().rest.issues,
            pulls: { list: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } },
          },
          graphql: async () => ({ repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } } }),
        },
        { owner: 'o', repo: 'r' }
      );
      expect((await restFails.deliverableFor(1)).unknown).toBe(true);

      const graphqlFails = createIssueApi(
        {
          rest: { issues: octokit().rest.issues, pulls: { list: async () => ({ data: [] }) } },
          graphql: async () => { throw new Error('GraphQL down'); },
        },
        { owner: 'o', repo: 'r' }
      );
      expect((await graphqlFails.deliverableFor(1)).unknown).toBe(true);
    });
  });

  it('reads the latest merge of a pipeline branch', async () => {
    const client = createIssueApi(
      {
        rest: {
          issues: octokit().rest.issues,
          pulls: {
            list: async () => ({
              data: [
                { merged_at: '2026-08-01T00:00:00Z', head: { ref: 'pipeline/feature-1' } },
                { merged_at: '2026-08-09T00:00:00Z', head: { ref: 'pipeline/feature-2' } },
                { merged_at: '2026-08-10T00:00:00Z', head: { ref: 'chore/unrelated' } },
                { merged_at: null, head: { ref: 'pipeline/feature-3' } },
              ],
            }),
          },
        },
      },
      { owner: 'o', repo: 'r' }
    );
    expect(await client.latestPipelineMergeAt()).toBe(Date.parse('2026-08-09T00:00:00Z'));
  });

  it('reports no pipeline merge rather than guessing one', async () => {
    expect(await api().latestPipelineMergeAt()).toBeNull();
  });

  // The timeline of a long-lived pipeline issue runs to hundreds of label
  // events, and the labels the rules read — `in-progress` for the chain guard,
  // `blocked` for the cascade brake — can sit on any page.
  describe('a timeline longer than one page', () => {
    /** `pages` pages of filler, with the telling event on the last one. */
    const paged = (pages: number) => {
      let served = 0;
      return {
        listEventsForTimeline: async ({ page }: { page: number }) => {
          served = Math.max(served, page);
          const last = page >= pages;
          const filler = Array.from({ length: last ? 3 : 100 }, () => ({
            event: 'labeled',
            label: { name: 'noise' },
            created_at: '2026-08-01T00:00:00Z',
          }));
          if (last) {
            filler.push({
              event: 'labeled',
              label: { name: 'in-progress' },
              created_at: '2026-08-01T00:00:00Z',
            } as never);
          }
          return { data: filler };
        },
        pagesServed: () => served,
      };
    };

    it('reads every page of label events before concluding anything', async () => {
      const pager = paged(3);
      const client = api({ listEventsForTimeline: pager.listEventsForTimeline });
      // The in-progress event sits on the last page; a one-page read misses it.
      expect(await client.everCarriedInProgress(1)).toBe(true);
      expect(pager.pagesServed()).toBe(3);
    });

    it('reads the timeline once however many rules ask about it', async () => {
      const pager = paged(2);
      const client = api({ listEventsForTimeline: pager.listEventsForTimeline });
      await client.blockedLabelledAt(1);
      await client.everCarriedInProgress(1);
      expect(pager.pagesServed()).toBe(2);
    });

    // An undated failure has to count as a recent one, or a truncated history
    // would quietly reopen a chain the brake had closed.
    it('dates an unreadable `blocked` label as now rather than never', async () => {
      const now = Date.parse('2026-08-11T12:00:00Z');
      const client = api({
        listEventsForTimeline: async () => ({
          data: Array.from({ length: 100 }, () => ({ event: 'labeled', label: { name: 'noise' } })),
        }),
      });
      expect(await client.blockedLabelledAt(1, now)).toBe(now);
    });
  });
});

// Structural assertions cannot show that the guards actually do anything, and
// the guards are where an autonomous queue either keeps moving or runs away with
// itself. This block lifts the composite action's own script out of the YAML and
// runs it against a fake GitHub — the same source the runner executes.
describe('running the assign action end to end', () => {
  interface Scenario {
    issues: FakeIssue[];
    /** `labeled` timeline events per issue: label name → epoch ms. */
    events?: Record<number, { label: string; at: number }[]>;
    mergedPipelinePrs?: { merged_at: string | null; head: { ref: string } }[];
    /** Comments already on an issue when the step starts. */
    existingComments?: { issue: number; body: string }[];
    env?: Record<string, string>;
  }

  interface Run {
    outputs: Record<string, string>;
    comments: { issue: number; body: string }[];
    labelled: { issue: number; labels: string[] }[];
    unlabelled: { issue: number; label: string }[];
    failed: string | null;
    log: string[];
  }

  const script = (() => {
    const action = readFileSync(join(ROOT, '.github/actions/agentic-assign/action.yml'), 'utf8');
    // The script is the last block in the file, indented under `script: |`.
    const marker = 'script: |\n';
    const body = action.slice(action.indexOf(marker) + marker.length);
    return body
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');
  })();

  async function run(scenario: Scenario): Promise<Run> {
    const state = new Map(scenario.issues.map((i) => [i.number, issue(i)]));
    const result: Run = {
      outputs: {},
      comments: [...(scenario.existingComments ?? [])],
      labelled: [],
      unlabelled: [],
      failed: null,
      log: [],
    };

    // Label events, plus a prose mention on every issue: any real timeline has
    // cross-references, and the scripts must never read one as a deliverable.
    const timelineOf = (number: number) => [
      ...(scenario.events?.[number] ?? []).map((event) => ({
        event: 'labeled',
        label: { name: event.label },
        created_at: new Date(event.at).toISOString(),
      })),
      {
        event: 'cross-referenced',
        source: { issue: { number: 9999, state: 'open', pull_request: {} } },
      },
    ];

    const github = {
      rest: {
        issues: {
          get: async ({ issue_number }: { issue_number: number }) => {
            const found = state.get(issue_number);
            if (!found) throw Object.assign(new Error('Not Found'), { status: 404 });
            return {
              data: {
                ...found,
                state_reason: found.stateReason,
                pull_request: found.isPullRequest ? { merged_at: found.prMergedAt } : undefined,
              },
            };
          },
          listForRepo: async ({ labels }: { labels: string }) => ({
            data: [...state.values()]
              .filter((i) => i.state === 'open' && i.labels.includes(labels))
              .map((i) => ({ ...i, state_reason: i.stateReason })),
          }),
          listEventsForTimeline: async ({ issue_number }: { issue_number: number }) => ({
            data: timelineOf(issue_number),
          }),
          listComments: async ({ issue_number }: { issue_number: number }) => ({
            data: result.comments
              .filter((comment) => comment.issue === issue_number)
              .map((comment) => ({ body: comment.body })),
          }),
          createComment: async ({ issue_number, body }: { issue_number: number; body: string }) => {
            result.comments.push({ issue: issue_number, body });
            return { data: {} };
          },
          addLabels: async ({ issue_number, labels }: { issue_number: number; labels: string[] }) => {
            result.labelled.push({ issue: issue_number, labels });
            const found = state.get(issue_number);
            if (found) found.labels = [...found.labels, ...labels];
            return { data: {} };
          },
          removeLabel: async ({ issue_number, name }: { issue_number: number; name: string }) => {
            result.unlabelled.push({ issue: issue_number, label: name });
            const found = state.get(issue_number);
            if (found) found.labels = found.labels.filter((label) => label !== name);
            return { data: {} };
          },
        },
        pulls: {
          list: async (params: { head?: string }) => {
            if (params.head) {
              const match = /pipeline\/feature-(\d+)$/.exec(params.head);
              const found = match ? state.get(parseInt(match[1], 10)) : undefined;
              const pr = found?.pipelinePr;
              return {
                data: pr
                  ? [{ number: pr.number, state: pr.merged ? 'closed' : 'open', merged_at: pr.merged ? '2026-08-11T00:00:00Z' : null }]
                  : [],
              };
            }
            return { data: scenario.mergedPipelinePrs ?? [] };
          },
        },
      },
      graphql: async (_query: string, params: { number: number }) => {
        const found = state.get(params.number);
        return {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes: (found?.closers ?? []).map((pr) => ({ number: pr.number, merged: pr.merged })),
              },
            },
          },
        };
      },
      // The dependencies endpoints have no octokit helper, so the action reaches
      // them through `github.request` with an explicit route. Asserting the route
      // here is what keeps a typo in it from silently degrading to "no
      // relationships" on every issue.
      request: async (route: string, params: { issue_number: number }) => {
        expect(route).toBe(
          'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by'
        );
        const found = state.get(params.issue_number);
        if (!found) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { data: (found.blockedBy ?? []).map((number) => ({ number })) };
      },
    };

    const core = {
      info: (message: string) => result.log.push(message),
      warning: (message: string) => result.log.push(message),
      setFailed: (message: string) => {
        result.failed = message;
      },
      setOutput: (name: string, value: string) => {
        result.outputs[name] = value;
      },
    };

    const env = {
      GITHUB_WORKSPACE: ROOT,
      AGENTIC_AGENT: '@claude',
      ASSIGN_REASON: 'test',
      ASSIGN_GUARD: 'none',
      COMPLETED_ISSUE: '',
      BLOCKED_CHAIN_LIMIT: '',
      ...scenario.env,
    };

    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const compiled = new AsyncFunction('github', 'context', 'core', 'require', 'process', script);
    await compiled(
      github,
      { repo: { owner: 'Nico2398', repo: 'BlastSimulator2026' } },
      core,
      require,
      { env }
    );
    return result;
  }

  const blockedRun = (number: number, at: number) => ({
    [number]: [
      { label: 'in-progress', at: at - 60_000 },
      { label: 'blocked', at },
    ],
  });

  const NOW = Date.now();

  it('assigns the oldest assignable issue and posts the trigger comment', async () => {
    const result = await run({ issues: [{ number: 30, labels: ['ready'] }, { number: 20, labels: ['ready'] }] });
    expect(result.outputs.issue).toBe('20');
    expect(result.labelled).toEqual([{ issue: 20, labels: ['in-progress'] }]);
    expect(result.unlabelled).toEqual([{ issue: 20, label: 'ready' }]);
    expect(result.comments[0].body).toContain('@claude');
    expect(result.comments[0].body).toContain('issue #20');
  });

  it('fails loudly on an unrecognised agent rather than picking one', async () => {
    const result = await run({ issues: [], env: { AGENTIC_AGENT: 'copilot' } });
    expect(result.failed).toContain('AGENTIC_AGENT');
    expect(result.outputs.issue).toBe('');
  });

  // The whole point of the change: a run that ends `blocked` releases the queue
  // instead of parking it until a human dispatches the trigger.
  it('chains to the next issue when a run ends blocked', async () => {
    const result = await run({
      issues: [
        { number: 547, labels: ['blocked', 'in-progress'], pipelinePr: { number: 566, merged: false } },
        { number: 550, labels: ['ready'] },
      ],
      events: blockedRun(547, NOW - 60_000),
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issue).toBe('550');
    expect(result.outputs.halted).toBe('false');
    // `blocked` means the run is over, so the two labels cannot both stand.
    expect(result.unlabelled).toContainEqual({ issue: 547, label: 'in-progress' });
  });

  // The requirement stated as the pipeline sees it: #547 stopped with PR #566
  // unmerged, and everything queued behind it declares the dependency.
  it('assigns nothing when the rest of the queue waits on the blocked issue', async () => {
    const result = await run({
      issues: [
        { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
        { number: 548, labels: ['ready'], body: '## Blocked by\n\n- #547\n' },
        { number: 549, labels: ['ready'], body: '## Blocked by\n\n- #548\n' },
      ],
      events: blockedRun(547, NOW - 60_000),
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issue).toBe('');
    expect(result.labelled).toEqual([]);
    expect(result.log.join('\n')).toContain('#548');
  });

  // A human labelling a backlog issue `blocked` is filing a note, not ending a
  // run. Without this the label alone would start a session.
  it('starts nothing from an issue no run ever held', async () => {
    const result = await run({
      issues: [
        { number: 900, labels: ['blocked'] },
        { number: 550, labels: ['ready'] },
      ],
      events: { 900: [{ label: 'blocked', at: NOW }] },
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '900' },
    });
    expect(result.outputs.issue).toBe('');
    expect(result.log.join('\n')).toContain('never carried');
  });

  // Chaining from failure is what a systemic fault would ride: an expired token
  // or a broken `main` fails every run, and each failure would start the next.
  it('parks the queue once too many runs in a row have ended blocked', async () => {
    const result = await run({
      issues: [
        { number: 541, labels: ['blocked'] },
        { number: 543, labels: ['blocked'] },
        { number: 547, labels: ['blocked'] },
        { number: 550, labels: ['ready'] },
      ],
      events: {
        ...blockedRun(541, NOW - 3 * 60_000),
        ...blockedRun(543, NOW - 2 * 60_000),
        ...blockedRun(547, NOW - 60_000),
      },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-540' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issue).toBe('');
    expect(result.outputs.halted).toBe('true');
    expect(result.comments.at(-1)?.body).toContain('Pipeline paused');
    // The one state the loop cannot leave on its own has to name its way out.
    expect(result.comments.at(-1)?.body).toContain('dispatch');
  });

  // A second `blocked` label on the same issue re-enters this guard. Repeating
  // the notice on every failure would bury the first one under itself.
  it('posts the halt notice once, however often the brake trips', async () => {
    const marker = '<!-- agentic-cascade-brake -->';
    const scenario: Scenario = {
      issues: [
        { number: 541, labels: ['blocked'] },
        { number: 543, labels: ['blocked'] },
        { number: 547, labels: ['blocked'] },
        { number: 550, labels: ['ready'] },
      ],
      events: {
        ...blockedRun(541, NOW - 3 * 60_000),
        ...blockedRun(543, NOW - 2 * 60_000),
        ...blockedRun(547, NOW - 60_000),
      },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-540' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    };

    const first = await run(scenario);
    expect(first.comments).toHaveLength(1);
    expect(first.comments[0].body).toContain(marker);

    const second = await run({ ...scenario, existingComments: first.comments });
    expect(second.comments).toHaveLength(1);
    expect(second.outputs.halted).toBe('true');
  });

  // A merge is proof the loop still works, so the count starts again from it.
  // Without this the brake would trip on unrelated history and never reopen.
  it('keeps chaining when the blocked runs predate the last merge', async () => {
    const result = await run({
      issues: [
        { number: 541, labels: ['blocked'] },
        { number: 543, labels: ['blocked'] },
        { number: 547, labels: ['blocked'] },
        { number: 550, labels: ['ready'] },
      ],
      events: {
        ...blockedRun(541, NOW - 5 * 3_600_000),
        ...blockedRun(543, NOW - 4 * 3_600_000),
        ...blockedRun(547, NOW - 60_000),
      },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issue).toBe('550');
    expect(result.outputs.halted).toBe('false');
  });

  it('honours a configured cascade limit', async () => {
    const scenario: Scenario = {
      issues: [
        { number: 543, labels: ['blocked'] },
        { number: 547, labels: ['blocked'] },
        { number: 550, labels: ['ready'] },
      ],
      events: { ...blockedRun(543, NOW - 2 * 60_000), ...blockedRun(547, NOW - 60_000) },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-540' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547', BLOCKED_CHAIN_LIMIT: '2' },
    };
    expect((await run(scenario)).outputs.halted).toBe('true');

    scenario.env!.BLOCKED_CHAIN_LIMIT = '4';
    expect((await run(scenario)).outputs.issue).toBe('550');
  });

  // Reading an unknown state as "safe to chain" is the one thing this step must
  // never do, so an unreadable issue fails the job instead.
  it('fails rather than chaining from an issue it cannot read', async () => {
    const result = await run({
      issues: [{ number: 550, labels: ['ready'] }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '999' },
    });
    expect(result.failed).toContain('#999');
    expect(result.outputs.issue).toBe('');
  });

  it('stops when the blocked label was already removed', async () => {
    const result = await run({
      issues: [
        { number: 547, labels: [] },
        { number: 550, labels: ['ready'] },
      ],
      events: blockedRun(547, NOW - 60_000),
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issue).toBe('');
    expect(result.log.join('\n')).toContain('no longer carries');
  });
});

// The rules are only rock-solid if every path into the queue runs them. A
// workflow that grew its own copy of the selection logic would drift from this
// file silently, which is the failure mode the extraction exists to prevent.
describe('every entry point decides through the same rules', () => {
  const action = readFileSync(
    join(ROOT, '.github/actions/agentic-assign/action.yml'),
    'utf8'
  );

  it('reads the rules from the workspace rather than vendoring them', () => {
    expect(action).toContain('.github/scripts/assignability.cjs');
    expect(action).toContain('.github/scripts/issue-api.cjs');
  });

  it('keeps no second copy of the dependency parser in the YAML', () => {
    expect(action).not.toContain('const dependenciesOf');
    expect(action).not.toMatch(/blocked\\s\+by/);
  });

  it.each(['agentic-trigger.yml', 'auto-assign-next.yml', 'handle-failure.yml'])(
    '%s checks the repository out before assigning',
    (name) => {
      const text = readFileSync(join(ROOT, '.github/workflows', name), 'utf8');
      const assign = text.indexOf('uses: ./.github/actions/agentic-assign');
      expect(assign, `${name} does not assign`).toBeGreaterThan(-1);
      expect(text.slice(0, assign)).toContain('actions/checkout@v4');
    }
  );
});
