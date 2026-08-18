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
 * partial answer that looks complete. A label event beyond the last page read
 * is a run the rules would not see.
 */
const MAX_PAGES = 20;

/**
 * Statuses worth asking a second time, and how many times to ask.
 *
 * Not a verdict on anything — the verdict is whatever the call finally returns.
 * This is the network backoff `agentic-workflow-edition` allows, the same
 * mechanism as `agentic-rescue`'s retried push, applied to reads instead.
 *
 * The incident: on 17 Aug 2026 three dispatches of `agentic-trigger.yml` in a
 * row skipped every `ready` issue with "deliverable PRs could not be read
 * (503)". One degraded API response per candidate parked the whole queue, and
 * issue #554 sat unassigned while every run reported success.
 */
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

/** Network faults arrive with no status at all; a 404 or a 403 is an answer. */
function isTransient(error) {
  const status = error?.status ?? 0;
  if (status) return TRANSIENT_STATUSES.has(status);
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(
    error?.message ?? ''
  );
}

/**
 * A PR body that closes this issue, as GitHub itself reads one.
 *
 * The fallback path only — see `closersFromTimeline`. Deliberately the keyword
 * form and nothing else: a bare `#N` in prose is a mention, and reading one as a
 * deliverable is what disarmed run #133 (#568).
 */
const closingKeyword = (number) =>
  new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s*:?\\s+#${number}\\b`, 'i');

/**
 * The branch family one issue's runs build on.
 *
 * A work branch is `pipeline/<role>-<issue>-<runId>` — unique per run, so a run
 * can never inherit, collide with, or be refused by the branch an earlier run
 * left behind. Run 166 on issue #554 is the incident: it built
 * `pipeline/feature-554` from `main` while the abandoned branch of run 160 still
 * held that exact name, and six hours of finished work died on
 * `! [rejected] (non-fast-forward)` because the rescue push had nowhere to land.
 *
 * Matching therefore has to accept the family, not one name. The bare
 * `pipeline/feature-<N>` stays matchable for every branch and pull request that
 * predates the convention.
 */
const pipelineHeadPattern = (number) =>
  new RegExp(`^pipeline/feature-${number}(?:-[A-Za-z0-9._-]+)?$`);

/** Every head ref in that family, exact name first. */
const isPipelineHead = (ref, number) => pipelineHeadPattern(number).test(ref || '');

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
 * @param {{owner: string, repo: string, log?: (m: string) => void,
 *          sleep?: (ms: number) => Promise<void>}} context
 */
function createIssueApi(
  github,
  { owner, repo, log = () => {}, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }
) {
  const timelines = new Map();
  const issues = new Map();
  const dependencies = new Map();
  const deliverables = new Map();

  /**
   * Runs one read, asking again when the failure is a transient one.
   *
   * Every rule downstream fails closed on an unreadable fact, so a single 503
   * costs an entire pass of the queue. Retrying costs seconds; the alternative
   * is the pipeline stopping until a human dispatches it again — which on
   * 17 Aug 2026 failed three times in a row for the same reason.
   */
  const read = async (what, call) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (attempt >= RETRY_ATTEMPTS || !isTransient(error)) throw error;
        log(`${what}: ${error.status ?? error.message} — asking again (${attempt}/${RETRY_ATTEMPTS - 1}).`);
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  };

  /** One timeline read per issue per run — several rules ask about the same one. */
  const timeline = async (number) => {
    if (!timelines.has(number)) {
      const events = await readAllPages((page) =>
        read(`#${number}: timeline`, () =>
          github.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: number,
            per_page: PER_PAGE,
            page,
          })
        )
      );
      if (!events.complete) {
        log(`#${number}: timeline exceeds ${MAX_PAGES * PER_PAGE} events — read as incomplete.`);
      }
      timelines.set(number, events);
    }
    return timelines.get(number);
  };

  /**
   * Every pull request opened from this issue's branch family.
   *
   * `pulls.list`'s `head` filter takes one exact ref, and the family is now
   * open-ended (`pipeline/feature-<N>-<runId>`), so the refs are enumerated
   * first: `git/matching-refs` filters server-side on the prefix, which is one
   * call rather than a walk of every pull request in the repository. The bare
   * name is always queried too — a merged pull request whose branch was deleted
   * is no longer in the ref list but is still the deliverable.
   */
  const pipelinePullRequests = async (number) => {
    const refs = await read(`#${number}: pipeline branches`, () =>
      github.rest.git.listMatchingRefs({ owner, repo, ref: `heads/pipeline/feature-${number}` })
    ).catch((error) => {
      // A prefix that matches nothing 404s on some hosts and returns [] on
      // others. Either way the exact name below still gets asked.
      if ((error.status ?? 0) !== 404) throw error;
      return { data: [] };
    });

    const names = new Set([`pipeline/feature-${number}`]);
    for (const entry of refs.data || []) {
      const name = String(entry.ref || '').replace(/^refs\/heads\//, '');
      if (isPipelineHead(name, number)) names.add(name);
    }

    const found = [];
    for (const name of names) {
      const { data } = await read(`#${number}: pull requests from ${name}`, () =>
        github.rest.pulls.list({
          owner,
          repo,
          state: 'all',
          head: `${owner}:${name}`,
          per_page: 20,
        })
      );
      found.push(...data);
    }
    return found;
  };

  /**
   * The closing pull requests, reconstructed from the REST timeline.
   *
   * Stands in for `closedByPullRequestsReferences` when that field is
   * unavailable — the 503 of 17 Aug 2026, which no retry cleared and which left
   * the queue with no way back except a code change. GitHub's own link is still
   * the authority; this reproduces the half of it that a body carries, and
   * applies the same `includeClosedPrs: false` filter the query asks for.
   *
   * Narrower than the field on purpose: a pull request linked by hand in the
   * sidebar writes no keyword and is invisible here. That is the one case this
   * path can miss, and it is worth an assignable queue — the alternative is
   * every issue skipped at once, which is not a state the pipeline recovers from
   * on its own.
   */
  const closersFromTimeline = async (number) => {
    let events;
    try {
      events = await timeline(number);
    } catch (error) {
      log(`#${number}: timeline could not be read either (${error.status ?? error.message}).`);
      return { closers: [], unknown: true };
    }
    if (!events.complete) return { closers: [], unknown: true };

    const keyword = closingKeyword(number);
    const found = new Map();
    for (const event of events.items) {
      const source = event.event === 'cross-referenced' ? event.source?.issue : null;
      if (!source?.pull_request || !Number.isInteger(source.number)) continue;
      const merged = Boolean(source.pull_request.merged_at);
      if (!merged && source.state !== 'open') continue; // `includeClosedPrs: false`
      if (!keyword.test(source.body || '')) continue; // a mention is not a link
      found.set(source.number, { number: source.number, merged });
    }
    log(`#${number}: closing pull requests read off the timeline instead — ${found.size} found.`);
    return { closers: [...found.values()], unknown: false };
  };

  return {
    async listIssuesByLabel(label) {
      const { items } = await readAllPages((page) =>
        read(`\`${label}\` listing`, () =>
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
        )
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
      const result = await read(`#${number}`, () =>
        github.rest.issues.get({ owner, repo, issue_number: number })
      )
        .then(({ data }) => normalise(data))
        .catch((error) => {
          log(`#${number}: could not be read (${error.status ?? error.message}).`);
          return null;
        });
      issues.set(number, result);
      return result;
    },

    /**
     * The pull requests that actually carry this issue's work — never a mention.
     *
     * A timeline cross-reference is raised by any PR that merely writes "#N"
     * anywhere in its body, and reading one as "this issue has a PR" is how docs
     * PR #561's passing mention of #547 disarmed run #133's retry (fixed on the
     * other three sites by #568; this is the same predicate for the rules the
     * shared scripts own). Two links prose cannot raise:
     *
     *   pipeline — a PR whose head is `pipeline/feature-<N>`, the branch the
     *              assignment told the run to build. Open or merged; a
     *              closed-unmerged one is a rejected deliverable and ignored.
     *   closers  — PRs GitHub records as closing the issue (`Closes #N` in the
     *              PR body, or linked by hand). Open and merged only,
     *              `includeClosedPrs: false`.
     *
     * The two are read independently, and the closers read has a REST fallback
     * (`closersFromTimeline`), because a queue must not be parked by one API
     * surface being degraded — 17 Aug 2026, when the GraphQL field answered 503
     * for every candidate and three dispatches in a row assigned nothing.
     *
     * `unknown: true` means a read failed and its fallback failed too. Callers
     * fail closed on it — a 500 must never read as "this issue has no pull
     * request".
     *
     * @returns {Promise<{pipeline: {number: number, merged: boolean}|null,
     *                    closers: {number: number, merged: boolean}[],
     *                    unknown: boolean}>}
     */
    async deliverableFor(number) {
      if (deliverables.has(number)) return deliverables.get(number);

      let pipeline = null;
      let unknown = false;
      try {
        const headPrs = await pipelinePullRequests(number);
        // Open outranks merged: an open one is a run in flight, and that is the
        // state every caller of this is trying not to collide with.
        const fromPipeline =
          headPrs.find((pr) => pr.state === 'open') ?? headPrs.find((pr) => pr.merged_at);
        pipeline = fromPipeline
          ? { number: fromPipeline.number, merged: Boolean(fromPipeline.merged_at) }
          : null;
      } catch (error) {
        log(
          `#${number}: the pipeline branch's pull requests could not be read (${error.status ?? error.message}).`
        );
        unknown = true;
      }

      let closing;
      try {
        const linked = await read(`#${number}: closing pull requests`, () =>
          github.graphql(
            `query($owner: String!, $repo: String!, $number: Int!) {
               repository(owner: $owner, name: $repo) {
                 issue(number: $number) {
                   closedByPullRequestsReferences(first: 50, includeClosedPrs: false) {
                     nodes { number merged }
                   }
                 }
               }
             }`,
            { owner, repo, number }
          )
        );
        closing = {
          closers: (linked?.repository?.issue?.closedByPullRequestsReferences?.nodes ?? [])
            .filter((node) => node && Number.isInteger(node.number))
            .map((node) => ({ number: node.number, merged: Boolean(node.merged) })),
          unknown: false,
        };
      } catch (error) {
        log(
          `#${number}: closing pull requests could not be read from GraphQL (${error.status ?? error.message}).`
        );
        closing = await closersFromTimeline(number);
      }

      const result = {
        pipeline,
        closers: closing.closers,
        unknown: unknown || closing.unknown,
      };

      deliverables.set(number, result);
      return result;
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
     * The dependencies GitHub itself records — the "Blocked by" relationships in
     * an issue's Relationships panel. Authoritative, because a relationship is a
     * declaration rather than a mention: nothing about quoting an issue in prose
     * can produce one.
     *
     * `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by`, verified
     * against this repository. Only the issue number is read off each entry; the
     * dependency is re-fetched by number like any other, so the rules never
     * depend on the rest of the payload's shape.
     *
     * Three outcomes, and the difference between the last two is the whole point:
     *   available: true             — the list is what it says
     *   available: false            — the endpoint is not on this repository, so
     *                                 the body section is the only source there is
     *   available: false, unknown   — the call failed for some other reason. The
     *                                 rules block on this; a permission slip or a
     *                                 500 must not read as "no dependencies"
     *
     * @returns {Promise<{numbers: number[], available: boolean, unknown: boolean}>}
     */
    async declaredBlockedBy(number) {
      if (dependencies.has(number)) return dependencies.get(number);

      let result;
      try {
        const { items } = await readAllPages((page) =>
          read(`#${number}: blocked-by relationships`, () =>
            github.request(
              'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
              { owner, repo, issue_number: number, per_page: PER_PAGE, page }
            )
          )
        );
        result = {
          numbers: items.map((item) => item.number).filter((n) => Number.isInteger(n)),
          available: true,
          unknown: false,
        };
      } catch (error) {
        const status = error.status ?? 0;
        // 404/410 is the feature not being present, which is a fact about the
        // repository and not about this issue. Anything else is a failure to
        // read, and a failure to read is not an empty list.
        const absent = status === 404 || status === 410;
        if (!absent) {
          log(`#${number}: blocked-by relationships could not be read (${status || error.message}).`);
        }
        result = { numbers: [], available: false, unknown: !absent };
      }

      dependencies.set(number, result);
      return result;
    },

    /**
     * When the pipeline last merged one of its own pull requests. Proof that the
     * loop can still finish something, and therefore what resets the cascade
     * brake. `null` when it never has.
     */
    async latestPipelineMergeAt() {
      const { data } = await read('the last pipeline merge', () =>
        github.rest.pulls.list({
          owner,
          repo,
          state: 'closed',
          sort: 'updated',
          direction: 'desc',
          per_page: PER_PAGE,
        })
      );
      const stamps = data
        .filter((pr) => pr.merged_at && (pr.head?.ref || '').startsWith('pipeline/'))
        .map((pr) => Date.parse(pr.merged_at))
        .filter((value) => !Number.isNaN(value));
      return stamps.length > 0 ? Math.max(...stamps) : null;
    },
  };
}

module.exports = {
  createIssueApi,
  closingKeyword,
  isPipelineHead,
  pipelineHeadPattern,
  isTransient,
  labelNames,
  normalise,
  readAllPages,
  MAX_PAGES,
  PER_PAGE,
  RETRY_ATTEMPTS,
  TRANSIENT_STATUSES,
};
