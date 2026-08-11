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
 * @param {object} github  authenticated octokit, as `actions/github-script` supplies
 * @param {{owner: string, repo: string, log?: (m: string) => void}} context
 */
function createIssueApi(github, { owner, repo, log = () => {} }) {
  const timelines = new Map();
  const issues = new Map();

  /** One timeline read per issue per run — several rules ask about the same one. */
  const timeline = async (number) => {
    if (!timelines.has(number)) {
      const { data } = await github.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: number,
        per_page: 100,
      });
      timelines.set(number, data);
    }
    return timelines.get(number);
  };

  return {
    async listIssuesByLabel(label) {
      const { data } = await github.rest.issues.listForRepo({
        owner,
        repo,
        labels: label,
        state: 'open',
        sort: 'created',
        direction: 'asc',
        per_page: 100,
      });
      return data.map(normalise);
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
     */
    async linkedPullRequests(number) {
      const events = await timeline(number);
      const seen = new Map();
      for (const event of events) {
        const source = event.event === 'cross-referenced' ? event.source?.issue : null;
        if (source?.pull_request) seen.set(source.number, { number: source.number, state: source.state });
      }
      return [...seen.values()];
    },

    /** When `blocked` was last applied, in epoch ms. `null` when it never was. */
    async blockedLabelledAt(number) {
      const events = await timeline(number);
      const stamps = events
        .filter((event) => event.event === 'labeled' && event.label?.name === 'blocked')
        .map((event) => Date.parse(event.created_at))
        .filter((value) => !Number.isNaN(value));
      return stamps.length > 0 ? Math.max(...stamps) : null;
    },

    /** Whether this issue ever carried `in-progress` — i.e. whether a run owned it. */
    async everCarriedInProgress(number) {
      const events = await timeline(number);
      return events.some(
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
        per_page: 100,
      });
      const stamps = data
        .filter((pr) => pr.merged_at && (pr.head?.ref || '').startsWith('pipeline/'))
        .map((pr) => Date.parse(pr.merged_at))
        .filter((value) => !Number.isNaN(value));
      return stamps.length > 0 ? Math.max(...stamps) : null;
    },
  };
}

module.exports = { createIssueApi, labelNames, normalise };
