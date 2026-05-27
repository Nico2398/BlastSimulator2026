"""Shell and git tools for the LangGraph pipeline agents.

Coding agents (implementer, refactorer, test-writer, reviewer) use these
to run validation commands, commit changes, and push branches.

Git operations delegate to tools.git_tools (gitpython-based).

SECURITY: run_shell blocks git branch-switching/writing commands so that
agentic nodes cannot bypass the non-agentic branch management nodes.
"""

import os
import re
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

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE") or str(
    Path(__file__).parent.parent.parent
)
_CMD_TIMEOUT = 300  # 5 minutes max per shell command

# Git commands that modify branch state — blocked in run_shell so agentic
# nodes cannot bypass the non-agentic branch management nodes.
# Read-only git commands (diff, log, show, status, blame) are allowed.
_BLOCKED_GIT_PATTERNS = [
    re.compile(r"^\s*git\s+(?:checkout|switch)\b"),
    re.compile(r"^\s*git\s+branch\b"),
    re.compile(r"^\s*git\s+merge\b"),
    re.compile(r"^\s*git\s+rebase\b"),
    re.compile(r"^\s*git\s+cherry-pick\b"),
    re.compile(r"^\s*git\s+reset\b"),
    re.compile(r"^\s*git\s+commit\b"),
    re.compile(r"^\s*git\s+push\b"),
    re.compile(r"^\s*git\s+pull\b"),
    re.compile(r"^\s*git\s+fetch\b"),
    re.compile(r"^\s*git\s+stash\b"),
    re.compile(r"^\s*git\s+tag\b"),
    re.compile(r"^\s*git\s+add\b"),
    re.compile(r"^\s*git\s+rm\b"),
    re.compile(r"^\s*git\s+mv\b"),
    re.compile(r"^\s*git\s+am\b"),
    re.compile(r"^\s*git\s+apply\b"),
]


def _is_git_blocked(cmd: str) -> bool:
    """Return True if the command is a git write/switch operation."""
    stripped = cmd.strip()
    # Allow read-only git commands
    if re.match(r"^\s*git\s+(?:diff|log|show|status|blame|shortlog)\b", stripped):
        return False
    return any(p.search(stripped) for p in _BLOCKED_GIT_PATTERNS)


def run_shell(cmd: str, cwd: str | None = None) -> str:
    """Run a shell command in the repository.

    Args:
        cmd: Shell command to execute (e.g. 'npm run validate', 'npx vitest run').
        cwd: Working directory relative to repo root (default: repo root).

    Returns:
        Combined stdout + stderr output, with exit code on failure.
    """
    if _is_git_blocked(cmd):
        return (
            f"error: git write/switch commands are blocked in run_shell. "
            f"Branch management is handled by non-agentic graph nodes.\n"
            f"Use read-only git commands (diff, log, show, status) if needed."
        )
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
