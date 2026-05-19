"""GitHub write operations for the LangGraph pipeline.

Provides direct Python functions for non-agentic node use:
  - github_create_pr    used by open_pr node directly
  - github_add_label    available to agents + used by open_pr
  - github_remove_label available to agents + used by open_pr

Replaced by langchain_community toolkit (see tools/langchain_github.py):
  - github_post_comment → "Comment on Issue"

Uses GITHUB_TOKEN, DEFAULT_REPO_OWNER, and DEFAULT_REPO_NAME from env.
All operations go through PyGithub — no direct HTTP calls.
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


def github_create_pr(branch: str, title: str, body: str, base: str = "main") -> str:
    """Create a pull request.

    Args:
        branch: Head branch name (e.g. 'langgraph/fix-navmesh-42').
        title: PR title.
        body: PR body — MUST include 'Closes #<issue_number>'.
        base: Base branch to merge into (default: 'main').

    Returns:
        PR URL and number on success.
    """
    try:
        repo = _repo()
        pr = repo.create_pull(title=title, body=body, head=branch, base=base)
        return f"PR #{pr.number} created: {pr.html_url}"
    except GithubException as exc:
        raise RuntimeError(f"failed to create PR: {exc.data}") from exc


def github_add_label(issue_number: int, label: str) -> str:
    """Add a label to an issue or PR.

    Args:
        issue_number: Issue or PR number.
        label: Label name to add.

    Returns:
        Confirmation message.
    """
    try:
        repo = _repo()
        issue = repo.get_issue(issue_number)
        issue.add_to_labels(label)
        return f"Label '{label}' added to #{issue_number}"
    except GithubException as exc:
        raise RuntimeError(f"failed to add label '{label}' to #{issue_number}: {exc.data}") from exc


def github_remove_label(issue_number: int, label: str) -> str:
    """Remove a label from an issue or PR.

    Args:
        issue_number: Issue or PR number.
        label: Label name to remove.

    Returns:
        Confirmation message.
    """
    try:
        repo = _repo()
        issue = repo.get_issue(issue_number)
        issue.remove_from_labels(label)
        return f"Label '{label}' removed from #{issue_number}"
    except GithubException as exc:
        if exc.status == 404:
            return f"Label '{label}' was not present on #{issue_number}"
        raise RuntimeError(f"failed to remove label '{label}' from #{issue_number}: {exc.data}") from exc
