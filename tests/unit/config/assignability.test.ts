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
  /** The PR from this issue's own `pipeline/feature-<N>[-<runId>]` branch, if one exists. */
  pipelinePr?: { number: number; merged: boolean; labels?: string[]; head?: string } | null;
  /** Head branch that PR sits on. Defaults to the bare pre-convention name. */
  pipelineBranch?: string;
  /** PRs GitHub records as closing this issue (open and merged only). */
  closers?: { number: number; merged: boolean; labels?: string[]; head?: string }[];
  /** The deliverable-PR read failed — callers must fail closed. */
  deliverableUnknown?: boolean;
  /** When `blocked` was last applied, epoch ms. */
  blockedAt?: number | null;
  /** When `paused` was last applied, epoch ms. */
  pausedAt?: number | null;
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
  pipelineBranch: '',
  closers: [],
  deliverableUnknown: false,
  blockedAt: null,
  pausedAt: null,
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
      // `labels` defaults to empty, which is what a degraded read produces too —
      // and empty must read as "not paused", so the rules block rather than
      // resume onto a branch they could not confirm.
      const withLabels = (pr: { number: number; merged: boolean; labels?: string[]; head?: string }) => ({
        labels: [],
        head: null,
        ...pr,
      });
      const found = byNumber.get(number);
      return {
        pipeline: found?.pipelinePr ? withLabels(found.pipelinePr) : null,
        closers: (found?.closers ?? []).map(withLabels),
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
    async labelAppliedAt(number: number, label: string) {
      const found = byNumber.get(number);
      return (label === 'paused' ? found?.pausedAt : found?.blockedAt) ?? null;
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

  // #1103, 15 Sep 2026: the body cited the blocker's own number only to
  // explain *why* the issue was filed, and the indiscriminate `#\d+` scan
  // read that as a declared dependency — creating a mutual cycle that
  // stranded the pause `strandedPauseVerdict` exists to catch. The first
  // non-empty line of a `Blocked by` section beginning with the word `None`
  // means the section declares nothing, whatever it mentions afterward.
  it('reads a `None` sentinel as declaring nothing, even when the section goes on to mention an issue', () => {
    const body =
      '## Blocked by\n\nNone — this is standalone debugging work. It is filed as a dependency of #1089 only because the branch is shared.\n';
    expect(deps(body)).toEqual([]);
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
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'scope:engine'], relationshipsUnknown: true }]);
    const result = await select(api);
    expect(result.issue).toBeNull();
  });

  it('blocks when a dependency of a dependency cannot report its relationships', async () => {
    const api = fakeApi([
      { number: 10, state: 'closed', stateReason: 'completed', relationshipsUnknown: true },
      { number: 20, labels: ['ready', 'agent-task', 'scope:engine'], blockedBy: [10] },
    ]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#10');
  });

  // The pipeline predates the feature, so an API that does not offer it at all
  // must degrade to the body section rather than stalling the queue forever.
  it('falls back to the body when the API has no relationships at all', async () => {
    const bare = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' }]) as any;
    delete bare.declaredBlockedBy;
    bare.getIssue = async (n: number) => (n === 547 ? issue({ number: 547 }) : issue({ number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' }));
    const result = await select(bare);
    expect(result.issue).toBeNull();
  });

  // End to end, the way the queue sees it: #548 is blocked by #547 through the
  // Relationships panel, with nothing in its body saying so.
  it('refuses an issue blocked only by a relationship', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'], blockedBy: [547] },
      { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(550);
  });
});

describe('conditions readable off the candidate itself', () => {
  it('assigns an ordinary ready issue', () => {
    expect(rules.labelVerdict(issue({ number: 1, labels: ['ready', 'agent-task', 'scope:engine'] })).assignable).toBe(true);
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
    const api = fakeApi([closed(10), { number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #10\n' }]);
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
      { number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('#5');
  });

  // A typo in a `Blocked by` line used to read as "no dependency" and start the
  // run anyway. A dependency that cannot be verified is unmet, not absent.
  it('refuses when a declared dependency cannot be read', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #999\n' }]);
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
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #20\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(true);
  });

  // A graph this size is a malformed body, and an unwalked graph is unverified.
  it('refuses a graph larger than it will walk', async () => {
    const size = rules.MAX_DEPENDENCY_NODES + 5;
    const chain = Array.from({ length: size }, (_, index) =>
      closed(100 + index, `## Blocked by\n- #${101 + index}\n`)
    );
    const api = fakeApi([...chain, { number: 20, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #100\n' }]);
    const verdict = await rules.graphVerdict(api, await api.getIssue(20));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain(String(rules.MAX_DEPENDENCY_NODES));
  });
});

describe('picking the next issue', () => {
  it('picks the oldest assignable ready issue', async () => {
    const api = fakeApi([
      { number: 30, labels: ['ready', 'agent-task', 'scope:engine'] },
      { number: 20, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(20);
  });

  it('skips a blocked issue and takes the next one', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'blocked', 'scope:engine'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(30);
  });

  // The rescued-branch shape. #547 keeps PR #566 open; re-adding `ready` to it
  // by hand would otherwise start a second run against a branch that already has
  // commits on it. Both deliverable arms must catch it.
  it('skips an issue whose pipeline pull request is open', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready', 'agent-task', 'scope:engine'], pipelinePr: { number: 566, merged: false } },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  it('skips an issue an open pull request closes', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready', 'agent-task', 'scope:engine'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  // The predicate is deliverable PRs, never mentions: an open PR that cites the
  // issue in prose raises a timeline cross-reference and nothing else, so it
  // appears in neither arm and must not block. PR #567's own body cites half
  // the backlog — under the mention predicate that PR froze it.
  it('assigns an issue an open pull request merely mentions', async () => {
    const api = fakeApi([{ number: 548, labels: ['ready', 'agent-task', 'scope:engine'] }]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  it('assigns an issue whose pull request was closed without merging', async () => {
    // A closed-unmerged PR is a rejected deliverable: deliverableFor reports
    // neither arm, so the issue is assignable again.
    const api = fakeApi([{ number: 547, labels: ['ready', 'agent-task', 'scope:engine'] }]);
    expect((await select(api)).issue?.number).toBe(547);
  });

  it('skips an issue whose pull requests could not be read', async () => {
    const api = fakeApi([
      { number: 547, labels: ['ready', 'agent-task', 'scope:engine'], deliverableUnknown: true },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api)).issue?.number).toBe(548);
  });

  // The requirement in one test: #547 is blocked with PR #566 unmerged, and its
  // whole follow-up batch declares `Blocked by #547`. None of them may run.
  it('assigns nothing when every candidate waits on the unmerged run', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' },
      { number: 549, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #548\n' },
    ]);
    const result = await select(api);
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('no assignable');
  });

  it('assigns the unblocked issue in that batch', async () => {
    const api = fakeApi([
      { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
      { number: 548, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' },
      { number: 550, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\nNone\n' },
    ]);
    expect((await select(api)).issue?.number).toBe(550);
  });

  // At the default limit of one: single flight, whatever the scopes say.
  it('assigns nothing while another issue is in progress', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:engine'] },
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
      { number: 30, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api, 20)).issue?.number).toBe(30);
  });

  // #1090, 16 Sep 2026. The run applied `paused` — the event the chain fires on
  // — and edited its `## Blocked by` section afterwards, so the chain read a
  // body naming only dependencies that had already landed and handed the issue
  // straight back to a new session, 23 seconds after the last one stopped. The
  // refusal is on the number precisely because the body cannot be trusted to
  // have been written yet.
  it('never chains back to the issue whose own run fired it', async () => {
    const api = fakeApi([
      { number: 1090, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], pipelinePr: { number: 1116, merged: false, labels: ['paused'] } },
      { number: 1125, labels: ['ready', 'agent-task', 'scope:engine'] },
    ]);
    expect((await select(api, 1090)).issue?.number).toBe(1125);
  });

  it('leaves the queue idle rather than re-picking the issue that just halted', async () => {
    const api = fakeApi([{ number: 1090, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] }]);
    const result = await select(api, 1090);
    expect(result.issue).toBeNull();
  });

  it('reports an idle queue rather than failing', async () => {
    const result = await select(fakeApi([]));
    expect(result.issue).toBeNull();
    expect(result.reason).toContain('no assignable');
  });

  // An idle queue and an unread one produce the same "nothing assigned", and
  // they are opposite facts. Three dispatches of the trigger on 17 Aug 2026
  // reported the first while every candidate had been skipped on a 503.
  describe('an unread queue is not an idle queue', () => {
    it('names the candidates it could not assess', async () => {
      const result = await select(
        fakeApi([
          { number: 554, labels: ['ready', 'agent-task', 'scope:engine'], deliverableUnknown: true },
          { number: 555, labels: ['ready', 'agent-task', 'scope:engine'], deliverableUnknown: true },
        ])
      );
      expect(result.issue).toBeNull();
      expect(result.unreadable.map((skip: { number: number }) => skip.number)).toEqual([554, 555]);
      expect(result.unreadable[0].reason).toContain('could not be read');
    });

    // An unmet dependency is the queue working, not the queue broken. Reporting
    // it as unreadable would turn every legitimately blocked batch into a red
    // dispatch, and the signal would stop meaning anything.
    it('leaves an ineligible candidate off that list', async () => {
      const result = await select(
        fakeApi([
          { number: 547, labels: ['blocked'], closers: [{ number: 566, merged: false }] },
          { number: 548, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' },
          { number: 549, labels: ['ready', 'agent-task', 'blocked', 'scope:engine'] },
        ])
      );
      expect(result.issue).toBeNull();
      expect(result.unreadable).toEqual([]);
    });

    it('reports an unreadable dependency too', async () => {
      const result = await select(
        fakeApi([{ number: 554, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #553\n' }])
      );
      expect(result.issue).toBeNull();
      expect(result.unreadable[0]).toMatchObject({ number: 554 });
      expect(result.unreadable[0].reason).toContain('#553');
    });

    it('reports nothing unreadable when an issue is assigned', async () => {
      const result = await select(
        fakeApi([
          { number: 554, labels: ['ready', 'agent-task', 'scope:engine'], deliverableUnknown: true },
          { number: 555, labels: ['ready', 'agent-task', 'scope:engine'] },
        ])
      );
      expect(result.issue?.number).toBe(555);
      expect(result.unreadable.map((skip: { number: number }) => skip.number)).toEqual([554]);
    });
  });
});

// A run that stops on a dependency it filed does not need a human, so it does
// not take its issue out of the queue: the issue goes back to `ready` with that
// dependency as its `Blocked by`, and the queue returns to it once the
// dependency lands. What that costs is the open pull request holding the partial
// work — which every other rule here reads as "a run is in flight, keep clear".
// The `paused` label on the PR is what separates a handover from a collision.
// `AGENTIC_MAX_PARALLEL_RUNS` above 1 lets several issues hold `in-progress`
// at once. Two things decide which: how many slots are free, and whether an
// issue's scope labels clash with any run already in flight. The merge gate is
// what makes parallel runs safe; these rules are what keep them from colliding
// often. Everything here fails toward running less at once — never toward
// running two things that claim the same ground.
describe('running several issues at once', () => {
  const selectUpTo = (api: any, maxParallel: number, completedIssue: number | null = null) =>
    rules.selectNextAssignable(api, { completedIssue, maxParallel });
  const numbers = (result: { issues: { number: number }[] }) => result.issues.map((i) => i.number);

  describe('reading the configured limit', () => {
    it.each([
      ['2', 2],
      [' 3 ', 3],
      ['1', 1],
    ])('reads %p as %p', (raw, expected) => {
      expect(rules.maxParallelRuns(raw)).toBe(expected);
    });

    // A limit that does not parse falls back to single flight — the one
    // direction a misconfiguration may not push is towards more at once.
    it.each([undefined, null, '', '0', '-2', 'abc', '2.5', '1e3'])('falls back to 1 on %p', (raw) => {
      expect(rules.maxParallelRuns(raw)).toBe(1);
    });
  });

  describe('what an issue claims', () => {
    it('claims the scopes its labels declare', () => {
      expect(rules.scopeClaim({ labels: ['ready', 'scope:ui', 'scope:console'] })).toEqual({
        exclusive: false,
        scopes: ['ui', 'console'],
        why: null,
      });
    });

    it('claims the whole repository without a scope label', () => {
      const claim = rules.scopeClaim({ labels: ['ready', 'agent-task'] });
      expect(claim.exclusive).toBe(true);
      expect(claim.why).toContain('no `scope:*` label');
    });

    // A typo must not quietly widen what may run side by side.
    it('claims the whole repository for a scope it does not know', () => {
      const claim = rules.scopeClaim({ labels: ['scope:naavmesh'] });
      expect(claim.exclusive).toBe(true);
      expect(claim.why).toContain('scope:naavmesh');
    });

    // A pipeline change rewrites the rules the live runs follow.
    it('runs `scope:pipeline` alone whatever else it declares', () => {
      const claim = rules.scopeClaim({ labels: ['scope:ui', 'scope:pipeline'] });
      expect(claim.exclusive).toBe(true);
      expect(claim.why).toContain('scope:pipeline');
    });

    it('describes every scope within the label description limit', () => {
      for (const [scope, description] of Object.entries(rules.SCOPES as Record<string, string>)) {
        expect(description.length, scope).toBeLessThanOrEqual(100);
        expect(scope).toMatch(/^[a-z]+$/);
      }
      expect([...rules.EXCLUSIVE_SCOPES]).toEqual(['pipeline', 'global']);
    });

    // Runs alone is now something an issue says, not something it forgets to
    // say: an unscoped issue does not meet the Definition of Ready at all.
    // `scope:ui` is the shared base every UI area builds on: it clashes with
    // each of them, while two different UI areas run side by side.
    it('clashes a UI area with `scope:ui` but not with another UI area', () => {
      const claim = (scope: string) => rules.scopeClaim({ labels: [`scope:${scope}`] });
      expect(rules.claimsConflict(claim('panels'), claim('ui'))).toBe(true);
      expect(rules.claimsConflict(claim('ui'), claim('tutorial'))).toBe(true);
      expect(rules.claimsConflict(claim('panels'), claim('panels'))).toBe(true);
      expect(rules.claimsConflict(claim('panels'), claim('tutorial'))).toBe(false);
      expect(rules.claimsConflict(claim('hud'), claim('nav'))).toBe(false);
      for (const [child, parent] of Object.entries(rules.SCOPE_PARENTS as Record<string, string>)) {
        expect(rules.SCOPES, child).toHaveProperty(child);
        expect(rules.SCOPES, parent).toHaveProperty(parent);
      }
    });

    it('clashes a core area with `scope:engine` but not with another core area', () => {
      const claim = (scope: string) => rules.scopeClaim({ labels: [`scope:${scope}`] });
      expect(rules.claimsConflict(claim('crew'), claim('engine'))).toBe(true);
      expect(rules.claimsConflict(claim('engine'), claim('site'))).toBe(true);
      expect(rules.claimsConflict(claim('tasks'), claim('crew'))).toBe(false);
      expect(rules.claimsConflict(claim('movement'), claim('nav'))).toBe(false);
      // A UI area and a core area share no parent.
      expect(rules.claimsConflict(claim('panels'), claim('crew'))).toBe(false);
    });

    it('calls a claim wide when it runs alone or declares a parent scope', () => {
      const wide = (...labels: string[]) => rules.isWideClaim(rules.scopeClaim({ labels }));
      expect(wide('scope:global')).toBe(true);
      expect(wide('scope:pipeline')).toBe(true);
      expect(wide('agent-task')).toBe(true);
      expect(wide('scope:ui')).toBe(true);
      expect(wide('scope:engine', 'scope:world')).toBe(true);
      expect(wide('scope:panels', 'scope:crew', 'scope:world')).toBe(false);
      expect(wide('scope:nav')).toBe(false);
    });

    it('runs `scope:global` alone', () => {
      const claim = rules.scopeClaim({ labels: ['scope:global'] });
      expect(claim.exclusive).toBe(true);
      expect(claim.why).toContain('scope:global');
    });
  });

  // The default is the pipeline as it always ran. Scope labels change nothing
  // until the limit is raised.
  it('stays single flight at the default limit, whatever the scopes say', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    const result = await select(api);
    expect(result.issues).toEqual([]);
    expect(result.reason).toContain('#20');
  });

  it('starts an issue beside a live run in another scope', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    expect(numbers(await selectUpTo(api, 2))).toEqual([30]);
  });

  it('passes over an issue whose scope is in flight and takes the next one that fits', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:ui'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    expect(numbers(await selectUpTo(api, 2))).toEqual([30]);
  });

  // Head-of-line for a wide claim: #25 declares the parent `ui` and waits on
  // the live `ui` run. It holds `ui` — so #28, younger and in a UI area, may
  // not start in front of it — but not its ordinary `nav`, so #30 starts.
  it('lets an older wide issue hold only its parent scopes', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:ui', 'scope:nav'] },
      { number: 28, labels: ['ready', 'agent-task', 'scope:hud'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:economy'] },
    ]);
    expect(numbers(await selectUpTo(api, 4))).toEqual([30, 35]);
  });

  // 5 Oct 2026: #1403 (`console`, `hud`, `engine`) waited on a live core run
  // and held `console` and `hud` with its `engine`, so issues touching only
  // those waited behind a run they had nothing to do with.
  it('leaves a waiting wide issue\'s ordinary scopes free', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:tasks', 'scope:world'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:console', 'scope:hud', 'scope:engine'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:crew'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:hud'] },
      { number: 40, labels: ['ready', 'agent-task', 'scope:console'] },
    ]);
    // #30 waits: `crew` sits under the held `engine`.
    expect(numbers(await selectUpTo(api, 4))).toEqual([35, 40]);
  });

  it('holds everything for a waiting issue that runs alone, and only parents otherwise', () => {
    const held = (...labels: string[]) => rules.heldPart(rules.scopeClaim({ labels }));
    expect(held('scope:pipeline').exclusive).toBe(true);
    expect(held('scope:console', 'scope:hud', 'scope:engine')).toEqual({ exclusive: false, scopes: ['engine'], why: null });
    expect(held('scope:ui', 'scope:nav').scopes).toEqual(['ui']);
  });

  // Only live runs keep code apart. A narrow claim waiting on one holds
  // nothing: on 5 Oct 2026 #1380 waited on live #1379 and its hold on `world`
  // kept #1466, which clashed with nothing live, from starting.
  it('lets a narrow waiting issue hold nothing, so unrelated younger work starts', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:crew', 'scope:panels'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:crew', 'scope:world'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:world'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:panels'] },
    ]);
    // #35 still waits: it clashes with the live run itself.
    expect(numbers(await selectUpTo(api, 4))).toEqual([30]);
  });

  // `scope:engine` is a parent, so an engine issue waiting on a live core area
  // holds every core area until it has run.
  it('lets a waiting parent-scope issue hold its place', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:crew'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:engine'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:tasks'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:world'] },
    ]);
    expect(numbers(await selectUpTo(api, 4))).toEqual([35]);
  });

  // A hold is one level deep. #25 waits on live #20 and holds `engine`; #30
  // waits only on #25's hold, so its `nav` stays free and #35 starts. Chained
  // holds left one session running with four slots on 4 Oct 2026.
  it('lets an issue waiting only on a waiting issue hold nothing', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui', 'scope:economy'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:economy', 'scope:engine'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:engine', 'scope:nav'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    expect(numbers(await selectUpTo(api, 4))).toEqual([35]);
  });

  // Clashing with a waiting issue and with a running one is a clash with a
  // running one: #30 clashes with waiting #25 on `crew` and with live #20 on
  // `world`, so it holds `ui` and #35 waits behind it.
  it('holds a place when any clash is with a running claim', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:world'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:world', 'scope:engine'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:crew', 'scope:world', 'scope:ui'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:hud'] },
    ]);
    const result = await selectUpTo(api, 4);
    expect(result.issues).toEqual([]);
    expect(result.reason).toContain('can start beside');
  });

  // An older unlabelled issue holds everything: the queue drains until it can
  // run alone, rather than letting younger scoped work starve it.
  it('drains the queue for an older issue that runs alone', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:global'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    const result = await selectUpTo(api, 3);
    expect(result.issues).toEqual([]);
    expect(result.reason).toContain('can start beside');
  });

  it('starts nothing beside a live run that claims the whole repository', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    const result = await selectUpTo(api, 3);
    expect(result.issues).toEqual([]);
    expect(result.reason).toContain('#20');
    expect(result.reason).toContain('runs alone');
  });

  it('fills every free slot with issues that do not clash with each other', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'scope:ui'] },
      { number: 21, labels: ['ready', 'agent-task', 'scope:nav'] },
      { number: 22, labels: ['ready', 'agent-task', 'scope:ui'] },
      { number: 23, labels: ['ready', 'agent-task', 'scope:economy'] },
      { number: 24, labels: ['ready', 'agent-task', 'scope:world'] },
    ]);
    expect(numbers(await selectUpTo(api, 3))).toEqual([20, 21, 23]);
  });

  it('starts two UI areas side by side, and holds both back from `scope:ui`', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:panels'] },
      { number: 25, labels: ['ready', 'agent-task', 'scope:ui'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:tutorial'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:hud'] },
    ]);
    // #25 waits on live #20 and holds all of `ui`, so neither UI area starts.
    expect(numbers(await selectUpTo(api, 4))).toEqual([]);
    const withoutBase = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:panels'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:tutorial'] },
      { number: 35, labels: ['ready', 'agent-task', 'scope:hud'] },
    ]);
    expect(numbers(await selectUpTo(withoutBase, 4))).toEqual([30, 35]);
  });

  it('assigns an issue that runs alone, and nothing beside it', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'scope:global'] },
      { number: 21, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    expect(numbers(await selectUpTo(api, 3))).toEqual([20]);
  });

  it('defers when the live runs already fill the limit', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 21, labels: ['in-progress', 'scope:nav'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:economy'] },
    ]);
    const result = await selectUpTo(api, 2);
    expect(result.issues).toEqual([]);
    expect(result.reason).toContain('#20');
    expect(result.reason).toContain('#21');
  });

  it('does not count the run that fired the chain as live', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:ui'] },
      { number: 21, labels: ['in-progress', 'scope:nav'] },
      { number: 30, labels: ['ready', 'agent-task', 'scope:ui'] },
    ]);
    expect(numbers(await selectUpTo(api, 2, 20))).toEqual([30]);
  });

  // Only an issue that could otherwise run holds a place. A paused issue
  // holding its own scope would stop its own blocker from ever starting.
  it('lets an issue waiting on a dependency hold nothing', async () => {
    const api = fakeApi([
      { number: 20, labels: ['in-progress', 'scope:nav'] },
      { number: 25, labels: ['ready', 'agent-task', 'paused', 'scope:ui'], body: '## Blocked by\n\n- #30\n' },
      { number: 30, labels: ['ready', 'agent-task', 'scope:ui'] },
    ]);
    expect(numbers(await selectUpTo(api, 2))).toEqual([30]);
  });

  it('keeps every other rule: a candidate with an open pull request is still skipped', async () => {
    const api = fakeApi([
      { number: 25, labels: ['ready', 'agent-task', 'scope:ui'], pipelinePr: { number: 90, merged: false } },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    expect(numbers(await selectUpTo(api, 2))).toEqual([30]);
  });
});

// `ready` is a promise that the issue is specified well enough to start, and
// with parallel runs that includes saying which areas it will touch. The
// machine-checkable part of the Definition of Ready is enforced where the
// promise is spent: an issue that does not meet it is never assigned, whatever
// its `ready` label says. `agentic-intake.yml` takes the label off such an issue
// with the same verdict; this is the half that holds when intake never ran.
describe('which scopes a live run holds', () => {
  const free = (holders: Record<string, number | null>) =>
    Object.keys(holders).filter((scope) => holders[scope] === null);

  it('frees every scope when nothing is live', () => {
    expect(free(rules.scopeHolders([]))).toEqual(Object.keys(rules.SCOPES));
  });

  it('holds the live scopes and the ones that run alone, and names the holder', () => {
    const holders = rules.scopeHolders([{ number: 1283, labels: ['in-progress', 'scope:nav', 'scope:engine'] }]);
    expect(holders.nav).toBe(1283);
    expect(holders.pipeline).toBe(1283);
    expect(free(holders)).toEqual([
      'economy', 'world', 'ui', 'hud', 'panels', 'workshop', 'scene', 'tutorial', 'screens',
      'renderer', 'console', 'scenarios',
    ]);
  });

  // `engine` is the parent of every simulation-core area, so a live
  // `scope:engine` run holds all of them, and a live area holds `engine`.
  it('holds `scope:engine` while any core area is live, and every core area while `scope:engine` is', () => {
    const area = rules.scopeHolders([{ number: 50, labels: ['in-progress', 'scope:crew'] }]);
    expect(area.crew).toBe(50);
    expect(area.engine).toBe(50);
    expect(area.tasks).toBeNull();
    expect(area.site).toBeNull();
    const base = rules.scopeHolders([{ number: 51, labels: ['in-progress', 'scope:engine'] }]);
    for (const area of ['tasks', 'movement', 'crew', 'site']) expect(base[area], area).toBe(51);
  });

  it('holds `scope:ui` while any UI area is live, and every UI area while `scope:ui` is', () => {
    const area = rules.scopeHolders([{ number: 40, labels: ['in-progress', 'scope:hud'] }]);
    expect(area.hud).toBe(40);
    expect(area.ui).toBe(40);
    expect(area.panels).toBeNull();
    const base = rules.scopeHolders([{ number: 41, labels: ['in-progress', 'scope:ui'] }]);
    const uiAreas = Object.entries(rules.SCOPE_PARENTS as Record<string, string>)
      .filter(([, parent]) => parent === 'ui')
      .map(([child]) => child);
    expect(uiAreas).toHaveLength(6);
    for (const child of uiAreas) expect(base[child], child).toBe(41);
    expect(base.crew).toBeNull();
  });

  it('holds every scope while an exclusive or unscoped run is live', () => {
    expect(free(rules.scopeHolders([{ number: 1230, labels: ['in-progress', 'scope:pipeline'] }]))).toEqual([]);
    expect(free(rules.scopeHolders([{ number: 7, labels: ['in-progress'] }]))).toEqual([]);
  });
});

describe('the Definition of Ready', () => {
  it.each([
    [['agent-task', 'scope:ui'], []],
    [['agent-task', 'scope:ui', 'scope:console', 'ready'], []],
    [['agent-task', 'scope:global'], []],
  ])('is met by %j', (labels, missing) => {
    expect(rules.readinessVerdict({ labels })).toEqual({ ready: true, missing });
  });

  it('names every missing part at once', () => {
    const verdict = rules.readinessVerdict({ labels: ['ready'] });
    expect(verdict.ready).toBe(false);
    expect(verdict.missing).toHaveLength(2);
    expect(verdict.missing[0]).toContain('agent-task');
    expect(verdict.missing[1]).toContain('scope:*');
  });

  // A typo in a scope label must not read as a scope.
  it('is not met by a scope it does not know', () => {
    const verdict = rules.readinessVerdict({ labels: ['agent-task', 'scope:ui', 'scope:naavmesh'] });
    expect(verdict.ready).toBe(false);
    expect(verdict.missing).toEqual(['`scope:naavmesh` is not a known scope']);
  });

  it.each([
    ['no scope label', ['ready', 'agent-task']],
    ['no agent-task label', ['ready', 'scope:ui']],
    ['an unknown scope', ['ready', 'agent-task', 'scope:naavmesh']],
  ])('keeps an issue with %s out of every assignment, and takes the next one', async (_, labels) => {
    const api = fakeApi([
      { number: 20, labels },
      { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
    ]);
    const result = await select(api);
    expect(result.issue?.number).toBe(30);
    // Ineligible, not unreadable: nothing here says the queue went unread.
    expect(result.unreadable).toEqual([]);
  });

  it('says why in the skip reason', () => {
    const verdict = rules.labelVerdict(issue({ number: 20, labels: ['ready', 'agent-task'] }));
    expect(verdict.assignable).toBe(false);
    expect(verdict.reason).toContain('Definition of Ready');
    expect(verdict.unreadable).toBe(false);
  });
});

describe('resuming a paused run', () => {
  const pausedPr = (number: number, head?: string) => ({
    number,
    merged: false,
    labels: ['paused'],
    ...(head ? { head } : {}),
  });

  it('does not refuse an issue whose only open PR is the paused handover', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], pipelinePr: pausedPr(99) },
    ]);
    const { issue } = await select(api);
    expect(issue?.number).toBe(20);
  });

  // The label is not blocking on its own — the dependency is. An issue whose
  // blocker is still open stays out, exactly as it would without the pause.
  it('still holds a paused issue back while its dependency is open', async () => {
    const api = fakeApi([
      { number: 10, labels: ['ready', 'agent-task', 'scope:engine'] },
      {
        number: 20,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        body: '## Blocked by\n- #10\n',
        pipelinePr: pausedPr(99),
      },
    ]);
    const { issue } = await select(api);
    expect(issue?.number).toBe(10);
  });

  it('picks the paused issue up again once its dependency has merged', async () => {
    const api = fakeApi([
      { number: 10, state: 'closed', closers: [{ number: 11, merged: true }] },
      {
        number: 20,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        body: '## Blocked by\n- #10\n',
        pipelinePr: pausedPr(99),
      },
    ]);
    const { issue } = await select(api);
    expect(issue?.number).toBe(20);
  });

  // The carve-out is exactly one label wide. Anything else open against the
  // issue is a live run, and #547's collision reasoning is unchanged.
  it('still refuses an issue whose open PR is not a handover', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'scope:engine'], pipelinePr: { number: 99, merged: false } },
    ]);
    const { issue, reason } = await select(api);
    expect(issue).toBeNull();
    expect(reason).toContain('no assignable ready issue');
  });

  // Fail closed on the mix: a paused handover plus a live PR is still a live
  // run, and resuming into it would collide with the branch that run is on.
  it('refuses when a live PR is open alongside the handover', async () => {
    const api = fakeApi([
      {
        number: 20,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        pipelinePr: pausedPr(99),
        closers: [{ number: 100, merged: false }],
      },
    ]);
    const { issue } = await select(api);
    expect(issue).toBeNull();
  });

  // A degraded read produces no labels. That must read as "not paused" and
  // block, never as a handover to push commits onto.
  it('treats an open PR whose labels could not be read as live, not paused', async () => {
    const api = fakeApi([
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], pipelinePr: { number: 99, merged: false } },
    ]);
    const { issue } = await select(api);
    expect(issue).toBeNull();
  });

  // #730, 25 Aug 2026. Its handover PR #740 also carried `Closes #758` for a
  // defect the same run fixed in passing, so #758's own assignment was answered
  // with #730's handover and told to continue on `pipeline/feature-730-*`. The
  // carve-out has to be this issue's own handover, not any paused PR that
  // happens to close it.
  it("does not exempt an issue for another issue's handover", async () => {
    const api = fakeApi([
      {
        number: 758,
        labels: ['ready', 'agent-task', 'scope:engine'],
        closers: [
          { number: 740, merged: false, labels: ['paused'], head: 'pipeline/feature-730-32642264036' },
        ],
      },
    ]);
    const { issue, reason } = await select(api);
    expect(issue).toBeNull();
    expect(reason).toContain('no assignable ready issue');
  });

  // The other half of the same incident, and the symptom a human sees: the run
  // that took over #730's branch removed `paused` from PR #740 and marked it
  // ready, so #730 dropped out of the queue and every assignment after it took
  // some other issue. The refusal itself is correct — what must not happen is
  // reaching this state, which the test above now prevents.
  it('refuses an issue whose handover has been unpaused by another run', async () => {
    const api = fakeApi([
      {
        number: 730,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        pipelinePr: { number: 740, merged: false, labels: ['enhancement'] },
      },
    ]);
    const { issue } = await select(api);
    expect(issue).toBeNull();
  });

  describe('naming the branch the next run continues', () => {
    it('reports the paused PR and its head', () => {
      const target = rules.resumeTargetFor({
        pipeline: pausedPr(99, 'pipeline/feature-20-123'),
        closers: [],
      });
      expect(target).toEqual({ number: 99, head: 'pipeline/feature-20-123' });
    });

    // A handover is the PR on this issue's own branch, and `deliverableFor`
    // reports that one — and only that one — as `pipeline`. A closer is any PR
    // whose body writes `Closes #N`, which says nothing about its branch, so it
    // can be another issue's handover. #730's was: PR #740 sat on
    // `pipeline/feature-730-32642264036` carrying `Closes #758`, and answering
    // #758's assignment with it sent that run onto #730's branch.
    it('reports nothing for a paused PR that only closes the issue', () => {
      expect(
        rules.resumeTargetFor({
          pipeline: null,
          closers: [pausedPr(740, 'pipeline/feature-730-32642264036')],
        })
      ).toBeNull();
    });

    it('reports nothing when no open PR is paused', () => {
      expect(
        rules.resumeTargetFor({ pipeline: { number: 99, merged: false, labels: [] }, closers: [] })
      ).toBeNull();
    });

    // A merged PR is finished work, not a handover to continue.
    it('reports nothing for a merged PR that still carries the label', () => {
      expect(
        rules.resumeTargetFor({
          pipeline: { number: 99, merged: true, labels: ['paused'] },
          closers: [],
        })
      ).toBeNull();
    });
  });
});

// A `paused` issue stays in the queue on its dependency alone — `graphVerdict`
// already holds it back until that dependency lands. What it cannot see is
// whether the dependency ever *will* land: if it is unassignable for a reason
// the pipeline cannot resolve on its own, the pause is permanent and the queue
// never comes back to the issue. `strandedPauseVerdict` is a diagnostic, not a
// selection rule — nothing in `selectNextAssignable` calls it.
describe('detecting a stranded pause', () => {
  /** Wraps `fakeApi` with call counters, to prove a non-paused issue is never read. */
  const spy = (issues: FakeIssue[]) => {
    const base = fakeApi(issues);
    const calls = { getIssue: 0, declaredBlockedBy: 0 };
    return {
      calls,
      api: {
        ...base,
        async getIssue(n: number) {
          calls.getIssue += 1;
          return base.getIssue(n);
        },
        async declaredBlockedBy(n: number) {
          calls.declaredBlockedBy += 1;
          return base.declaredBlockedBy(n);
        },
      },
    };
  };

  it('is not evaluated on an issue that does not carry `paused`', async () => {
    const { api, calls } = spy([{ number: 20, labels: ['ready', 'agent-task', 'scope:engine'] }]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'scope:engine'] });
    expect(verdict).toBeFalsy();
    expect(calls.getIssue).toBe(0);
    expect(calls.declaredBlockedBy).toBe(0);
  });

  // The false-positive guard: an ordinary pause, still healthily waiting.
  it('is not stranded when the declared dependency is open, ready, and does not cycle back', async () => {
    const api = fakeApi([
      { number: 10, labels: ['ready', 'agent-task', 'scope:engine'] },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(false);
  });

  // The real #1089/#1103 incident, end to end: #1089's pause declared #1103 as
  // its dependency, and #1103's own body cited #1089 back only to explain why
  // it was filed — the exact prose the None-sentinel hardening in
  // `parseDependencies` now reads as declaring nothing. Before that hardening
  // this shape parsed as a mutual cycle and stranded the pause; this is the
  // regression proof that it no longer does.
  it('is not stranded once the None-sentinel hardening resolves the #1089/#1103 mutual-cycle shape', async () => {
    const api = fakeApi([
      {
        number: 1103,
        labels: ['ready', 'agent-task', 'scope:engine'],
        body:
          '## Blocked by\n\nNone — this is standalone debugging work. It is filed as a dependency of #1089 only because the branch is shared.\n',
      },
      {
        number: 1089,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        body: '## Blocked by\n- #1103\n',
      },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 1089, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(false);
    expect(verdict?.blockers).toEqual([]);
  });

  // A paused issue with no declared dependency at all — no relationship, no
  // body section, or an explicit `None` — has nothing to strand on.
  it('is not stranded when there are zero declared dependencies', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '' }]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict).toEqual({ stranded: false, blockers: [] });
  });

  // Distinct from `no-ready-label`: the dependency carries `ready` but a
  // second label (`blocked`, `done`) disqualifies it anyway,
  // per `labelVerdict`.
  it('is stranded when the dependency carries `ready` but is disqualified by another label', async () => {
    const api = fakeApi([
      { number: 10, labels: ['ready', 'agent-task', 'blocked', 'scope:engine'] },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 10, cause: 'ready-but-disqualified' })
    );
  });

  // The dependency itself is a pull request, not an issue — distinct from the
  // `closed-unmerged` case above, which is an issue whose *deliverable* PR is
  // still open. An open PR dependency resolves on its own through the
  // ordinary merge flow, so it is healthy and not a blocker.
  it('is not stranded when the dependency is itself an open, unmerged pull request', async () => {
    const api = fakeApi([
      { number: 10, isPullRequest: true, state: 'open' },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(false);
  });

  it('is stranded when the dependency is itself a closed, unmerged pull request', async () => {
    const api = fakeApi([
      { number: 10, isPullRequest: true, state: 'closed', prMergedAt: null },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 10, cause: 'closed-unmerged' })
    );
  });

  // The #1261/#1262 incident: #1278 was the dependency both pauses waited on,
  // and a live run held it — the assigner had swapped its `ready` for
  // `in-progress`. The sweep read the missing `ready` as `no-ready-label`,
  // marked both pauses `blocked`, and tripped the cascade brake mid-run.
  it('is not stranded when a live run holds the dependency (`in-progress`, no `ready`)', async () => {
    const api = fakeApi([
      { number: 10, labels: ['agent-task', 'in-progress', 'scope:engine'] },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict).toEqual({ stranded: false, blockers: [] });
  });

  it('is stranded when the dependency\'s run died and it was labelled `blocked`', async () => {
    const api = fakeApi([
      { number: 10, labels: ['agent-task', 'in-progress', 'blocked', 'scope:engine'] },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
  });

  it('is stranded when the dependency carries no `ready` label', async () => {
    const api = fakeApi([
      { number: 10, labels: [] },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 10, cause: 'no-ready-label' })
    );
  });

  // A genuine mutual cycle, distinct from #1103's bug (a mention inside a
  // `None` sentinel section, already hardened by the `parseDependencies`
  // test above — that shape now parses to zero dependencies, so it cannot
  // exercise this branch). Here the blocker's own `Blocked by` section
  // plainly declares the paused issue back. `ready` is on the blocker here
  // so this case is isolated from cause 1.
  it('is stranded when the dependency cycles back through its own body', async () => {
    const pausedNum = 1089;
    const blockerNum = 1090;
    const api = fakeApi([
      {
        number: blockerNum,
        labels: ['ready', 'agent-task', 'scope:engine'],
        body: `## Blocked by\n- #${pausedNum}\n`,
      },
      {
        number: pausedNum,
        labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
        body: `## Blocked by\n- #${blockerNum}\n`,
      },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, {
      number: pausedNum,
      labels: ['ready', 'agent-task', 'paused', 'scope:engine'],
    });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: blockerNum, cause: 'cycle' })
    );
  });

  it('is stranded when the dependency is closed with its own pull request unmerged', async () => {
    const api = fakeApi([
      {
        number: 10,
        state: 'closed',
        stateReason: 'completed',
        closers: [{ number: 11, merged: false }],
      },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 10, cause: 'closed-unmerged' })
    );
  });

  it('fails closed when the dependency cannot be read at all', async () => {
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #999\n' }]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 999, cause: 'unreadable' })
    );
  });

  // One level deeper than the test above: the direct dependency (#10) is
  // itself readable, `ready`, and open — it passes the no-ready-label check
  // and reaches `blockerCyclesBackTo` — but #10's own declared dependency
  // (#999) cannot be read, so walking #10's graph can't rule out a cycle back
  // to #20. That has to fail closed the same way an unreadable dependency
  // does, attributed to #10 (the blocker `strandedPauseVerdict` is actually
  // choosing between), not to the unreadable node buried inside its graph.
  it("is stranded when the dependency's own dependency graph hits an unreadable node", async () => {
    const api = fakeApi([
      { number: 10, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n- #999\n' },
      { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
    ]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(
      expect.objectContaining({ number: 10, cause: 'unreadable' })
    );
  });

  it("fails closed when the paused issue's own dependency relationships could not be read", async () => {
    const api = fakeApi([{ number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], relationshipsUnknown: true }]);
    const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
    expect(verdict?.stranded).toBe(true);
    expect(verdict?.blockers).toContainEqual(expect.objectContaining({ cause: 'unreadable' }));
  });

  // Mirrors `blockedByFor`'s own coverage of the union: either source alone
  // must be enough to find, and strand on, an unassignable dependency.
  describe('the dependency source union', () => {
    it('is stranded off a dependency declared only through the GitHub relationship', async () => {
      const api = fakeApi([
        { number: 10, labels: [] },
        { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], blockedBy: [10] },
      ]);
      const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
      expect(verdict?.stranded).toBe(true);
      expect(verdict?.blockers).toContainEqual(expect.objectContaining({ number: 10 }));
    });

    it('is stranded off a dependency declared only through the body section', async () => {
      const api = fakeApi([
        { number: 10, labels: [] },
        { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], body: '## Blocked by\n- #10\n' },
      ]);
      const verdict = await rules.strandedPauseVerdict(api, { number: 20, labels: ['ready', 'agent-task', 'paused', 'scope:engine'] });
      expect(verdict?.stranded).toBe(true);
      expect(verdict?.blockers).toContainEqual(expect.objectContaining({ number: 10 }));
    });
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
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(2);
  });

  // A merged pipeline PR is proof the loop can still finish something, so it
  // resets the count — otherwise the brake would trip on unrelated history.
  it('is reset by a merge', async () => {
    const api = fakeApi([blockedAt(1, lastMergeAt - HOUR), blockedAt(2, lastMergeAt - 2 * HOUR)], {
      lastMergeAt,
    });
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(0);
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
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(1);
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
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(1);
  });

  it('ignores a blocked issue with no labelling event to age', async () => {
    const api = fakeApi([{ number: 1, labels: ['blocked'], blockedAt: null }], { lastMergeAt });
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(0);
  });

  // Both halts count. A pause is the healthier outcome, but a broken `main`
  // produces a queue full of them just as readily — a brake watching only
  // `blocked` would sit open while the other label marched through the backlog.
  it('counts paused runs alongside blocked ones', async () => {
    const api = fakeApi(
      [
        blockedAt(1, lastMergeAt + HOUR),
        { number: 2, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], pausedAt: lastMergeAt + 2 * HOUR },
      ],
      { lastMergeAt }
    );
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(2);
  });

  // One run, one halt. An issue wearing both labels has still only failed once.
  it('counts an issue carrying both labels once', async () => {
    const api = fakeApi(
      [
        {
          number: 1,
          labels: ['blocked', 'paused'],
          blockedAt: lastMergeAt + HOUR,
          pausedAt: lastMergeAt + 2 * HOUR,
        },
      ],
      { lastMergeAt }
    );
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(1);
  });

  // `listForRepo` returns pull requests too, and `paused` is a label this
  // pipeline puts on pull requests by design. The handover PR is not a second
  // halted run — the run that opened it already counted through its own issue.
  it('does not count the paused pull request that carries a handover', async () => {
    const api = fakeApi(
      [
        { number: 1, labels: ['ready', 'agent-task', 'paused', 'scope:engine'], pausedAt: lastMergeAt + HOUR },
        {
          number: 99,
          labels: ['paused'],
          isPullRequest: true,
          pausedAt: lastMergeAt + HOUR,
        },
      ],
      { lastMergeAt }
    );
    expect(await rules.consecutiveHaltedRuns(api, { now })).toBe(1);
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
  /** Retry backoff, without the wall-clock time it would otherwise cost a test. */
  const instant = async () => {};

  const octokit = (overrides: Record<string, unknown> = {}) => ({
    rest: {
      issues: {
        get: async () => ({ data: { number: 1, state: 'open', labels: [], body: '' } }),
        listForRepo: async () => ({ data: [] }),
        listEventsForTimeline: async () => ({ data: [] }),
        ...overrides,
      },
      pulls: { list: async () => ({ data: [] }) },
      // A work branch is `pipeline/feature-<N>-<runId>`, so the refs in that
      // family are enumerated before any of them can be asked about by head.
      git: { listMatchingRefs: async () => ({ data: [] }) },
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
    expect(await client.labelAppliedAt(1, 'blocked')).toBe(Date.parse('2026-08-11T12:00:00Z'));
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
            git: octokit().rest.git,
            pulls: {
              list: async (params: { head: string }) => {
                askedHead = params.head;
                return {
                  data: [
                    {
                      number: 566,
                      state: 'open',
                      merged_at: null,
                      labels: [{ name: 'paused' }],
                      head: { ref: 'pipeline/feature-547-9001' },
                    },
                  ],
                };
              },
            },
          },
          graphql: async (query: string, variables: Record<string, unknown>) => {
            graphqlVariables = variables;
            expect(query).toContain('closedByPullRequestsReferences');
            expect(query).toContain('includeClosedPrs: false');
            // Both are load-bearing rather than decorative: `assessCandidate`
            // reads the labels to tell a paused handover from a run in flight,
            // and the assignment comment names the head so the resuming run
            // continues that branch instead of building one from `main`.
            expect(query).toContain('headRefName');
            expect(query).toContain('labels');
            return {
              repository: {
                issue: {
                  closedByPullRequestsReferences: {
                    nodes: [
                      {
                        number: 570,
                        merged: true,
                        headRefName: 'pipeline/feature-547-8000',
                        labels: { nodes: [{ name: 'enhancement' }] },
                      },
                    ],
                  },
                },
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
        pipeline: {
          number: 566,
          merged: false,
          labels: ['paused'],
          head: 'pipeline/feature-547-9001',
        },
        closers: [
          {
            number: 570,
            merged: true,
            labels: ['enhancement'],
            head: 'pipeline/feature-547-8000',
          },
        ],
        unknown: false,
      });
    });

    // Every run names its branches after itself — `pipeline/feature-<N>-<runId>`
    // — so two runs on one issue can never contend for a name. #554 is the
    // incident: run 166 rebuilt `pipeline/feature-554` while run 160's abandoned
    // branch still held it, and the rescue push was refused `non-fast-forward`
    // with six hours of work on it. The predicate has to see the whole family,
    // or an in-flight run stops being visible to the queue.
    describe('the branch family a run builds under', () => {
      const withRefs = (refs: string[], prs: Record<string, { number: number; state: string; merged_at: string | null }[]>) =>
        createIssueApi(
          {
            rest: {
              issues: octokit().rest.issues,
              git: { listMatchingRefs: async () => ({ data: refs.map((ref) => ({ ref: `refs/heads/${ref}` })) }) },
              pulls: {
                list: async ({ head }: { head: string }) => ({
                  data: prs[head.replace('o:', '')] ?? [],
                }),
              },
            },
            graphql: async () => ({
              repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } },
            }),
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );

      it('finds the pull request on a run-suffixed branch', async () => {
        const client = withRefs(['pipeline/feature-554-32056002769'], {
          'pipeline/feature-554-32056002769': [{ number: 610, state: 'open', merged_at: null }],
        });
        expect((await client.deliverableFor(554)).pipeline).toMatchObject({ number: 610, merged: false });
      });

      // A merged branch is deleted; the pull request is still the deliverable.
      it('still finds a merged pull request whose branch is gone', async () => {
        const client = withRefs([], {
          'pipeline/feature-554': [{ number: 586, state: 'closed', merged_at: '2026-08-15T18:25:39Z' }],
        });
        expect((await client.deliverableFor(554)).pipeline).toMatchObject({ number: 586, merged: true });
      });

      // An open run is what a second assignment must not collide with, so it
      // outranks the merged branch of a run that already finished.
      it('prefers the open pull request over a merged one', async () => {
        const client = withRefs(['pipeline/feature-554-99'], {
          'pipeline/feature-554': [{ number: 586, state: 'closed', merged_at: '2026-08-15T18:25:39Z' }],
          'pipeline/feature-554-99': [{ number: 610, state: 'open', merged_at: null }],
        });
        expect((await client.deliverableFor(554)).pipeline).toMatchObject({ number: 610, merged: false });
      });

      // The dash is the boundary: `pipeline/feature-55-<runId>` belongs to #55,
      // and reading it as #554's would block an issue that has no PR at all.
      it('never reads another issue\'s branch as this one\'s', async () => {
        const client = withRefs(['pipeline/feature-55-32056002769', 'pipeline/feature-5541'], {
          'pipeline/feature-55-32056002769': [{ number: 700, state: 'open', merged_at: null }],
          'pipeline/feature-5541': [{ number: 701, state: 'open', merged_at: null }],
        });
        expect((await client.deliverableFor(554)).pipeline).toBeNull();
      });

      // The ref listing 404s on a prefix that matches nothing. That is an empty
      // family, not an unreadable one — the queue must keep moving.
      it('treats a 404 from the ref listing as an empty family', async () => {
        const client = createIssueApi(
          {
            rest: {
              issues: octokit().rest.issues,
              git: {
                listMatchingRefs: async () => {
                  throw Object.assign(new Error('Not Found'), { status: 404 });
                },
              },
              pulls: { list: async () => ({ data: [] }) },
            },
            graphql: async () => ({
              repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } },
            }),
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );
        expect(await client.deliverableFor(554)).toEqual({
          pipeline: null,
          closers: [],
          unknown: false,
        });
      });
    });

    // A closed-unmerged head-branch PR is a rejected deliverable — reported as
    // no pipeline PR, so the issue becomes assignable again.
    it('ignores a closed-unmerged pipeline pull request', async () => {
      const client = createIssueApi(
        {
          rest: {
            issues: octokit().rest.issues,
            git: octokit().rest.git,
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

    // Fail closed on a read error that no retry and no fallback clears: a 500
    // is not an empty list.
    it('reports unknown when the pipeline-branch read fails', async () => {
      const restFails = createIssueApi(
        {
          rest: {
            issues: octokit().rest.issues,
            git: octokit().rest.git,
            pulls: { list: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } },
          },
          graphql: async () => ({ repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } } }),
        },
        { owner: 'o', repo: 'r', sleep: instant }
      );
      expect((await restFails.deliverableFor(1)).unknown).toBe(true);
    });

    // The incident of 17 Aug 2026: `agentic-trigger.yml` was dispatched three
    // times, and each run skipped every `ready` issue with "deliverable PRs
    // could not be read (503)" — the GraphQL field below answering 503 for one
    // candidate after another. Issue #554 never got its session, and the runs
    // reported success. Two properties keep that from parking the queue again:
    // a transient failure is asked again, and one that persists falls back to
    // the REST timeline rather than taking the whole queue down with it.
    describe('when the closing-PR read is degraded', () => {
      /** A read that fails `failures` times with `status`, then succeeds. */
      const flaky = (failures: number, status: number, value: unknown) => {
        let seen = 0;
        return async () => {
          if (seen++ < failures) throw Object.assign(new Error('unavailable'), { status });
          return value;
        };
      };

      const nodes = (list: { number: number; merged: boolean }[]) => ({
        repository: { issue: { closedByPullRequestsReferences: { nodes: list } } },
      });

      it('asks again after a 503 rather than skipping the issue', async () => {
        const log: string[] = [];
        const client = createIssueApi(
          {
            rest: {
            issues: octokit().rest.issues,
            git: octokit().rest.git,
            pulls: { list: async () => ({ data: [] }) },
          },
            graphql: flaky(2, 503, nodes([{ number: 570, merged: true }])),
          },
          { owner: 'o', repo: 'r', sleep: instant, log: (m: string) => log.push(m) }
        );
        expect(await client.deliverableFor(554)).toEqual({
          pipeline: null,
          closers: [{ number: 570, merged: true, labels: [], head: null }],
          unknown: false,
        });
        expect(log.join('\n')).toContain('asking again');
      });

      // A 404 is an answer, not an outage — retrying it only burns the queue's time.
      it('does not ask again on a status that is an answer', async () => {
        let calls = 0;
        const client = createIssueApi(
          {
            rest: {
            issues: octokit().rest.issues,
            git: octokit().rest.git,
            pulls: { list: async () => ({ data: [] }) },
          },
            graphql: async () => {
              calls += 1;
              throw Object.assign(new Error('Not Found'), { status: 404 });
            },
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );
        await client.deliverableFor(554);
        expect(calls).toBe(1);
      });

      /**
       * The timeline the fallback reads: a PR whose body closes this issue, a PR
       * that only mentions it, and a closed-unmerged PR that closes it.
       */
      const timelineWith = (list: {
        number: number;
        state: string;
        merged_at: string | null;
        body: string;
      }[]) => ({
        listEventsForTimeline: async () => ({
          data: list.map((pr) => ({
            event: 'cross-referenced',
            source: {
              issue: {
                number: pr.number,
                state: pr.state,
                body: pr.body,
                pull_request: { merged_at: pr.merged_at },
              },
            },
          })),
        }),
      });

      it('reads the closing pull requests off the timeline when GraphQL stays down', async () => {
        const client = createIssueApi(
          {
            rest: {
              git: octokit().rest.git,
              issues: {
                ...octokit().rest.issues,
                ...timelineWith([
                  { number: 610, state: 'open', merged_at: null, body: 'Closes #554\n\nwork' },
                  { number: 611, state: 'open', merged_at: null, body: 'see #554 for context' },
                  { number: 603, state: 'closed', merged_at: null, body: 'Closes #554' },
                ]),
              },
              pulls: { list: async () => ({ data: [] }) },
            },
            graphql: async () => {
              throw Object.assign(new Error('unavailable'), { status: 503 });
            },
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );
        // #610 closes it and is open; #611 only mentions it (#568's predicate);
        // #603 closes it but was closed unmerged — `includeClosedPrs: false`.
        expect(await client.deliverableFor(554)).toEqual({
          pipeline: null,
          closers: [{ number: 610, merged: false, labels: [], head: null }],
          unknown: false,
        });
      });

      it('reports an empty timeline as no closer, so the queue keeps moving', async () => {
        const client = createIssueApi(
          {
            rest: {
            issues: octokit().rest.issues,
            git: octokit().rest.git,
            pulls: { list: async () => ({ data: [] }) },
          },
            graphql: async () => {
              throw Object.assign(new Error('unavailable'), { status: 503 });
            },
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );
        expect(await client.deliverableFor(554)).toEqual({
          pipeline: null,
          closers: [],
          unknown: false,
        });
      });

      // Both paths down is the one case that still blocks: nothing was read.
      it('reports unknown when the fallback cannot be read either', async () => {
        const client = createIssueApi(
          {
            rest: {
              git: octokit().rest.git,
              issues: {
                ...octokit().rest.issues,
                listEventsForTimeline: async () => {
                  throw Object.assign(new Error('unavailable'), { status: 503 });
                },
              },
              pulls: { list: async () => ({ data: [] }) },
            },
            graphql: async () => {
              throw Object.assign(new Error('unavailable'), { status: 503 });
            },
          },
          { owner: 'o', repo: 'r', sleep: instant }
        );
        expect((await client.deliverableFor(554)).unknown).toBe(true);
      });
    });
  });

  it('reads the latest merge of a pipeline branch', async () => {
    const client = createIssueApi(
      {
        rest: {
          issues: octokit().rest.issues,
          git: octokit().rest.git,
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
      await client.labelAppliedAt(1, 'blocked');
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
      expect(await client.labelAppliedAt(1, 'blocked', now)).toBe(now);
    });
  });

  // `run-liveness.cjs` reasons about which of these, if any, is genuinely this
  // issue's own assignment comment — see issue #1136. This accessor itself
  // stays generic: every comment, unfiltered, `user` included so the caller
  // can tell a genuine pipeline comment from a spoofed one.
  describe('assignmentCommentsFor', () => {
    it('reads every page of comments and reports the author of each', async () => {
      const pages: Record<number, { data: unknown[] }> = {
        1: {
          data: Array.from({ length: 100 }, (_, i) => ({
            body: `filler ${i}`,
            created_at: '2026-08-01T00:00:00Z',
            user: { login: 'someone', type: 'User' },
          })),
        },
        2: {
          data: [
            {
              body: '@claude — autonomous pipeline assignment for issue #1 (ready).',
              created_at: '2026-08-02T00:00:00Z',
              user: { login: 'agentic-pipeline-bot', type: 'User' },
            },
          ],
        },
      };
      const client = api({
        listComments: async ({ page }: { page: number }) => pages[page] ?? { data: [] },
      });
      const result = await client.assignmentCommentsFor(1);
      expect(result.unknown).toBe(false);
      expect(result.comments).toHaveLength(101);
      expect(result.comments[100]).toEqual({
        body: '@claude — autonomous pipeline assignment for issue #1 (ready).',
        created_at: '2026-08-02T00:00:00Z',
        user: { login: 'agentic-pipeline-bot', type: 'User' },
      });
    });

    it('reports null user rather than guessing one when a comment carries none', async () => {
      const client = api({
        listComments: async () => ({
          data: [{ body: 'no user on this payload', created_at: '2026-08-01T00:00:00Z' }],
        }),
      });
      const result = await client.assignmentCommentsFor(1);
      expect(result.comments[0].user).toBeNull();
    });

    // Fail closed: a read that could not complete must never read as "this
    // issue has no comments" — that is indistinguishable from a genuinely
    // silent issue to every caller downstream.
    it('reports unknown, not empty, when the read fails', async () => {
      const client = createIssueApi(
        {
          rest: {
            issues: {
              ...octokit().rest.issues,
              listComments: async () => {
                throw Object.assign(new Error('Server Error'), { status: 500 });
              },
            },
            git: octokit().rest.git,
            pulls: octokit().rest.pulls,
          },
          graphql: octokit().graphql,
        },
        { owner: 'o', repo: 'r', sleep: instant }
      );
      const result = await client.assignmentCommentsFor(1);
      expect(result).toEqual({ comments: [], unknown: true });
    });

    it('asks again on a transient failure before succeeding', async () => {
      let attempts = 0;
      const client = createIssueApi(
        {
          rest: {
            issues: {
              ...octokit().rest.issues,
              listComments: async () => {
                attempts += 1;
                if (attempts < 2) {
                  throw Object.assign(new Error('Bad Gateway'), { status: 502 });
                }
                return { data: [{ body: 'ok', created_at: '2026-08-01T00:00:00Z', user: null }] };
              },
            },
            git: octokit().rest.git,
            pulls: octokit().rest.pulls,
          },
          graphql: octokit().graphql,
        },
        { owner: 'o', repo: 'r', sleep: instant }
      );
      const result = await client.assignmentCommentsFor(1);
      expect(result.unknown).toBe(false);
      expect(attempts).toBe(2);
    });

    it('caches the read — one call however many rules ask about the same issue', async () => {
      let calls = 0;
      const client = api({
        listComments: async () => {
          calls += 1;
          return { data: [] };
        },
      });
      await client.assignmentCommentsFor(1);
      await client.assignmentCommentsFor(1);
      expect(calls).toBe(1);
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
    /** Issues whose deliverable-PR reads all fail — GraphQL and the fallback. */
    unreadable?: number[];
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
          listEventsForTimeline: async ({ issue_number }: { issue_number: number }) => {
            // 403 rather than 503: an answer, so the retry loop does not spend
            // its backoff on a test that is about the verdict, not the retry.
            if (scenario.unreadable?.includes(issue_number)) {
              throw Object.assign(new Error('unavailable'), { status: 403 });
            }
            return { data: timelineOf(issue_number) };
          },
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
        git: {
          // The branch family for an issue: `pipeline/feature-<N>` from before
          // the convention, `pipeline/feature-<N>-<runId>` since.
          listMatchingRefs: async ({ ref }: { ref: string }) => {
            const match = /heads\/pipeline\/feature-(\d+)$/.exec(ref);
            const found = match ? state.get(parseInt(match[1]!, 10)) : undefined;
            const branch = found?.pipelineBranch;
            return { data: branch ? [{ ref: `refs/heads/${branch}` }] : [] };
          },
        },
        pulls: {
          list: async (params: { head?: string }) => {
            if (params.head) {
              const match = /pipeline\/feature-(\d+)(?:-[A-Za-z0-9._-]+)?$/.exec(params.head);
              const found = match ? state.get(parseInt(match[1]!, 10)) : undefined;
              const onThisBranch =
                !found?.pipelineBranch || params.head.endsWith(`:${found.pipelineBranch}`);
              const pr = onThisBranch ? found?.pipelinePr : null;
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
        if (scenario.unreadable?.includes(params.number)) {
          throw Object.assign(new Error('unavailable'), { status: 403 });
        }
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
      MAX_PARALLEL: '',
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
    const result = await run({ issues: [{ number: 30, labels: ['ready', 'agent-task', 'scope:engine'] }, { number: 20, labels: ['ready', 'agent-task', 'scope:engine'] }] });
    expect(result.outputs.issues).toBe('20');
    expect(result.labelled).toEqual([{ issue: 20, labels: ['in-progress'] }]);
    // `paused` comes off alongside `ready`: the issue has just been picked up,
    // so a run no longer stopped there. Removing a label that is not present is a
    // no-op, so this happens on every assignment rather than only a resumed one.
    expect(result.unlabelled).toEqual([
      { issue: 20, label: 'ready' },
      { issue: 20, label: 'paused' },
    ]);
    expect(result.comments[0]!.body).toContain('@claude');
    expect(result.comments[0]!.body).toContain('issue #20');
  });

  // Every free slot on one call, each with its own assignment comment — each
  // comment is the trigger for its own session.
  it('assigns every issue that fits when the limit allows several', async () => {
    const result = await run({
      issues: [
        { number: 20, labels: ['in-progress', 'scope:ui'] },
        { number: 25, labels: ['ready', 'agent-task', 'scope:ui'] },
        { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
        { number: 35, labels: ['ready', 'agent-task', 'scope:economy'] },
      ],
      env: { MAX_PARALLEL: '3' },
    });
    expect(result.failed).toBeNull();
    expect(result.outputs.issues).toBe('30 35');
    expect(result.labelled).toEqual([
      { issue: 30, labels: ['in-progress'] },
      { issue: 35, labels: ['in-progress'] },
    ]);
    expect(result.comments.map((comment) => comment.issue)).toEqual([30, 35]);
    expect(result.comments[1]!.body).toContain('autonomous pipeline assignment for issue #35');
  });

  it('assigns one issue when the limit is unset, however many would fit', async () => {
    const result = await run({
      issues: [
        { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
        { number: 35, labels: ['ready', 'agent-task', 'scope:economy'] },
      ],
    });
    expect(result.outputs.issues).toBe('30');
    expect(result.comments).toHaveLength(1);
  });

  // The Definition of Done for a deliverable that was not a diff: the run
  // closed its issue as completed, and the close chain makes sure it reads
  // `done` with nothing left claiming it is queued, halted or waiting.
  it('leaves an issue a run closed as completed meeting the Definition of Done', async () => {
    const result = await run({
      issues: [
        { number: 900, state: 'closed', stateReason: 'completed', labels: ['agent-task', 'scope:ui', 'in-progress', 'ready', 'paused'] },
      ],
      events: { 900: [{ label: 'in-progress', at: Date.now() - 60_000 }] },
      env: { ASSIGN_GUARD: 'closed_without_pr', COMPLETED_ISSUE: '900' },
    });
    expect(result.failed).toBeNull();
    expect(result.labelled).toContainEqual({ issue: 900, labels: ['done'] });
    const removed = result.unlabelled.filter((u) => u.issue === 900).map((u) => u.label);
    expect(removed).toEqual(expect.arrayContaining(['in-progress', 'ready', 'paused']));
  });

  it('does not call an issue closed as not planned done', async () => {
    const result = await run({
      issues: [{ number: 901, state: 'closed', stateReason: 'not_planned', labels: ['agent-task', 'scope:ui', 'in-progress'] }],
      events: { 901: [{ label: 'in-progress', at: Date.now() - 60_000 }] },
      env: { ASSIGN_GUARD: 'closed_without_pr', COMPLETED_ISSUE: '901' },
    });
    expect(result.labelled.filter((l) => l.issue === 901)).toEqual([]);
  });

  // 27 Sep 2026: PR #1251 closed #1200 and #1252. The merge chain settled the
  // first; GitHub closed the second, and its close chain deferred to "the merge
  // event carries the chain" — leaving #1252 closed and still `in-progress`.
  it('settles an issue a merged pull request closed, then leaves the chain to the merge', async () => {
    const result = await run({
      issues: [
        {
          number: 1252,
          state: 'closed',
          stateReason: 'completed',
          labels: ['agent-task', 'scope:scenarios', 'in-progress'],
          closers: [{ number: 1251, merged: true }],
        },
        { number: 30, labels: ['ready', 'agent-task', 'scope:nav'] },
      ],
      events: { 1252: [{ label: 'in-progress', at: Date.now() - 60_000 }] },
      env: { ASSIGN_GUARD: 'closed_without_pr', COMPLETED_ISSUE: '1252' },
    });
    expect(result.failed).toBeNull();
    expect(result.labelled).toContainEqual({ issue: 1252, labels: ['done'] });
    expect(result.unlabelled).toContainEqual({ issue: 1252, label: 'in-progress' });
    // The merge event assigns; this path must not assign a second time.
    expect(result.outputs.issues ?? '').toBe('');
    expect(result.comments).toHaveLength(0);
  });

  it('leaves an issue whose pull request is still open as it is', async () => {
    const result = await run({
      issues: [
        {
          number: 1259,
          state: 'closed',
          stateReason: 'completed',
          labels: ['agent-task', 'scope:engine', 'in-progress'],
          closers: [{ number: 1260, merged: false }],
        },
      ],
      events: { 1259: [{ label: 'in-progress', at: Date.now() - 60_000 }] },
      env: { ASSIGN_GUARD: 'closed_without_pr', COMPLETED_ISSUE: '1259' },
    });
    expect(result.failed).toBeNull();
    expect(result.labelled.filter((l) => l.issue === 1259)).toEqual([]);
    expect(result.unlabelled.filter((u) => u.issue === 1259)).toEqual([]);
  });

  // 17 Aug 2026: every candidate skipped on a 503, three dispatches in a row,
  // each ending green on "Nothing assigned — see the step above for the reason".
  // The Actions list showed three successes and issue #554 never got a session.
  it('fails the step when the queue could not be read', async () => {
    const result = await run({
      issues: [
        { number: 554, labels: ['ready', 'agent-task', 'scope:engine'] },
        { number: 555, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      unreadable: [554, 555],
    });
    expect(result.outputs.issues).toBe('');
    expect(result.failed).toContain('#554');
    expect(result.failed).toContain('could not be assessed');
  });

  // The other half of the same rule: a queue that was read and holds nothing
  // eligible is the normal resting state, and must stay a green no-op.
  it('stays green on a queue that is genuinely idle', async () => {
    const result = await run({ issues: [{ number: 554, labels: ['ready', 'agent-task', 'blocked', 'scope:engine'] }] });
    expect(result.outputs.issues).toBe('');
    expect(result.failed).toBeNull();
    expect(result.log.join('\n')).toContain('Nothing assigned');
  });

  // The state #554 was left in twice over: a run's branch is its own, so an open
  // PR on `pipeline/feature-<N>-<runId>` is exactly as much a reason not to
  // assign as one on the bare name ever was.
  it('skips an issue whose run-suffixed pull request is open', async () => {
    const result = await run({
      issues: [
        {
          number: 554,
          labels: ['ready', 'agent-task', 'scope:engine'],
          pipelinePr: { number: 610, merged: false },
          pipelineBranch: 'pipeline/feature-554-32056002769',
        },
        { number: 555, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
    });
    expect(result.outputs.issues).toBe('555');
    expect(result.log.join('\n')).toContain('#610');
  });

  // One unreadable candidate is not a reason to park a queue that still has an
  // assignable issue in it — the run assigns, and says nothing failed.
  it('assigns past a candidate it could not read', async () => {
    const result = await run({
      issues: [
        { number: 554, labels: ['ready', 'agent-task', 'scope:engine'] },
        { number: 555, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      unreadable: [554],
    });
    expect(result.outputs.issues).toBe('555');
    expect(result.failed).toBeNull();
  });

  it('fails loudly on an unrecognised agent rather than picking one', async () => {
    const result = await run({ issues: [], env: { AGENTIC_AGENT: 'copilot' } });
    expect(result.failed).toContain('AGENTIC_AGENT');
    expect(result.outputs.issues).toBe('');
  });

  // The whole point of the change: a run that ends `blocked` releases the queue
  // instead of parking it until a human dispatches the trigger.
  it('chains to the next issue when a run ends blocked', async () => {
    const result = await run({
      issues: [
        { number: 547, labels: ['blocked', 'in-progress'], pipelinePr: { number: 566, merged: false } },
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: blockedRun(547, NOW - 60_000),
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issues).toBe('550');
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
        { number: 548, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #547\n' },
        { number: 549, labels: ['ready', 'agent-task', 'scope:engine'], body: '## Blocked by\n\n- #548\n' },
      ],
      events: blockedRun(547, NOW - 60_000),
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issues).toBe('');
    expect(result.labelled).toEqual([]);
    expect(result.log.join('\n')).toContain('#548');
  });

  // A human labelling a backlog issue `blocked` is filing a note, not ending a
  // run. Without this the label alone would start a session.
  it('starts nothing from an issue no run ever held', async () => {
    const result = await run({
      issues: [
        { number: 900, labels: ['blocked'] },
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: { 900: [{ label: 'blocked', at: NOW }] },
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '900' },
    });
    expect(result.outputs.issues).toBe('');
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
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: {
        ...blockedRun(541, NOW - 3 * 60_000),
        ...blockedRun(543, NOW - 2 * 60_000),
        ...blockedRun(547, NOW - 60_000),
      },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-540' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issues).toBe('');
    expect(result.outputs.halted).toBe('true');
    expect(result.comments.at(-1)?.body).toContain('Pipeline halted');
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
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
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
    expect(first.comments[0]!.body).toContain(marker);

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
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: {
        ...blockedRun(541, NOW - 5 * 3_600_000),
        ...blockedRun(543, NOW - 4 * 3_600_000),
        ...blockedRun(547, NOW - 60_000),
      },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-546' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issues).toBe('550');
    expect(result.outputs.halted).toBe('false');
  });

  it('honours a configured cascade limit', async () => {
    const scenario: Scenario = {
      issues: [
        { number: 543, labels: ['blocked'] },
        { number: 547, labels: ['blocked'] },
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: { ...blockedRun(543, NOW - 2 * 60_000), ...blockedRun(547, NOW - 60_000) },
      mergedPipelinePrs: [{ merged_at: new Date(NOW - 3_600_000).toISOString(), head: { ref: 'pipeline/feature-540' } }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547', BLOCKED_CHAIN_LIMIT: '2' },
    };
    expect((await run(scenario)).outputs.halted).toBe('true');

    scenario.env!.BLOCKED_CHAIN_LIMIT = '4';
    expect((await run(scenario)).outputs.issues).toBe('550');
  });

  // Reading an unknown state as "safe to chain" is the one thing this step must
  // never do, so an unreadable issue fails the job instead.
  it('fails rather than chaining from an issue it cannot read', async () => {
    const result = await run({
      issues: [{ number: 550, labels: ['ready', 'agent-task', 'scope:engine'] }],
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '999' },
    });
    expect(result.failed).toContain('#999');
    expect(result.outputs.issues).toBe('');
  });

  it('stops when the blocked label was already removed', async () => {
    const result = await run({
      issues: [
        { number: 547, labels: [] },
        { number: 550, labels: ['ready', 'agent-task', 'scope:engine'] },
      ],
      events: blockedRun(547, NOW - 60_000),
      env: { ASSIGN_GUARD: 'after_blocked_run', COMPLETED_ISSUE: '547' },
    });
    expect(result.outputs.issues).toBe('');
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
