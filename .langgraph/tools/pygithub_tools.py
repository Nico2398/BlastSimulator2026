"""GitHub write operations via PyGithub.

Replaces the urllib-based implementations in github_write.py for operations
that benefit from the richer PyGithub object model (PR creation, labels).
Uses GITHUB_TOKEN, DEFAULT_REPO_OWNER, and DEFAULT_REPO_NAME from env.
"""

from __future__ import annotations

import os

from github import Github, GithubException


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


def create_pr(
    branch: str,
    title: str,
    body: str,
    base: str = "main",
    draft: bool = False,
) -> tuple[int, str]:
    """Create a pull request.

    Args:
        branch: Head branch name.
        title: PR title.
        body: PR body — must include 'Closes #<N>'.
        base: Base branch (default: 'main').
        draft: Open as draft PR (default: False).

    Returns:
        (pr_number, html_url)
    """
    repo = _repo()
    try:
        pr = repo.create_pull(
            title=title,
            body=body,
            head=branch,
            base=base,
            draft=draft,
        )
        return pr.number, pr.html_url
    except GithubException as exc:
        raise RuntimeError(f"failed to create PR: {exc.data}") from exc


def add_label(issue_number: int, label: str) -> str:
    """Add a label to an issue or PR.

    Args:
        issue_number: Issue or PR number.
        label: Label name.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    issue = repo.get_issue(issue_number)
    issue.add_to_labels(label)
    return f"label '{label}' added to #{issue_number}"


def remove_label(issue_number: int, label: str) -> str:
    """Remove a label from an issue or PR (no-op if absent).

    Args:
        issue_number: Issue or PR number.
        label: Label name.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    issue = repo.get_issue(issue_number)
    try:
        issue.remove_from_labels(label)
        return f"label '{label}' removed from #{issue_number}"
    except GithubException as exc:
        if exc.status == 404:
            return f"label '{label}' was not present on #{issue_number}"
        raise
