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
// alongside it. `handle-failure.yml` already fires on the `paused`/`blocked`
// label — the one event that means "a run just declared a dependency" — and
// this is what it runs there.

const { parseDependencies } = require('./assignability.cjs');

/**
 * The issue numbers a body declares that GitHub does not already record.
 *
 * Pure, and deliberately the whole decision: everything above it is reading and
 * everything below it is writing, so the rule itself can be tested without a
 * network. `declared` is what `api.declaredBlockedBy` returned.
 *
 * Self-reference is dropped, mirroring `blockedByFor`'s own `union.delete` —
 * an issue that cites its own number in the section is not blocked on itself.
 *
 * @param {number} number the issue being reconciled
 * @param {string | null | undefined} body
 * @param {{numbers: number[]}} declared
 * @returns {number[]} ascending, deduplicated
 */
function missingRelationships(number, body, declared) {
  const already = new Set(declared.numbers);
  const missing = new Set();

  for (const dep of parseDependencies(body)) {
    if (dep === number) continue;
    if (already.has(dep)) continue;
    missing.add(dep);
  }

  return [...missing].sort((a, b) => a - b);
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
 * the relationship itself is the record of having written it.
 *
 * @param {import('./issue-api.cjs').IssueApi} api
 * @param {number} number
 * @param {{log?: (message: string) => void}} [options]
 * @returns {Promise<{created: number[], skipped: string|null, failed: {number: number, reason: string}[]}>}
 */
async function reconcileDependencies(api, number, options = {}) {
  const log = options.log || (() => {});

  const issue = await api.getIssue(number);
  if (!issue) {
    return { created: [], skipped: null, failed: [{ number, reason: 'the issue itself could not be read' }] };
  }

  const declared = await api.declaredBlockedBy(number);
  if (declared.unknown) {
    return {
      created: [],
      skipped: null,
      failed: [{ number, reason: 'its existing `blocked_by` relationships could not be read' }],
    };
  }
  if (!declared.available) {
    const skipped = 'issue dependencies are not available on this repository — the body section is the only source';
    log(`#${number}: ${skipped}.`);
    return { created: [], skipped, failed: [] };
  }

  const missing = missingRelationships(number, issue.body, declared);
  if (missing.length === 0) {
    log(`#${number}: every declared dependency is already a relationship.`);
    return { created: [], skipped: null, failed: [] };
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

  return { created, skipped: null, failed };
}

module.exports = {
  missingRelationships,
  reconcileDependencies,
};
