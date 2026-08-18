'use strict';

/**
 * Who may be assigned next, and whether the queue may move at all.
 *
 * This module is the single authority on both questions. It used to be inline
 * script inside `.github/actions/agentic-assign/action.yml`, where the only way
 * to test it was to lift a function out of the YAML with `new Function` and hope
 * the extraction still matched what shipped. The rules below decide whether an
 * autonomous run — one no human is watching — starts on a task it cannot
 * finish, so they are ordinary CommonJS, `require`d by the action and unit
 * tested directly. `.cjs` because `actions/github-script` runs in a CommonJS
 * context and cannot `require` an ES module.
 *
 * Every rule fails closed. A fact the module cannot establish — an issue it
 * cannot read, a dependency graph larger than it will walk — is treated as
 * blocking, never as permission. An idle queue is recoverable by dispatching
 * the trigger; a run started on a task whose ground has not landed yet is not.
 */

/** Lifecycle labels. The loop's state machine, `agentic-autonomous-pipeline`. */
const READY = 'ready';
const IN_PROGRESS = 'in-progress';
const BLOCKED = 'blocked';
const DONE = 'done';

/**
 * Dependency graph nodes walked before the module gives up. A real chain is two
 * or three deep; anything past this is a malformed body or a cross-referencing
 * accident, and an unwalked graph is an unverified one.
 */
const MAX_DEPENDENCY_NODES = 40;

/** Consecutive blocked runs, since the last pipeline merge, that stop the chain. */
const DEFAULT_BLOCKED_CHAIN_LIMIT = 3;

/**
 * How far back the cascade brake counts when the repository holds no merged
 * pipeline PR to count from. Without it a repository that has never merged one
 * would count every `blocked` issue it has ever had and refuse to chain at all.
 */
const BLOCKED_CHAIN_FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issue numbers an issue's *body* declares it blocked by.
 *
 * The secondary source. GitHub's own "Blocked by" relationships are the
 * authority — a relationship is a declaration, where a body reference is only a
 * mention — but every issue written before those existed carries its
 * dependencies here and nowhere else, so the section still counts. See
 * `blockedByFor` for how the two combine.
 *
 * Being a mention is exactly the risk, so the section is delimited strictly.
 * An opener is a heading (`## Blocked by`), a bold line (`**Blocked by**`), or a
 * line that *starts* with the phrase (`Depends on: #12`) — never a phrase that
 * merely appears in a sentence. The section ends at the next heading or bold
 * line. A `## Context` paragraph citing #55 as background therefore declares
 * nothing, which is the common case and the one that must not block.
 *
 * @param {string | null | undefined} body
 * @returns {number[]}
 */
function parseDependencies(body) {
  const deps = new Set();
  let inSection = false;

  const OPENS = /^\s*(?:#{1,6}\s*|\*\*)?(?:blocked\s+by|depends?\s+on|dependencies)\b/i;
  const NEXT_SECTION = /^\s*(?:#{1,6}\s+\S|\*\*\S)/;

  for (const line of (body || '').split('\n')) {
    if (OPENS.test(line)) {
      inSection = true;
    } else if (inSection && NEXT_SECTION.test(line)) {
      inSection = false; // the next section starts; the list is over
      continue;
    } else if (!inSection) {
      continue;
    }

    for (const ref of line.matchAll(/#(\d+)/g)) {
      deps.add(parseInt(ref[1], 10));
    }
  }

  return [...deps];
}

/**
 * Every issue a given issue is blocked by, from both sources at once.
 *
 * A union, not a choice. Dropping the body section the moment relationships
 * exist would make every issue written before them instantly assignable — a
 * regression in the exact property the relationships are being adopted for — and
 * dropping the relationships would ignore the authoritative source. An issue is
 * blocked by the union, and stays blocked until every member of it has landed.
 *
 * `unknown` means the relationship call failed for a reason other than the
 * feature being absent. The caller blocks on it: a permission slip or a 500
 * must never read as "this issue has no dependencies".
 *
 * @param {IssueApi} api
 * @param {{number: number, body?: string|null}} issue
 * @returns {Promise<{numbers: number[], unknown: boolean}>}
 */
async function blockedByFor(api, issue) {
  const declared = api.declaredBlockedBy
    ? await api.declaredBlockedBy(issue.number)
    : { numbers: [], available: false, unknown: false };

  const union = new Set([...declared.numbers, ...parseDependencies(issue.body)]);
  union.delete(issue.number);
  return { numbers: [...union], unknown: Boolean(declared.unknown) };
}

/**
 * A refusal. `unreadable` separates the two kinds of them, which look identical
 * in a job log and are opposite facts: "this issue is not eligible" is the
 * queue working, and "this issue could not be assessed" is the queue broken.
 * Callers report the second one loudly — on 17 Aug 2026 every candidate was
 * skipped on a 503 and three dispatches in a row ended green with "Nothing
 * assigned", so #554 waited on a success that had never happened.
 *
 * @returns {{assignable: false, reason: string, unreadable: boolean}}
 */
const no = (reason, unreadable = false) => ({ assignable: false, reason, unreadable });
/** @returns {{assignable: true, reason: string, unreadable: false}} */
const yes = () => ({ assignable: true, reason: 'no blocking condition found', unreadable: false });

/**
 * Conditions readable off the candidate itself, before any dependency is fetched.
 *
 * @param {{number: number, state: string, labels: string[], isPullRequest?: boolean}} issue
 */
function labelVerdict(issue) {
  const labels = new Set(issue.labels || []);

  if (issue.isPullRequest) {
    return no('it is a pull request, not an issue');
  }
  if (issue.state !== 'open') {
    return no(`it is ${issue.state}`);
  }
  if (labels.has(BLOCKED)) {
    return no('it is labelled `blocked`');
  }
  if (labels.has(IN_PROGRESS)) {
    return no('it is already labelled `in-progress`');
  }
  // Contradictory rather than impossible: a run releases a non-PR deliverable by
  // closing the issue and labelling it `done`, and a human reopening it without
  // dropping `done` leaves both labels on. Assigning would re-do finished work.
  if (labels.has(DONE)) {
    return no('it is labelled `done`, which contradicts `ready`');
  }
  return yes();
}

/**
 * Whether one dependency has actually landed.
 *
 * "Closed" is not the test. The pipeline's own deliverable is a merged pull
 * request, and the three ways an issue can be closed without one having merged
 * are each a way for a run to start on ground that is not there: closed as not
 * planned, closed by hand while its PR is still open, or named directly as a
 * pull request that has not merged. Issue #547 is the case that motivated this
 * — labelled `blocked` with PR #566 open and unmerged, holding work every later
 * issue in its batch builds on.
 *
 * @param {{number: number, state: string, stateReason?: string|null, isPullRequest?: boolean, prMergedAt?: string|null, labels?: string[]}} dep
 * @param {{pipeline: {number: number, merged: boolean}|null, closers: {number: number, merged: boolean}[], unknown: boolean}|null} deliverable
 *   The dep's deliverable pull requests, from `deliverableFor`. Only consulted
 *   when the dep is closed — an open dep blocks on its state alone — so callers
 *   may pass null for open deps and skip the read.
 */
function dependencyVerdict(dep, deliverable) {
  if (dep.isPullRequest) {
    return dep.prMergedAt
      ? yes()
      : no(`dependency #${dep.number} is a pull request that has not merged`);
  }

  if (dep.state !== 'closed') {
    const labels = new Set(dep.labels || []);
    const why = labels.has(BLOCKED)
      ? 'still open and itself labelled `blocked`'
      : labels.has(IN_PROGRESS)
        ? 'still open with a run on it'
        : 'still open';
    return no(`dependency #${dep.number} is ${why}`);
  }

  if (dep.stateReason === 'not_planned') {
    return no(`dependency #${dep.number} was closed as not planned, so its work never landed`);
  }

  // The dep is closed; what is left to check is whether its code landed. Only
  // deliverable pull requests count — a PR whose head is the dep's own
  // `pipeline/feature-<N>-<runId>` branch, or one GitHub records as closing it. A
  // timeline mention counts for nothing: any PR that writes "#N" in prose
  // raises one, and a docs PR citing a closed dep must not block everything
  // built on it (#568's predicate, applied to the shared rules).
  if (!deliverable || deliverable.unknown) {
    return no(
      `dependency #${dep.number}'s pull requests could not be read, so an unmerged one cannot be ruled out`,
      true
    );
  }
  if (deliverable.pipeline && !deliverable.pipeline.merged) {
    return no(
      `dependency #${dep.number} is closed but its pull request #${deliverable.pipeline.number} is still open`
    );
  }
  const openCloser = deliverable.closers.find((pr) => !pr.merged);
  if (openCloser) {
    return no(
      `dependency #${dep.number} is closed but its pull request #${openCloser.number} is still open`
    );
  }

  return yes();
}

/**
 * Walks the whole declared dependency graph, not just the first level.
 *
 * A closed dependency whose own dependency is open is a contradictory state
 * rather than an impossible one — a human closing an issue by hand produces it —
 * and stopping at depth one would read that graph as satisfied. Cycles are
 * survived by the visited set rather than reported: a cycle among *satisfied*
 * dependencies blocks nothing, and an unsatisfied one is caught on its own merit.
 *
 * @param {IssueApi} api
 * @param {{number: number, body?: string|null}} root
 */
async function graphVerdict(api, root) {
  const seen = new Set([root.number]);
  const rootDeps = await blockedByFor(api, root);
  if (rootDeps.unknown) {
    return no(
      'its `Blocked by` relationships could not be read, so no dependency can be ruled out',
      true
    );
  }

  const queue = [...rootDeps.numbers];
  let examined = 0;

  while (queue.length > 0) {
    const number = queue.shift();
    if (seen.has(number)) continue;
    seen.add(number);

    examined += 1;
    if (examined > MAX_DEPENDENCY_NODES) {
      return no(
        `its dependency graph exceeds ${MAX_DEPENDENCY_NODES} issues, which is not a graph this step will vouch for`
      );
    }

    const dep = await api.getIssue(number);
    if (!dep) {
      // Previously a `core.warning` and then ignored, which let a typo in a
      // `Blocked by` line read as "no dependency" and start the run anyway.
      return no(
        `dependency #${number} could not be read; a dependency that cannot be verified counts as unmet`,
        true
      );
    }

    const deliverable =
      !dep.isPullRequest && dep.state === 'closed' ? await api.deliverableFor(number) : null;
    const verdict = dependencyVerdict(dep, deliverable);
    if (!verdict.assignable) return verdict;

    if (!dep.isPullRequest) {
      const deps = await blockedByFor(api, dep);
      if (deps.unknown) {
        return no(
          `dependency #${number}'s own \`Blocked by\` relationships could not be read, so its graph cannot be cleared`,
          true
        );
      }
      queue.push(...deps.numbers);
    }
  }

  return yes();
}

/**
 * The full verdict on one candidate.
 *
 * @param {IssueApi} api
 * @param {object} issue
 * @returns {Promise<{assignable: boolean, reason: string}>}
 */
async function assessCandidate(api, issue) {
  const labels = labelVerdict(issue);
  if (!labels.assignable) return labels;

  // An issue that already has an open PR carrying it has a branch with commits
  // on it. A second run would be told to build its own `pipeline/feature-<N>-<runId>` from
  // scratch and would either collide with that branch or silently duplicate it.
  // This is the state #547 was left in, and the state a human re-adding `ready`
  // to a rescued issue would recreate. Deliverable PRs only — an open PR that
  // merely *mentions* the issue must not make it unassignable (#567's own body
  // cites half the backlog).
  const deliverable = await api.deliverableFor(issue.number);
  if (deliverable.unknown) {
    return no('its pull requests could not be read, so an open one cannot be ruled out', true);
  }
  if (deliverable.pipeline && !deliverable.pipeline.merged) {
    return no(`pull request #${deliverable.pipeline.number} is already open against it`);
  }
  const openCloser = deliverable.closers.find((pr) => !pr.merged);
  if (openCloser) {
    return no(`pull request #${openCloser.number} is already open against it`);
  }

  return graphVerdict(api, issue);
}

/**
 * Picks the next assignable issue, or explains why there is none.
 *
 * Selection order is the issue number, ascending: the oldest eligible task goes
 * first, and the order does not depend on when labels happened to be applied.
 *
 * `unreadable` lists the candidates that were skipped because a fact about them
 * could not be read, rather than because they are ineligible. Empty is the
 * normal case; non-empty with no issue picked means the queue was not read, and
 * the caller has to say so out loud instead of reporting an idle queue.
 *
 * @param {IssueApi} api
 * @param {{log?: (message: string) => void, completedIssue?: number|null}} options
 * @returns {Promise<{issue: object|null, reason: string,
 *                    unreadable: {number: number, reason: string}[]}>}
 */
async function selectNextAssignable(api, options = {}) {
  const log = options.log || (() => {});
  const completed = options.completedIssue ?? null;

  // --- Single flight: never let two agent sessions run at once ---
  // An issue keeps `in-progress` until its run is finished, so any other one
  // still carrying that label means a run is live. Defer either way, and never
  // diagnose: from the labels alone a run forty seconds old is indistinguishable
  // from one that died hours ago, and only `agentic-watchdog.yml` ages it.
  const inProgress = await api.listIssuesByLabel(IN_PROGRESS);
  for (const busy of inProgress) {
    if (busy.number === completed) continue;
    log(
      `#${busy.number} is in progress — deferring. Finishing that run re-enters this step.`
    );
    return { issue: null, reason: `#${busy.number} is still in progress`, unreadable: [] };
  }

  const ready = await api.listIssuesByLabel(READY);
  ready.sort((a, b) => a.number - b.number);

  const unreadable = [];
  for (const issue of ready) {
    const verdict = await assessCandidate(api, issue);
    if (!verdict.assignable) {
      log(`#${issue.number}: skipped — ${verdict.reason}.`);
      if (verdict.unreadable) unreadable.push({ number: issue.number, reason: verdict.reason });
      continue;
    }
    return { issue, reason: verdict.reason, unreadable };
  }

  return { issue: null, reason: 'no assignable ready issue', unreadable };
}

/**
 * How many runs have ended `blocked` since the pipeline last merged anything.
 *
 * The cascade brake's input. Chaining from a failure is what keeps a fully
 * autonomous queue moving, and it is also how a systemic failure — an expired
 * token, a broken `main`, a runner image that no longer builds — marches
 * through the entire backlog labelling every issue `blocked` in minutes. A
 * merged pipeline PR is proof the pipeline can still finish something, so it is
 * what resets the count.
 *
 * @param {IssueApi} api
 * @param {{now?: number}} options
 */
async function consecutiveBlockedRuns(api, options = {}) {
  const now = options.now ?? Date.now();
  const lastMerge = await api.latestPipelineMergeAt();
  const floor = lastMerge ?? now - BLOCKED_CHAIN_FALLBACK_WINDOW_MS;

  const blocked = await api.listIssuesByLabel(BLOCKED);
  let count = 0;
  for (const issue of blocked) {
    const at = await api.blockedLabelledAt(issue.number);
    if (at === null || at <= floor) continue;
    // A human labelling a backlog note `blocked` is filing a reminder, not
    // ending a run, and three notes in a week must not park the queue. Only an
    // issue a run once owned counts toward the brake — the same test the chain
    // guard applies to the issue it fires from. Reads the timeline the
    // timestamp above already fetched, so this costs nothing extra.
    if (!(await api.everCarriedInProgress(issue.number))) continue;
    count += 1;
  }
  return count;
}

/**
 * Reads the configured cascade limit. A value that is not a positive integer is
 * a misconfiguration that would either disable the brake or stop the queue
 * outright, so it falls back rather than being obeyed.
 *
 * @param {string | undefined | null} raw
 */
function blockedChainLimit(raw) {
  const parsed = parseInt((raw || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BLOCKED_CHAIN_LIMIT;
}

/**
 * Resolves which agent an assignment comment addresses. An unrecognised value
 * fails the step loudly rather than silently picking a default — switching
 * agents is a one-variable change and a typo in it must not run the other one.
 *
 * @param {string | undefined | null} raw
 * @returns {string | null}
 */
function resolveMention(raw) {
  const key = (raw || '').trim().replace(/^@/, '').toLowerCase();
  const handles = { '': '@opencode', opencode: '@opencode', claude: '@claude' };
  return handles[key] ?? null;
}

/**
 * @typedef {object} IssueApi
 * @property {(label: string) => Promise<object[]>} listIssuesByLabel
 * @property {(number: number) => Promise<object|null>} getIssue
 * @property {(number: number) => Promise<{pipeline: {number: number, merged: boolean}|null, closers: {number: number, merged: boolean}[], unknown: boolean}>} deliverableFor
 * @property {(number: number) => Promise<{numbers: number[], available: boolean, unknown: boolean}>} [declaredBlockedBy]
 * @property {(number: number) => Promise<number|null>} blockedLabelledAt
 * @property {() => Promise<number|null>} latestPipelineMergeAt
 */

module.exports = {
  BLOCKED,
  DONE,
  IN_PROGRESS,
  READY,
  BLOCKED_CHAIN_FALLBACK_WINDOW_MS,
  DEFAULT_BLOCKED_CHAIN_LIMIT,
  MAX_DEPENDENCY_NODES,
  assessCandidate,
  blockedByFor,
  blockedChainLimit,
  consecutiveBlockedRuns,
  dependencyVerdict,
  graphVerdict,
  labelVerdict,
  parseDependencies,
  resolveMention,
  selectNextAssignable,
};
