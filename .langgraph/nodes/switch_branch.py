"""switch_branch nodes — non-agentic: switch between pipeline branches.

These nodes sit between agentic phases to ensure agents always start on
the correct branch without having git-switch tools themselves.

Nodes:
  switch_to_test_branch — after skeleton_writer (stubs done), switch to test_branch
  switch_to_impl_branch — after test writers, switch to impl_branch
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_force_checkout_branch, git_get_head_sha, git_push


def switch_to_test_branch(state: dict) -> dict:
    """Create test_branch from skeleton_commit_sha (which has stubs) and switch to it."""
    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", f"langgraph/tests-{issue_number}")
    skeleton_sha = state.get("skeleton_commit_sha", "")

    checkout_msg = git_force_checkout_branch(test_branch, from_ref=skeleton_sha or None)
    ok = not checkout_msg.startswith("error")

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
    ]

    if ok:
        push_msg = git_push(test_branch, force=True)
        messages = messages + [{"role": "assistant", "content": push_msg}]

    return {
        "messages": messages,
        "branch_name": test_branch,
        "switch_to_test_ok": ok,
        "retry_count": state.get("retry_count", 0) + (0 if ok else 1),
        "current_role": "switch-to-test-branch",
    }


def switch_to_impl_branch(state: dict) -> dict:
    """Create impl_branch from skeleton_commit_sha (which has stubs) and switch to it."""
    issue_number = state.get("issue_number", 0)
    impl_branch = state.get("impl_branch", f"langgraph/impl-{issue_number}")
    skeleton_sha = state.get("skeleton_commit_sha", "")

    checkout_msg = git_force_checkout_branch(impl_branch, from_ref=skeleton_sha or None)
    ok = not checkout_msg.startswith("error")

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
    ]

    if ok:
        push_msg = git_push(impl_branch, force=True)
        messages = messages + [{"role": "assistant", "content": push_msg}]

    return {
        "messages": messages,
        "branch_name": impl_branch,
        "switch_to_impl_ok": ok,
        "retry_count": state.get("retry_count", 0) + (0 if ok else 1),
        "current_role": "switch-to-impl-branch",
    }
