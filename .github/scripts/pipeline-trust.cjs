'use strict';

/**
 * Who may put work in front of the autonomous pipeline: a pull request the
 * merge gate may merge or approve runs for, a pull request the CI fail-safe may
 * hand back to an agent, an issue the assigner may give a session.
 *
 * The repository is public, so any GitHub account can fork it, open a pull
 * request, file an issue and comment. Until the 2026-11-06 audit (outside PRs
 * #2150 and #2151) none of those reached the pipeline through a check on who
 * the account was:
 *
 * - The merge gate selected any open, non-draft pull request carrying the
 *   `READY TO MERGE` line, fork or not, approved its parked workflow runs under
 *   the PAT — the one switch GitHub keeps between a stranger's fork and the
 *   runners — and merged it once the channels on its head were green. On a
 *   fork, those channels run the fork's own workflow files.
 * - The CI fail-safe recognised a pipeline pull request by its branch name
 *   alone, and a fork can name a branch `pipeline/feature-1-2`. A conflict or a
 *   red run on such a pull request was answered with an `@claude` comment under
 *   the owner's PAT, which starts a session on the stranger's head.
 * - The issue form applies `agent-task` and `ready` for whoever files it.
 *
 * The rule is the same for all three: the work must come from the repository
 * owner — the only account with admin access to a personal repository — or
 * from one of the GitHub Apps the owner installed on it. A pull request must
 * also come from a branch of this repository, because a fork's owner can push
 * to its branch after anyone trusted has looked at it.
 *
 * No network, no octokit, in the house style of `assignability.cjs`: the
 * caller passes plain data and, where a permission has to be read, the
 * function that reads it.
 */

/** The only permission that may drive the pipeline. */
const TRUSTED_PERMISSION = 'admin';

/**
 * Author associations GitHub reports for the repository owner. An app is
 * trusted by type, not by association; nothing else qualifies.
 */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER']);

/**
 * A GitHub App acts only on a repository it is installed on, and only an
 * admin installs one; the `github-actions[bot]` identity writes only through
 * this repository's own workflows, a fork's runs getting a read-only token.
 *
 * @param {{type?: string}|null|undefined} user
 */
function isApp(user) {
  return (user?.type || '') === 'Bot';
}

/**
 * Whether an issue's author may have it assigned to an agent session.
 *
 * @param {{user?: {login?: string, type?: string}|null, author_association?: string}} issue
 * @returns {{trusted: boolean, reason: string}}
 */
function issueTrust(issue) {
  const login = issue.user?.login || '(unknown author)';
  if (isApp(issue.user)) return { trusted: true, reason: `filed by ${login}, an app installed on this repository` };
  if (TRUSTED_ASSOCIATIONS.has(issue.author_association || '')) {
    return { trusted: true, reason: `filed by ${login}, the repository owner` };
  }
  return {
    trusted: false,
    reason: `filed by ${login} (${issue.author_association || 'no association'}), not the repository owner`,
  };
}

/**
 * Whether the pipeline may act on a pull request: merge it, approve its gated
 * runs, update its branch, or hand it to an agent.
 *
 * Fails closed: a head repository that cannot be read is a fork, and a
 * permission that cannot be read is `unreadable` — the caller decides whether
 * that is loud, but never treats it as trusted.
 *
 * @param {{
 *   pr: {head?: {repo?: {full_name?: string}|null}, user?: {login?: string, type?: string}|null},
 *   repository: string,
 *   readPermission: (login: string) => Promise<string>,
 * }} args
 * @returns {Promise<{trusted: boolean, unreadable: boolean, reason: string}>}
 */
async function pullRequestTrust({ pr, repository, readPermission }) {
  const headRepo = pr.head?.repo?.full_name || '';
  if (headRepo.toLowerCase() !== repository.toLowerCase()) {
    return {
      trusted: false,
      unreadable: false,
      reason: headRepo ? `opened from ${headRepo}, not a branch of ${repository}` : 'its head repository is gone',
    };
  }

  const login = pr.user?.login || '';
  if (isApp(pr.user)) {
    return { trusted: true, unreadable: false, reason: `opened by ${login}, an app installed on this repository` };
  }
  if (!login) return { trusted: false, unreadable: false, reason: 'its author is unknown' };

  let permission;
  try {
    permission = await readPermission(login);
  } catch (error) {
    return {
      trusted: false,
      unreadable: true,
      reason: `the permission of its author ${login} could not be read (${error?.status ?? error?.message ?? error})`,
    };
  }
  if (permission === TRUSTED_PERMISSION) {
    return { trusted: true, unreadable: false, reason: `opened by ${login}, an admin of this repository` };
  }
  return {
    trusted: false,
    unreadable: false,
    reason: `opened by ${login}, whose permission here is ${permission || 'none'}, not ${TRUSTED_PERMISSION}`,
  };
}

module.exports = {
  issueTrust,
  pullRequestTrust,
};
