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
 * Issue numbers an issue declares itself blocked by.
 *
 * Three spellings reach here and each is canonical somewhere: the `Blocked by`
 * section the issue form and `agentic-issue-creation` produce, the inline
 * `Depends on: #N` older issues carry, and the checklist form
 * (`- [ ] Blocked by #N`) GitHub's own UI writes. Matching only one of them let
 * a correctly written issue run ahead of the dependency it named, which fails
 * the run rather than deferring it.
 *
 * Every `#N` on a line inside the section counts. A reference outside one does
 * not: `## Context` routinely cites issues as background, and reading those as
 * dependencies would block on the entire history an issue mentions.
 *
 * @param {string | null | undefined} body
 * @returns {number[]}
 */
function parseDependencies(body) {
  const deps = new Set();
  let inSection = false;

  for (const line of (body || '').split('\n')) {
    const opensSection =
      /^\s*(?:[-*]\s+(?:\[[ xX]\]\s+)?)?(?:#{1,6}\s*|\*\*)?(?:blocked\s+by|depends?\s+on|dependencies)\b/i.test(
        line
      );

    if (opensSection) {
      inSection = true;
    } else if (inSection && /^\s*(?:#{1,6}\s+\S|\*\*\S)/.test(line)) {
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

/** @returns {{assignable: false, reason: string}} */
const no = (reason) => ({ assignable: false, reason });
/** @returns {{assignable: true, reason: string}} */
const yes = () => ({ assignable: true, reason: 'no blocking condition found' });

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
 * @param {{number: number, state: string}[]} linkedPrs
 */
function dependencyVerdict(dep, linkedPrs) {
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

  const unmerged = (linkedPrs || []).find((pr) => pr.state === 'open');
  if (unmerged) {
    return no(
      `dependency #${dep.number} is closed but its pull request #${unmerged.number} is still open`
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
  const queue = parseDependencies(root.body).filter((n) => n !== root.number);
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
        `dependency #${number} could not be read; a dependency that cannot be verified counts as unmet`
      );
    }

    const linked = dep.isPullRequest ? [] : await api.linkedPullRequests(number);
    const verdict = dependencyVerdict(dep, linked);
    if (!verdict.assignable) return verdict;

    if (!dep.isPullRequest) {
      queue.push(...parseDependencies(dep.body).filter((n) => n !== number));
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

  // An issue that already has an open PR against it has a branch with commits
  // on it. A second run would be told to build `pipeline/feature-<N>` from
  // scratch and would either collide with that branch or silently duplicate it.
  // This is the state #547 was left in, and the state a human re-adding `ready`
  // to a rescued issue would recreate.
  const linked = await api.linkedPullRequests(issue.number);
  const open = linked.find((pr) => pr.state === 'open');
  if (open) {
    return no(`pull request #${open.number} is already open against it`);
  }

  return graphVerdict(api, issue);
}

/**
 * Picks the next assignable issue, or explains why there is none.
 *
 * Selection order is the issue number, ascending: the oldest eligible task goes
 * first, and the order does not depend on when labels happened to be applied.
 *
 * @param {IssueApi} api
 * @param {{log?: (message: string) => void, completedIssue?: number|null}} options
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
    return { issue: null, reason: `#${busy.number} is still in progress` };
  }

  const ready = await api.listIssuesByLabel(READY);
  ready.sort((a, b) => a.number - b.number);

  for (const issue of ready) {
    const verdict = await assessCandidate(api, issue);
    if (!verdict.assignable) {
      log(`#${issue.number}: skipped — ${verdict.reason}.`);
      continue;
    }
    return { issue, reason: verdict.reason };
  }

  return { issue: null, reason: 'no assignable ready issue' };
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
    if (at !== null && at > floor) count += 1;
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
 * @property {(number: number) => Promise<{number: number, state: string}[]>} linkedPullRequests
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
  blockedChainLimit,
  consecutiveBlockedRuns,
  dependencyVerdict,
  graphVerdict,
  labelVerdict,
  parseDependencies,
  resolveMention,
  selectNextAssignable,
};
