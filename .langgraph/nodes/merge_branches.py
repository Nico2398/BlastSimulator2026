"""merge_branches node — non-agentic: merge test + impl into full_branch.

After implementer finishes on impl_branch and test writers finish on
test_branch, this node:
1. Switches to full_branch (from skeleton_commit_sha).
2. Merges both test_branch and impl_branch into full_branch in one step.
3. On clean merge → pushes and continues to test_runner.
4. On conflicts → records conflict paths in state and routes to conflict_resolver.
5. Computes the diff vs skeleton_commit_sha for downstream agents.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import git as gitpy

from tools.git_tools import (
    git_checkout_existing,
    git_get_head_sha,
    git_get_conflict_files,
    git_push,
    git_diff_since,
    git_write_diff_to_file,
)
from nodes.merge_helpers import _assess_risk_tier


_REPO_ROOT = str(Path(__file__).parent.parent.parent)


def _repo() -> gitpy.Repo:
    return gitpy.Repo(_REPO_ROOT, search_parent_directories=True)


def merge_branches(state: dict) -> dict:
    """Merge test_branch and impl_branch into full_branch."""
    issue_number = state.get("issue_number", 0)
    full_branch = state.get("full_branch", f"langgraph/full-{issue_number}")
    test_branch = state.get("test_branch", f"langgraph/tests-{issue_number}")
    impl_branch = state.get("impl_branch", f"langgraph/impl-{issue_number}")
    skeleton_sha = state.get("skeleton_commit_sha", "")

    if not skeleton_sha:
        return {
            "merge_ok": False,
            "merge_conflicts": [],
            "current_role": "merge-branches",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": "error: skeleton_commit_sha not set — cannot merge"}
            ],
        }

    # Switch to full_branch.
    checkout_msg = git_checkout_existing(full_branch)
    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
    ]

    # Merge both branches in one operation.
    repo = _repo()
    try:
        repo.git.merge(test_branch, impl_branch, "--no-edit")
        ok = True
        conflicts = []
        merge_msg = f"merged test + implementation branches for #{issue_number}"
    except gitpy.GitCommandError:
        conflicts = git_get_conflict_files()
        ok = False
        merge_msg = f"merge conflicts in: {', '.join(conflicts)}" if conflicts else "merge conflict (unknown files)"
        # Do NOT abort — leave conflict markers for conflict_resolver.

    merge_sha = git_get_head_sha()
    messages = messages + [
        {"role": "assistant", "content": merge_msg},
    ]

    # Compute diff vs skeleton for downstream agents.
    git_diff = ""
    diff_dir = ""
    changed_files: list[str] = []
    risk_tier = "full"
    if ok and skeleton_sha:
        diff_dir, changed_files = git_write_diff_to_file(skeleton_sha)
        git_diff, _ = git_diff_since(skeleton_sha)
        if len(git_diff) > 2000:
            git_diff = git_diff[:2000] + f"\n... ({len(git_diff) - 2000} chars omitted)"
        risk_tier = _assess_risk_tier(changed_files, git_diff)
        messages = messages + [
            {"role": "assistant", "content": f"diff: {len(changed_files)} files changed, risk_tier={risk_tier}, patches at {diff_dir}"}
        ]

    if ok:
        push_result = git_push(full_branch, force=True)
        messages = messages + [{"role": "assistant", "content": push_result}]

    return {
        "merge_ok": ok,
        "merge_conflicts": conflicts,
        "merge_sha": merge_sha,
        "branch_name": full_branch,
        "current_role": "merge-branches",
        "messages": messages,
        "changed_files": changed_files,
        "git_diff": git_diff,
        "diff_dir": diff_dir,
        "risk_tier": risk_tier,
    }
