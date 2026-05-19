"""Git operations via gitpython.

All git operations in the LangGraph pipeline go through this module.
Uses the GITHUB_WORKSPACE env var (or CWD) as the repository root.
"""

from __future__ import annotations

import os
from pathlib import Path

import git

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")


def _repo() -> git.Repo:
    return git.Repo(_REPO_ROOT)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def git_current_branch() -> str:
    """Return the name of the currently checked-out branch."""
    repo = _repo()
    if repo.head.is_detached:
        return repo.head.commit.hexsha[:12]
    return repo.active_branch.name


def git_get_head_sha() -> str:
    """Return the full SHA of HEAD."""
    return _repo().head.commit.hexsha


def git_get_conflict_files() -> list[str]:
    """Return a list of paths with unresolved merge/cherry-pick conflicts."""
    repo = _repo()
    return list(repo.index.unmerged_blobs().keys())


# ---------------------------------------------------------------------------
# Branch operations
# ---------------------------------------------------------------------------


def git_checkout_branch(branch: str, from_ref: str | None = None) -> str:
    """Create a new branch (optionally from a specific ref) and switch to it.

    Args:
        branch: New branch name.
        from_ref: Commit SHA or branch to start from. Defaults to HEAD.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    start = repo.commit(from_ref) if from_ref else repo.head.commit
    try:
        new_branch = repo.create_head(branch, commit=start)
        new_branch.checkout()
        return f"created and switched to branch '{branch}' from {start.hexsha[:12]}"
    except git.GitCommandError as exc:
        return f"error creating branch '{branch}': {exc}"


def git_branch_exists(branch: str) -> bool:
    """Return True when a local branch exists."""
    repo = _repo()
    return any(head.name == branch for head in repo.heads)


def git_checkout_existing(branch: str) -> str:
    """Switch to an existing branch.

    Args:
        branch: Branch name.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    try:
        repo.git.checkout(branch)
        return f"switched to branch '{branch}'"
    except git.GitCommandError as exc:
        return f"error checking out '{branch}': {exc}"


# ---------------------------------------------------------------------------
# Commit / push
# ---------------------------------------------------------------------------


def git_commit(message: str) -> str:
    """Stage all changes and create a git commit.

    Args:
        message: Commit message.

    Returns:
        Short SHA and message on success, or info if nothing to commit.
    """
    repo = _repo()
    if not repo.is_dirty(untracked_files=True):
        return "nothing to commit — working tree clean"
    repo.git.add("-A")
    commit = repo.index.commit(message)
    return f"[{commit.hexsha[:12]}] {message}"


def git_push(branch: str) -> str:
    """Push a branch to origin.

    Args:
        branch: Branch name to push.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    try:
        result = repo.git.push("--set-upstream", "origin", branch)
        return result or f"pushed '{branch}' to origin"
    except git.GitCommandError as exc:
        return f"error pushing '{branch}': {exc}"


# ---------------------------------------------------------------------------
# Cherry-pick
# ---------------------------------------------------------------------------


def git_cherry_pick(commit_sha: str) -> tuple[bool, list[str]]:
    """Cherry-pick a commit onto the current branch.

    Args:
        commit_sha: The full or short commit SHA to cherry-pick.

    Returns:
        (success, conflict_files) — success=True means clean pick.
    """
    repo = _repo()
    try:
        repo.git.cherry_pick(commit_sha)
        return True, []
    except git.GitCommandError:
        conflicts = git_get_conflict_files()
        return False, conflicts


def git_abort_cherry_pick() -> str:
    """Abort an in-progress cherry-pick."""
    repo = _repo()
    try:
        repo.git.cherry_pick("--abort")
        return "cherry-pick aborted"
    except git.GitCommandError as exc:
        return f"error aborting cherry-pick: {exc}"


def git_continue_cherry_pick(message: str) -> str:
    """Stage all resolved files and finish the cherry-pick.

    Args:
        message: Commit message for the resolved cherry-pick.

    Returns:
        Confirmation message with new commit SHA.
    """
    repo = _repo()
    repo.git.add("-A")
    try:
        repo.git.cherry_pick("--continue", "--no-edit")
        sha = repo.head.commit.hexsha[:12]
        return f"cherry-pick continued: [{sha}]"
    except git.GitCommandError:
        # Fall back to a regular commit if --continue fails
        commit = repo.index.commit(message)
        return f"cherry-pick resolved via commit: [{commit.hexsha[:12]}]"
