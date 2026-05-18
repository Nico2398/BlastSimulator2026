"""GitHub write API tools for the LangGraph pipeline.

Provides functions to create PRs, post comments, and manage labels.
Uses GITHUB_TOKEN, DEFAULT_REPO_OWNER, and DEFAULT_REPO_NAME from env.
"""

import json
import os
import urllib.error
import urllib.request


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    }


def _repo() -> tuple[str, str]:
    owner = os.environ.get("DEFAULT_REPO_OWNER", "")
    name = os.environ.get("DEFAULT_REPO_NAME", "")
    return owner, name


def _api(path: str) -> str:
    owner, name = _repo()
    return f"https://api.github.com/repos/{owner}/{name}/{path}"


_TIMEOUT = 30


def _request(method: str, url: str, body: dict | None = None) -> dict | list | None:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=_headers(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"GitHub API {exc.code} {exc.reason} — {url}: {exc.read().decode()}"
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"GitHub API network error — {url}: {exc}") from exc


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
    data = _request("POST", _api("pulls"), {
        "title": title,
        "head": branch,
        "base": base,
        "body": body,
    })
    return f"PR #{data['number']} created: {data['html_url']}"


def github_post_comment(issue_number: int, body: str) -> str:
    """Post a comment on an issue or PR.

    Args:
        issue_number: Issue or PR number.
        body: Comment body (markdown).

    Returns:
        Comment URL on success.
    """
    data = _request("POST", _api(f"issues/{issue_number}/comments"), {"body": body})
    return f"Comment posted: {data['html_url']}"


def github_add_label(issue_number: int, label: str) -> str:
    """Add a label to an issue or PR.

    Args:
        issue_number: Issue or PR number.
        label: Label name to add.

    Returns:
        Confirmation message.
    """
    _request("POST", _api(f"issues/{issue_number}/labels"), {"labels": [label]})
    return f"Label '{label}' added to #{issue_number}"


def github_remove_label(issue_number: int, label: str) -> str:
    """Remove a label from an issue or PR.

    Args:
        issue_number: Issue or PR number.
        label: Label name to remove.

    Returns:
        Confirmation message.
    """
    try:
        _request("DELETE", _api(f"issues/{issue_number}/labels/{label}"))
        return f"Label '{label}' removed from #{issue_number}"
    except RuntimeError as exc:
        if "404" in str(exc):
            return f"Label '{label}' was not present on #{issue_number}"
        raise
