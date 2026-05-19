"""Shell and git tools for the LangGraph pipeline agents.

Coding agents (implementer, refactorer, test-writer, reviewer) use these
to run validation commands, commit changes, and push branches.

Git operations delegate to tools.git_tools (gitpython-based).
"""

import os
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from git_tools import (  # noqa: E402
    git_commit as _git_commit,
    git_push as _git_push,
    git_checkout_branch as _git_checkout_branch,
)

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
            cwd=work_dir,
            timeout=_CMD_TIMEOUT,
            env={**os.environ},
        )
        stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        output = (stdout + stderr).strip()
        if result.returncode != 0:
            return f"[exit {result.returncode}]\n{output}"
        return output or "(no output)"
    except subprocess.TimeoutExpired:
        return f"error: command timed out after {_CMD_TIMEOUT}s: {cmd}"
    except Exception as exc:
        return f"error running command: {exc}"


def git_commit(message: str) -> str:
    """Stage all changes and create a git commit (via gitpython).

    Args:
        message: Commit message.

    Returns:
        Short SHA + message on success, or 'nothing to commit'.
    """
    return _git_commit(message)


def git_push(branch: str) -> str:
    """Push a branch to origin (via gitpython).

    Args:
        branch: Branch name to push (e.g. 'langgraph/fix-navmesh-42').

    Returns:
        Git output or error message.
    """
    return _git_push(branch)


def git_checkout_branch(branch: str) -> str:
    """Create and switch to a new branch (via gitpython).

    Args:
        branch: Branch name (e.g. 'langgraph/implement-navmesh-42').

    Returns:
        Git output or error message.
    """
    return _git_checkout_branch(branch)
