"""setup_branches node — non-agentic: create all pipeline branches.

Called after planner, before skeleton_writer. Creates:
  skeleton_branch — from main, for empty stubs
  full_branch     — from main, merge target for tests + impl

test_branch and impl_branch are created later by switch_to_test_branch
and switch_to_impl_branch (after stubs are committed).
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_force_checkout_branch, git_get_head_sha, git_push


def setup_branches(state: dict) -> dict:
    """Create skeleton_branch from main and full_branch from same commit."""
    issue_number = state.get("issue_number", 0)
    skeleton_branch = state.get("skeleton_branch", f"langgraph/skeleton-{issue_number}")
    full_branch = state.get("full_branch", f"langgraph/full-{issue_number}")

    # Create skeleton_branch from HEAD (main), switch to it.
    checkout_msg = git_force_checkout_branch(skeleton_branch)
    ok = not checkout_msg.startswith("error")

    # Record the commit SHA before any stubs are written.
    skeleton_sha = git_get_head_sha()

    if ok:
        push_msg = git_push(skeleton_branch, force=True)
    else:
        push_msg = ""

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
        {"role": "assistant", "content": push_msg},
    ]

    return {
        "messages": messages,
        "skeleton_branch": skeleton_branch,
        "branch_name": skeleton_branch,
        "full_branch": full_branch,
        "skeleton_commit_sha": skeleton_sha,
        "setup_branches_ok": ok,
        "retry_count": state.get("retry_count", 0) + (0 if ok else 1),
        "current_role": "setup-branches",
    }
