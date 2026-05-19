"""cherry_pick node — non-agentic: merge implementer work onto test branch.

After the implementer finishes on `impl_branch`, this node:
1. Switches back to `test_branch`.
2. Cherry-picks `impl_commit_sha` onto it.
3. On a clean pick → pushes and continues to qualimetry.
4. On conflicts → records conflict paths in state and routes to conflict_resolver.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_checkout_existing, git_cherry_pick, git_push


def cherry_pick(state: dict) -> dict:
    """Cherry-pick the implementation commit onto the test branch."""
    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", state.get("branch_name", ""))
    impl_sha = state.get("impl_commit_sha", "")

    if not impl_sha:
        return {
            "cherry_pick_ok": False,
            "cherry_pick_conflicts": [],
            "current_role": "cherry-pick",
            "messages": state.get("messages", []) + [
                {"role": "assistant",
                 "content": "error: impl_commit_sha not set — cannot cherry-pick"}
            ],
        }

    # Switch to the test branch so cherry-pick lands there.
    checkout_msg = git_checkout_existing(test_branch)

    # Attempt cherry-pick.
    ok, conflicts = git_cherry_pick(impl_sha)

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
        {
            "role": "assistant",
            "content": (
                f"cherry-pick {impl_sha[:12]} → clean"
                if ok
                else f"cherry-pick {impl_sha[:12]} → conflicts in: {', '.join(conflicts)}"
            ),
        },
    ]

    if ok:
        push_result = git_push(test_branch)
        messages = messages + [{"role": "assistant", "content": push_result}]

    return {
        "cherry_pick_ok": ok,
        "cherry_pick_conflicts": conflicts,
        "current_role": "cherry-pick",
        "messages": messages,
    }
