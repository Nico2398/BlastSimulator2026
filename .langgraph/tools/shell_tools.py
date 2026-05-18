"""Shell and git tools for the LangGraph pipeline agents.

Coding agents (implementer, refactorer, test-writer, reviewer) use these
to run validation commands, commit changes, and push branches.
"""

import os
import subprocess

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")
_CMD_TIMEOUT = 300  # 5 minutes max per shell command


def run_shell(cmd: str, cwd: str | None = None) -> str:
    """Run a shell command in the repository.

    Args:
        cmd: Shell command to execute (e.g. 'npm run validate', 'npx vitest run').
        cwd: Working directory relative to repo root (default: repo root).

    Returns:
        Combined stdout + stderr output, with exit code on failure.
    """
    work_dir = os.path.join(_REPO_ROOT, cwd) if cwd else _REPO_ROOT
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=work_dir,
            timeout=_CMD_TIMEOUT,
            env={**os.environ},
        )
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            return f"[exit {result.returncode}]\n{output}"
        return output or "(no output)"
    except subprocess.TimeoutExpired:
        return f"error: command timed out after {_CMD_TIMEOUT}s: {cmd}"
    except Exception as exc:
        return f"error running command: {exc}"


def git_commit(message: str) -> str:
    """Stage all changes and create a git commit.

    Args:
        message: Commit message.

    Returns:
        Git output or error message.
    """
    result_add = subprocess.run(
        ["git", "add", "-A"],
        capture_output=True, text=True, cwd=_REPO_ROOT
    )
    if result_add.returncode != 0:
        return f"error staging: {result_add.stderr}"

    result_commit = subprocess.run(
        ["git", "commit", "-m", message],
        capture_output=True, text=True, cwd=_REPO_ROOT
    )
    if result_commit.returncode != 0:
        stderr = result_commit.stderr
        if "nothing to commit" in stderr or "nothing added" in stderr:
            return "nothing to commit — working tree clean"
        return f"error committing: {stderr}"
    return result_commit.stdout.strip()


def git_push(branch: str) -> str:
    """Push a branch to the remote origin.

    Args:
        branch: Branch name to push (e.g. 'langgraph/fix-navmesh-42').

    Returns:
        Git output or error message.
    """
    result = subprocess.run(
        ["git", "push", "--set-upstream", "origin", branch],
        capture_output=True, text=True, cwd=_REPO_ROOT
    )
    if result.returncode != 0:
        return f"error pushing: {result.stderr}"
    return result.stdout.strip() or result.stderr.strip()


def git_checkout_branch(branch: str) -> str:
    """Create and switch to a new branch (or switch if it already exists).

    Args:
        branch: Branch name (e.g. 'langgraph/implement-navmesh-42').

    Returns:
        Git output or error message.
    """
    # Try creating new branch
    result = subprocess.run(
        ["git", "checkout", "-b", branch],
        capture_output=True, text=True, cwd=_REPO_ROOT
    )
    if result.returncode == 0:
        return f"created and switched to branch '{branch}'"
    # If it already exists, just switch
    result2 = subprocess.run(
        ["git", "checkout", branch],
        capture_output=True, text=True, cwd=_REPO_ROOT
    )
    if result2.returncode == 0:
        return f"switched to branch '{branch}'"
    return f"error: {result.stderr} / {result2.stderr}"
