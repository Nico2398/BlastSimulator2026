"""Backlog management tools for BlastSimulator2026.

Reads and writes .github/skills/backlog/backlog.json in the target repository
via PyGithub. Relies on GITHUB_TOKEN, DEFAULT_REPO_OWNER, and
DEFAULT_REPO_NAME environment variables (all injected by the workflow).
All GitHub operations go through PyGithub — no direct HTTP calls.
"""

import json
import os
from typing import Optional

from github import Github, GithubException

_BACKLOG_PATH = ".github/skills/backlog/backlog.json"


# ---------------------------------------------------------------------------
# PyGithub helpers
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


def _get_backlog() -> tuple[Optional[list[dict]], Optional[str]]:
    """Fetch backlog.json from the repo via PyGithub. Returns (tasks, sha)."""
    try:
        repo = _repo()
        content_file = repo.get_contents(_BACKLOG_PATH)
    except GithubException as exc:
        return None, f"error: GitHub error reading backlog: {exc.data}"
    tasks = json.loads(content_file.decoded_content.decode("utf-8"))
    return tasks, content_file.sha


def _put_backlog(tasks: list[dict], sha: str, message: str) -> Optional[str]:
    """Commit updated backlog.json back to the default branch via PyGithub."""
    content = json.dumps(tasks, indent=2) + "\n"
    try:
        repo = _repo()
        repo.update_file(_BACKLOG_PATH, message, content, sha)
    except GithubException as exc:
        return f"error: GitHub error writing backlog: {exc.data}"
    return None


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
    tasks, err = _get_backlog()
    if tasks is None:
        return err
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
    tasks, err = _get_backlog()
    if tasks is None:
        return err
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
    tasks, sha_or_err = _get_backlog()
    if tasks is None:
        return sha_or_err
    in_progress = [t for t in tasks if t["status"] == "in-progress"]
    if in_progress:
        return f"error: task {in_progress[0]['id']} is already in-progress — finish it first"
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    if task["status"] != "pending":
        return f"error: task {task_id} is '{task['status']}', not 'pending'"
    task["status"] = "in-progress"
    put_err = _put_backlog(tasks, sha_or_err, f"backlog: start {task_id}")
    if put_err:
        return put_err
    return f"ok: task {task_id} is now in-progress"


def backlog_done(task_id: str, pr_number: Optional[int] = None) -> str:
    """Mark a task as done. Call after the PR is merged.

    Args:
        task_id: The task ID to mark done (e.g. '2.1').
        pr_number: Optional PR number to record against the task.

    Returns:
        Confirmation or error message.
    """
    tasks, sha_or_err = _get_backlog()
    if tasks is None:
        return sha_or_err
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "done"
    if pr_number is not None:
        task["closedInPR"] = pr_number
    msg = f"backlog: done {task_id}" + (f" pr#{pr_number}" if pr_number else "")
    put_err = _put_backlog(tasks, sha_or_err, msg)
    if put_err:
        return put_err
    suffix = f" (PR #{pr_number})" if pr_number else ""
    return f"ok: task {task_id} marked done{suffix}"


def backlog_block(task_id: str) -> str:
    """Mark a task as blocked.

    Args:
        task_id: The task ID to block (e.g. '2.1').

    Returns:
        Confirmation or error message.
    """
    tasks, sha_or_err = _get_backlog()
    if tasks is None:
        return sha_or_err
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "blocked"
    put_err = _put_backlog(tasks, sha_or_err, f"backlog: block {task_id}")
    if put_err:
        return put_err
    return f"ok: task {task_id} marked blocked"


def backlog_reset(task_id: str) -> str:
    """Reset a task back to pending status.

    Args:
        task_id: The task ID to reset (e.g. '2.1').

    Returns:
        Confirmation or error message.
    """
    tasks, sha_or_err = _get_backlog()
    if tasks is None:
        return sha_or_err
    task = next((t for t in tasks if t["id"] == task_id), None)
    if task is None:
        return f"error: task {task_id} not found"
    task["status"] = "pending"
    put_err = _put_backlog(tasks, sha_or_err, f"backlog: reset {task_id}")
    if put_err:
        return put_err
    return f"ok: task {task_id} reset to pending"


def backlog_stats() -> str:
    """Return backlog statistics.

    Returns:
        Stats in format: done:N in-progress:N pending:N blocked:N total:N
    """
    tasks, err = _get_backlog()
    if tasks is None:
        return err
    done = sum(1 for t in tasks if t["status"] == "done")
    in_progress = sum(1 for t in tasks if t["status"] == "in-progress")
    pending = sum(1 for t in tasks if t["status"] == "pending")
    blocked = sum(1 for t in tasks if t["status"] == "blocked")
    return (
        f"done:{done} in-progress:{in_progress} "
        f"pending:{pending} blocked:{blocked} total:{len(tasks)}"
    )
