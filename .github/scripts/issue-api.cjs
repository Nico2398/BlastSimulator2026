'use strict';

/**
 * The GitHub half of the assignment decision.
 *
 * `assignability.cjs` holds the rules and knows nothing about octokit; this
 * builds the small read-only surface those rules ask questions through. Split
 * so the rules can be unit tested against a fake, and so every REST call the
 * decision depends on is visible in one place.
 *
 * Reads only. Nothing here labels, comments, or merges.
 */

const PER_PAGE = 100;

/**
 * Pages read before a listing is called incomplete. Reached in practice by
 * nothing — 2000 timeline events on one issue — and the point is what happens
 * if it ever is: the reader reports the truncation rather than returning a
 * partial answer that looks complete. A cross-reference beyond the last page
 * read is a pull request the rules would not see.
 */
const MAX_PAGES = 20;

/** Labels arrive as strings from some endpoints and objects from others. */
const labelNames = (issue) =>
  (issue.labels || []).map((label) => (typeof label === 'string' ? label : label.name));

/** The shape `assignability.cjs` reasons about, from a REST issue payload. */
const normalise = (issue) => ({
  number: issue.number,
  state: issue.state,
  stateReason: issue.state_reason ?? null,
  labels: labelNames(issue),
  body: issue.body || '',
  title: issue.title || '',
  isPullRequest: Boolean(issue.pull_request),
  prMergedAt: issue.pull_request?.merged_at ?? null,
});

/**
 * Reads every page of a listing, up to `MAX_PAGES`.
 *
 * `complete` is the load-bearing half. Every rule that consumes a listing here
 * treats an incomplete one as blocking, because "no open pull request found in
 * the first hundred events" and "no open pull request" are the same answer from
 * a caller's side and opposite answers in fact.
 *
 * @returns {Promise<{items: object[], complete: boolean}>}
 */
async function readAllPages(fetchPage) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await fetchPage(page);
    items.push(...data);
    if (data.length < PER_PAGE) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * @param {object} github  authenticated octokit, as `actions/github-script` supplies
 * @param {{owner: string, repo: string, log?: (m: string) => void}} context
 */
function createIssueApi(github, { owner, repo, log = () => {} }) {
  const timelines = new Map();
  const issues = new Map();

  /** One timeline read per issue per run — several rules ask about the same one. */
  const timeline = async (number) => {
    if (!timelines.has(number)) {
      const read = await readAllPages((page) =>
        github.rest.issues.listEventsForTimeline({
          owner,
          repo,
          issue_number: number,
          per_page: PER_PAGE,
          page,
        })
      );
      if (!read.complete) {
        log(`#${number}: timeline exceeds ${MAX_PAGES * PER_PAGE} events — read as incomplete.`);
      }
      timelines.set(number, read);
    }
    return timelines.get(number);
  };

  return {
    async listIssuesByLabel(label) {
      const { items } = await readAllPages((page) =>
        github.rest.issues.listForRepo({
          owner,
          repo,
          labels: label,
          state: 'open',
          sort: 'created',
          direction: 'asc',
          per_page: PER_PAGE,
          page,
        })
      );
      return items.map(normalise);
    },

    /**
     * `null` means "could not be established", which every caller treats as
     * blocking. A deleted issue, a number that never existed, and an API error
     * are indistinguishable from here and must not be told apart by guessing.
     */
    async getIssue(number) {
      if (issues.has(number)) return issues.get(number);
      const result = await github.rest.issues
        .get({ owner, repo, issue_number: number })
        .then(({ data }) => normalise(data))
        .catch((error) => {
          log(`#${number}: could not be read (${error.status ?? error.message}).`);
          return null;
        });
      issues.set(number, result);
      return result;
    },

    /**
     * Pull requests cross-referencing this issue, which is how GitHub records
     * `Closes #N`. State only — merged is reported as `closed`, and no rule here
     * needs to tell a merged PR from an abandoned one: both are finished.
     *
     * `complete` reports whether the whole timeline was read. A rule that cannot
     * see every cross-reference cannot conclude there is no open pull request.
     */
    async linkedPullRequests(number) {
      const { items, complete } = await timeline(number);
      const seen = new Map();
      for (const event of items) {
        const source = event.event === 'cross-referenced' ? event.source?.issue : null;
        if (source?.pull_request) {
          seen.set(source.number, { number: source.number, state: source.state });
        }
      }
      return { pullRequests: [...seen.values()], complete };
    },

    /**
     * When `blocked` was last applied, in epoch ms. `null` when it never was.
     *
     * An incomplete timeline reports `now` rather than `null`: the cascade brake
     * counts these, so an undated failure has to count as a recent one. Guessing
     * the other way would let a truncated history quietly reopen the chain.
     */
    async blockedLabelledAt(number, now = Date.now()) {
      const { items, complete } = await timeline(number);
      const stamps = items
        .filter((event) => event.event === 'labeled' && event.label?.name === 'blocked')
        .map((event) => Date.parse(event.created_at))
        .filter((value) => !Number.isNaN(value));
      if (stamps.length > 0) return Math.max(...stamps);
      return complete ? null : now;
    },

    /**
     * Whether this issue ever carried `in-progress` — i.e. whether a run owned
     * it. An incomplete timeline answers `false`, which stops the chain: the
     * safe direction here is an idle queue, not a session nobody asked for.
     */
    async everCarriedInProgress(number) {
      const { items } = await timeline(number);
      return items.some(
        (event) => event.event === 'labeled' && event.label?.name === 'in-progress'
      );
    },

    /**
     * When the pipeline last merged one of its own pull requests. Proof that the
     * loop can still finish something, and therefore what resets the cascade
     * brake. `null` when it never has.
     */
    async latestPipelineMergeAt() {
      const { data } = await github.rest.pulls.list({
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: PER_PAGE,
      });
      const stamps = data
        .filter((pr) => pr.merged_at && (pr.head?.ref || '').startsWith('pipeline/'))
        .map((pr) => Date.parse(pr.merged_at))
        .filter((value) => !Number.isNaN(value));
      return stamps.length > 0 ? Math.max(...stamps) : null;
    },
  };
}

module.exports = { createIssueApi, labelNames, normalise, readAllPages, MAX_PAGES, PER_PAGE };
