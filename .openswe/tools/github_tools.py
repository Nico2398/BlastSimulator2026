"""GitHub REST API tools for the open-swe agent.

Provides functions to fetch issues, PRs, comments, and files from GitHub.
Uses GITHUB_TOKEN, DEFAULT_REPO_OWNER, and DEFAULT_REPO_NAME from the environment.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Optional


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _repo() -> tuple[str, str]:
    owner = os.environ.get("DEFAULT_REPO_OWNER", "")
    name = os.environ.get("DEFAULT_REPO_NAME", "")
    return owner, name


def _api(path: str) -> str:
    owner, name = _repo()
    return f"https://api.github.com/repos/{owner}/{name}/{path}"


def _get(url: str) -> dict | list:
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GitHub API {exc.code}: {exc.reason} — {url}") from exc


def _paginate(url: str) -> list[dict]:
    """Fetch all pages from a GitHub list endpoint."""
    items: list[dict] = []
    page = 1
    while True:
        sep = "&" if "?" in url else "?"
        data = _get(f"{url}{sep}per_page=100&page={page}")
        if not isinstance(data, list) or not data:
            break
        items.extend(data)
        if len(data) < 100:
            break
        page += 1
    return items


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
    data = _get(_api(f"issues/{issue_number}"))
    labels = ", ".join(lb["name"] for lb in data.get("labels", [])) or "none"
    assignees = ", ".join(u["login"] for u in data.get("assignees", [])) or "none"
    return (
        f"#{data['number']} [{data['state'].upper()}] {data['title']}\n"
        f"Author: {data['user']['login']}\n"
        f"Labels: {labels}\n"
        f"Assignees: {assignees}\n"
        f"Comments: {data['comments']}\n"
        f"URL: {data['html_url']}\n\n"
        f"Body:\n{data['body'] or '(no description)'}"
    )


def github_list_issue_comments(issue_number: int) -> str:
    """List all comments on a GitHub issue or PR conversation.

    Args:
        issue_number: The issue or PR number.

    Returns:
        All comments, each prefixed with author and timestamp.
    """
    comments = _paginate(_api(f"issues/{issue_number}/comments"))
    if not comments:
        return "no comments"
    lines = []
    for c in comments:
        lines.append(f"--- {c['user']['login']} at {c['created_at']} ---")
        lines.append(c["body"] or "(empty)")
    return "\n".join(lines)


def github_get_pr(pr_number: int) -> str:
    """Fetch full details of a GitHub pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Formatted string with title, state, base/head branches, body,
        changed file count, and review status.
    """
    data = _get(_api(f"pulls/{pr_number}"))
    labels = ", ".join(lb["name"] for lb in data.get("labels", [])) or "none"
    return (
        f"PR #{data['number']} [{data['state'].upper()}] {data['title']}\n"
        f"Author: {data['user']['login']}\n"
        f"Base: {data['base']['ref']}  ←  Head: {data['head']['ref']}\n"
        f"Labels: {labels}\n"
        f"Changed files: {data['changed_files']}\n"
        f"Additions: +{data['additions']}  Deletions: -{data['deletions']}\n"
        f"Mergeable: {data.get('mergeable')}\n"
        f"URL: {data['html_url']}\n\n"
        f"Body:\n{data['body'] or '(no description)'}"
    )


def github_get_pr_files(pr_number: int) -> str:
    """List files changed in a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        One file per line: status  +additions  -deletions  filename
    """
    files = _paginate(_api(f"pulls/{pr_number}/files"))
    if not files:
        return "no files changed"
    lines = [
        f"{f['status']:<9} +{f['additions']:<5} -{f['deletions']:<5} {f['filename']}"
        for f in files
    ]
    return "\n".join(lines)


def github_get_pr_reviews(pr_number: int) -> str:
    """List reviews on a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Each review with reviewer, state, and body.
    """
    reviews = _paginate(_api(f"pulls/{pr_number}/reviews"))
    if not reviews:
        return "no reviews"
    lines = []
    for r in reviews:
        lines.append(f"--- {r['user']['login']} — {r['state']} at {r['submitted_at']} ---")
        lines.append(r["body"] or "(no comment)")
    return "\n".join(lines)


def github_get_pr_review_comments(pr_number: int) -> str:
    """List inline review comments (code-level) on a pull request.

    Args:
        pr_number: The pull request number.

    Returns:
        Each comment with file, line, author, and body.
    """
    comments = _paginate(_api(f"pulls/{pr_number}/comments"))
    if not comments:
        return "no inline review comments"
    lines = []
    for c in comments:
        path = c.get("path", "?")
        line = c.get("line") or c.get("original_line", "?")
        lines.append(f"--- {c['user']['login']} on {path}:{line} ---")
        lines.append(c["body"] or "(empty)")
    return "\n".join(lines)
