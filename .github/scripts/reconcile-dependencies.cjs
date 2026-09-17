// BlastSimulator2026 — dependency reconciliation for a halted run
//
// A pause declares a dependency in two places: GitHub's own `blocked_by`
// relationship, and the issue body's `## Blocked by` section. `blockedByFor`
// (assignability.cjs) reads the union of the two, and that union is exactly why
// writing only one of them is invisible — the queue behaves correctly on the
// body half alone. Nothing goes red, nothing stalls, and the authoritative
// source is simply absent until somebody reads the Relationships panel and
// finds it empty.
//
// Issue #1090 paused that way on 16 Sep 2026: the body section was written, the
// relationship was not, and the queue held the issue correctly for the whole
// time the omission existed. A prose instruction is the wrong guard for a
// two-part write whose halves are not equally load-bearing — one of them works
// on its own, so forgetting it produces no signal at all.
//
// So the relationship is derived from the section rather than remembered
// alongside it. `handle-failure.yml` fires this on the `paused`/`blocked` label
// and on an edit to an issue that already carries one — the two events that
// each mean "half of a declared dependency was just written". Which of them
// arrives second is not knowable in advance, and does not need to be: the
// second one sees both halves.
//
// #1127 is why that is two events rather than one. The label was the only
// trigger, and a run applies the label *before* it edits the body, so on the
// very path this was written for the job read a body that did not name the
// dependency yet, found nothing to add, and exited green. #1090's relationship
// stayed unwritten for two hours, and the log said "every declared dependency
// is already a relationship" — the same line a genuinely reconciled issue
// prints. Hence also `unresolved` below: the two ways to have nothing to write
// are different findings and must not read alike.

const { parseDependencies } = require('./assignability.cjs');

/**
 * The halt label that means a dependency was declared.
 *
 * A `paused` run stopped *because* something it filed is in the way, so its
 * issue naming nothing under `## Blocked by` is a finding either way — the
 * section is not written yet, or the pause named nothing. `blocked` carries no
 * such implication: it waits on a human's answer and may declare no dependency
 * at all, which is an ordinary green outcome.
 */
const DECLARES_A_DEPENDENCY = 'paused';

/**
 * The issue numbers a body's `## Blocked by` section declares.
 *
 * Pure. Self-reference is dropped, mirroring `blockedByFor`'s own
 * `union.delete` — an issue that cites its own number in the section is not
 * blocked on itself.
 *
 * @param {number} number the issue being reconciled
 * @param {string | null | undefined} body
 * @returns {number[]} ascending, deduplicated
 */
function declaredDependencies(number, body) {
  const declared = new Set();
  for (const dep of parseDependencies(body)) {
    if (dep === number) continue;
    declared.add(dep);
  }
  return [...declared].sort((a, b) => a - b);
}

/**
 * The issue numbers a body declares that GitHub does not already record.
 *
 * Pure, and deliberately the whole decision: everything above it is reading and
 * everything below it is writing, so the rule itself can be tested without a
 * network. `declared` is what `api.declaredBlockedBy` returned.
 *
 * @param {number} number the issue being reconciled
 * @param {string | null | undefined} body
 * @param {{numbers: number[]}} declared
 * @returns {number[]} ascending, deduplicated
 */
function missingRelationships(number, body, declared) {
  const already = new Set(declared.numbers);
  return declaredDependencies(number, body).filter((dep) => !already.has(dep));
}

/**
 * Sets every relationship `number`'s body declares and GitHub does not record.
 *
 * Fails closed on an unreadable relationship list (Rule 4): `unknown` means the
 * call failed for a reason other than the feature being absent, and writing
 * against a list that could not be read would create duplicates at best and
 * mask a permission problem at worst. `available: false` without `unknown` is
 * the endpoint genuinely not being on this repository — there is nothing to
 * reconcile there and the body section is the only source the queue has, which
 * is a supported configuration rather than a fault.
 *
 * Idempotent by construction (Rule 5): the set difference is empty on a second
 * run, so a redelivered webhook writes nothing. No marker comment is needed —
 * the relationship itself is the record of having written it. That is also what
 * makes the two triggers safe to overlap: whichever of them runs second, and
 * even if both run at once, the difference it writes is empty.
 *
 * `unresolved` is the #1127 signal — set when a `paused` issue's section
 * declares nothing, which is either this job racing the run's own body write or
 * a pause that never named what it waits on. Distinct from the green "every
 * declared dependency is already a relationship", because reporting the two
 * identically is what hid #1090's missing relationship.
 *
 * @param {import('./issue-api.cjs').IssueApi} api
 * @param {number} number
 * @param {{log?: (message: string) => void}} [options]
 * @returns {Promise<{created: number[], declared: number[], unresolved: string|null, skipped: string|null, failed: {number: number, reason: string}[]}>}
 */
async function reconcileDependencies(api, number, options = {}) {
  const log = options.log || (() => {});
  const outcome = (fields) => ({
    created: [],
    declared: [],
    unresolved: null,
    skipped: null,
    failed: [],
    ...fields,
  });

  const issue = await api.getIssue(number);
  if (!issue) {
    return outcome({ failed: [{ number, reason: 'the issue itself could not be read' }] });
  }

  const declared = await api.declaredBlockedBy(number);
  if (declared.unknown) {
    return outcome({
      failed: [{ number, reason: 'its existing `blocked_by` relationships could not be read' }],
    });
  }
  if (!declared.available) {
    const skipped = 'issue dependencies are not available on this repository — the body section is the only source';
    log(`#${number}: ${skipped}.`);
    return outcome({ skipped });
  }

  const inBody = declaredDependencies(number, issue.body);
  const missing = missingRelationships(number, issue.body, declared);

  if (missing.length === 0) {
    // A paused issue declaring nothing is the state #1127 made visible. The
    // relationship still arrives — the edit that writes the section fires this
    // job again — so this is a notice rather than a failure: going red on the
    // label event of every healthy pause would be a red job nobody reads.
    if (inBody.length === 0 && (issue.labels || []).includes(DECLARES_A_DEPENDENCY)) {
      const unresolved =
        'paused with no dependency under `## Blocked by` — either the section is not written yet, '
        + 'in which case the edit that writes it reconciles this issue, or the pause named nothing';
      log(`#${number}: ${unresolved}.`);
      return outcome({ unresolved });
    }
    log(`#${number}: every declared dependency is already a relationship.`);
    return outcome({ declared: inBody });
  }

  const created = [];
  const failed = [];

  for (const blocker of missing) {
    // The endpoint takes the blocker's database id, not its number — the one
    // detail that makes this fail silently if guessed.
    const target = await api.getIssue(blocker);
    if (!target || target.id === null) {
      failed.push({ number: blocker, reason: 'its database id could not be read' });
      continue;
    }

    const result = await api.addBlockedBy(number, target.id);
    if (result.ok) {
      created.push(blocker);
      log(`#${number}: now recorded as blocked by #${blocker}.`);
    } else {
      failed.push({ number: blocker, reason: result.reason });
    }
  }

  return outcome({ created, declared: inBody, failed });
}

module.exports = {
  DECLARES_A_DEPENDENCY,
  declaredDependencies,
  missingRelationships,
  reconcileDependencies,
};
