"""GitHub read-only tools for the LangGraph pipeline.

Provides functions to fetch issues, PRs, comments, and files from GitHub.
Uses GITHUB_TOKEN, DEFAULT_REPO_OWNER, and DEFAULT_REPO_NAME from the environment.
All requests go through PyGithub — no direct HTTP calls.
"""

from __future__ import annotations

import os

from github import Github, GithubException


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _client() -> Github:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("GITHUB_TOKEN environment variable is not set")
    return Github(token)


def _repo():
    owner = os.environ.get("DEFAULT_REPO_OWNER", "")
    name = os.environ.get("DEFAULT_REPO_NAME", "")
    if not owner or not name:
        raise RuntimeError(
            "DEFAULT_REPO_OWNER and DEFAULT_REPO_NAME must both be set"
        )
    return _client().get_repo(f"{owner}/{name}")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def github_get_issue(issue_number: int) -> str:
    """Fetch full details of a GitHub issue, including body, labels, and state.

    Args:
        issue_number: The issue or PR number.

    Returns:
        Formatted string with title, state, labels, body, and comment count.
    """
    try:
        repo = _repo()
        issue = repo.get_issue(issue_number)
    except GithubException as exc:
        raise RuntimeError(f"GitHub error fetching issue #{issue_number}: {exc.data}") from exc
    labels = ", ".join(lb.name for lb in issue.labels) or "none"
    assignees = ", ".join(u.login for u in issue.assignees) or "none"
    return (
        f"#{issue.number} [{issue.state.upper()}] {issue.title}\n"
        f"Author: {issue.user.login}\n"
        f"Labels: {labels}\n"
        f"Assignees: {assignees}\n"
        f"Comments: {issue.comments}\n"
        f"URL: {issue.html_url}\n\n"
        f"Body:\n{issue.body or '(no description)'}"
    )


def github_list_issue_comments(issue_number: int) -> str:
    """List all comments on a GitHub issue or PR conversation.

    Args:
        issue_number: The issue or PR number.

    Returns:
        All comments, each prefixed with author and timestamp.
    """
    try:
        repo = _repo()
        issue = repo.get_issue(issue_number)
        comments = list(issue.get_comments())
    except GithubException as exc:
        raise RuntimeError(f"GitHub error listing comments on #{issue_number}: {exc.data}") from exc
    if not comments:
        return "no comments"
    lines = []
    for c in comments:
        lines.append(f"--- {c.user.login} at {c.created_at.isoformat()} ---")
        lines.append(c.body or "(empty)")
    return "\n".join(lines)


def github_get_pr_reviews(pr_number: int) -> str:
    """List reviews on a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Each review with reviewer, state, and body.
    """
    try:
        repo = _repo()
        pr = repo.get_pull(pr_number)
        reviews = list(pr.get_reviews())
    except GithubException as exc:
        raise RuntimeError(f"GitHub error fetching reviews for PR #{pr_number}: {exc.data}") from exc
    if not reviews:
        return "no reviews"
    lines = []
    for r in reviews:
        lines.append(f"--- {r.user.login} — {r.state} at {r.submitted_at.isoformat()} ---")
        lines.append(r.body or "(no comment)")
    return "\n".join(lines)


def github_get_pr_review_comments(pr_number: int) -> str:
    """List inline review comments (code-level) on a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Each comment with file, line, author, and body.
    """
    try:
        repo = _repo()
        pr = repo.get_pull(pr_number)
        comments = list(pr.get_review_comments())
    except GithubException as exc:
        raise RuntimeError(
            f"GitHub error fetching review comments for PR #{pr_number}: {exc.data}"
        ) from exc
    if not comments:
        return "no inline review comments"
    lines = []
    for c in comments:
        line = getattr(c, "line", None) or getattr(c, "original_line", "?")
        lines.append(f"--- {c.user.login} on {c.path}:{line} ---")
        lines.append(c.body or "(empty)")
    return "\n".join(lines)


def github_get_pr(pr_number: int) -> str:
    """Fetch full details of a GitHub pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Formatted string with title, state, base/head branches, body,
        and reviewer list.
    """
    try:
        repo = _repo()
        pr = repo.get_pull(pr_number)
    except GithubException as exc:
        raise RuntimeError(f"GitHub error fetching PR #{pr_number}: {exc.data}") from exc
    reviewers = ", ".join(u.login for u in pr.requested_reviewers) or "none"
    labels = ", ".join(lb.name for lb in pr.labels) or "none"
    return (
        f"PR #{pr.number} [{pr.state.upper()}] {pr.title}\n"
        f"Author: {pr.user.login}\n"
        f"Base: {pr.base.ref}  ←  Head: {pr.head.ref}\n"
        f"Labels: {labels}\n"
        f"Reviewers: {reviewers}\n"
        f"Mergeable: {pr.mergeable}\n"
        f"URL: {pr.html_url}\n\n"
        f"Body:\n{pr.body or '(no description)'}"
    )


def github_get_pr_files(pr_number: int) -> str:
    """List files changed in a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Each changed file with its status and patch summary.
    """
    try:
        repo = _repo()
        pr = repo.get_pull(pr_number)
        files = list(pr.get_files())
    except GithubException as exc:
        raise RuntimeError(f"GitHub error fetching PR files for #{pr_number}: {exc.data}") from exc
    if not files:
        return "no changed files"
    lines = []
    for f in files:
        lines.append(f"[{f.status.upper()}] {f.filename}  (+{f.additions} -{f.deletions})")
        if f.patch:
            lines.append(f.patch[:500] + ("…" if len(f.patch) > 500 else ""))
    return "\n".join(lines)
