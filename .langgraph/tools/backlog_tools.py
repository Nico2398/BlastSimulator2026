"""Backlog management tools for BlastSimulator2026.

Reads and writes .github/skills/backlog/backlog.json in the target repository
via the GitHub REST API. Relies on GITHUB_TOKEN, DEFAULT_REPO_OWNER, and
DEFAULT_REPO_NAME environment variables (all injected by the workflow).
"""

import base64
import json
import os
import urllib.error
import urllib.request
from typing import Optional

_BACKLOG_PATH = ".github/skills/backlog/backlog.json"


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------


def _headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    }


def _contents_url() -> str:
    owner = os.environ.get("DEFAULT_REPO_OWNER", "")
    name = os.environ.get("DEFAULT_REPO_NAME", "")
    return f"https://api.github.com/repos/{owner}/{name}/contents/{_BACKLOG_PATH}"


def _get_backlog() -> tuple[list[dict], str]:
    """Fetch backlog.json from the repo. Returns (tasks, sha)."""
    req = urllib.request.Request(_contents_url(), headers=_headers())
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GitHub API error {exc.code}: {exc.reason}") from exc
    content = base64.b64decode(data["content"]).decode("utf-8")
    return json.loads(content), data["sha"]


def _put_backlog(tasks: list[dict], sha: str, message: str) -> None:
    """Commit updated backlog.json back to the default branch."""
    content_b64 = base64.b64encode(
        (json.dumps(tasks, indent=2) + "\n").encode("utf-8")
    ).decode("utf-8")
    body = json.dumps({"message": message, "content": content_b64, "sha": sha}).encode("utf-8")
    req = urllib.request.Request(
        _contents_url(), data=body, headers=_headers(), method="PUT"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GitHub API error {exc.code}: {exc.reason}") from exc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolved_blockers(tasks: list[dict], task: dict) -> bool:
    done_ids = {t["id"] for t in tasks if t["status"] == "done"}
    return all(bid in done_ids for bid in task.get("blockedBy", []))


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


def backlog_list(status: Optional[str] = None, chapter: Optional[int] = None) -> str:
    """List backlog tasks, optionally filtered by status or chapter.

    Args:
        status: Filter by status — 'pending', 'in-progress', 'done', or 'blocked'.
        chapter: Filter to a specific chapter number.

    Returns:
        One task per line: id:X chapter:N status:S title:T
    """
    tasks, _ = _get_backlog()
    result = tasks
    if status:
        result = [t for t in result if t["status"] == status]
    if chapter is not None:
        result = [t for t in result if t["chapter"] == chapter]
    if not result:
        return "no tasks found"
    return "\n".join(
        f"id:{t['id']} chapter:{t['chapter']} status:{t['status']} title:{t['title']}"
        for t in result
    )


def backlog_next() -> str:
    """Return the next available pending task, respecting blockedBy ordering.

    Returns:
        Task details (id, chapter, title, files, testFile, blockedBy) or a
        'no pending tasks available' message.
    """
    tasks, _ = _get_backlog()
    candidates = [
        t for t in tasks
        if t["status"] == "pending" and _resolved_blockers(tasks, t)
    ]
    if not candidates:
        return "no pending tasks available"
    candidates.sort(key=lambda t: (t["chapter"], tasks.index(t)))
    t = candidates[0]
    files = ",".join(t.get("files") or []) or "none"
    test_file = t.get("testFile") or "none"
    blocked_by = ",".join(t.get("blockedBy") or []) or "none"
    return (
        f"id:{t['id']}\n"
        f"chapter:{t['chapter']}\n"
        f"title:{t['title']}\n"
        f"files:{files}\n"
        f"testFile:{test_file}\n"
        f"blockedBy:{blocked_by}"
    )


def backlog_start(task_id: str) -> str:
    """Mark a task as in-progress. Fails if another task is already in-progress.

    Args:
        task_id: The task ID to start (e.g. '2.1').

    Returns:
        Confirmation or error message.
    """
    tasks, sha = _get_backlog()
    in_progress = [t for t in tasks if t["status"] == "in-progress"]
    if in_progress:
        return f"error: task {in_progress[0]['id']} is already in-progress — finish it first"
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    if task["status"] != "pending":
        return f"error: task {task_id} is '{task['status']}', not 'pending'"
    task["status"] = "in-progress"
    _put_backlog(tasks, sha, f"backlog: start {task_id}")
    return f"ok: task {task_id} is now in-progress"


def backlog_done(task_id: str, pr_number: Optional[int] = None) -> str:
    """Mark a task as done. Call after the PR is merged.

    Args:
        task_id: The task ID to mark done (e.g. '2.1').
        pr_number: Optional PR number to record against the task.

    Returns:
        Confirmation or error message.
    """
    tasks, sha = _get_backlog()
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "done"
    if pr_number is not None:
        task["closedInPR"] = pr_number
    msg = f"backlog: done {task_id}" + (f" pr#{pr_number}" if pr_number else "")
    _put_backlog(tasks, sha, msg)
    suffix = f" (PR #{pr_number})" if pr_number else ""
    return f"ok: task {task_id} marked done{suffix}"


def backlog_block(task_id: str) -> str:
    """Mark a task as blocked.

    Args:
        task_id: The task ID to block (e.g. '2.1').

    Returns:
        Confirmation or error message.
    """
    tasks, sha = _get_backlog()
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "blocked"
    _put_backlog(tasks, sha, f"backlog: block {task_id}")
    return f"ok: task {task_id} marked blocked"


def backlog_reset(task_id: str) -> str:
    """Reset a task back to pending status.

    Args:
        task_id: The task ID to reset (e.g. '2.1').

    Returns:
        Confirmation or error message.
    """
    tasks, sha = _get_backlog()
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "pending"
    _put_backlog(tasks, sha, f"backlog: reset {task_id}")
    return f"ok: task {task_id} reset to pending"


def backlog_stats() -> str:
    """Return backlog statistics.

    Returns:
        Stats in format: done:N in-progress:N pending:N blocked:N total:N
    """
    tasks, _ = _get_backlog()
    done = sum(1 for t in tasks if t["status"] == "done")
    in_progress = sum(1 for t in tasks if t["status"] == "in-progress")
    pending = sum(1 for t in tasks if t["status"] == "pending")
    blocked = sum(1 for t in tasks if t["status"] == "blocked")
    return (
        f"done:{done} in-progress:{in_progress} "
        f"pending:{pending} blocked:{blocked} total:{len(tasks)}"
    )
