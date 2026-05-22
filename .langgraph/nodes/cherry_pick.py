"""cherry_pick node — non-agentic: merge implementer work onto test branch.

After the implementer finishes on `impl_branch`, this node:
1. Switches back to `test_branch`.
2. Cherry-picks `impl_commit_sha` onto it.
3. On a clean pick → pushes and continues to qualimetry.
4. On conflicts → records conflict paths in state and routes to conflict_resolver.
5. Computes the diff vs skeleton_commit_sha for downstream agents.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_checkout_existing, git_cherry_pick, git_push, git_diff_since, git_write_diff_to_file


# ---------------------------------------------------------------------------
# Risk tier assessment (Cloudflare-inspired)
# ---------------------------------------------------------------------------

# Files that always trigger a full review regardless of diff size.
_SECURITY_SENSITIVE = [
    "auth", "crypto", "password", "secret", "token", "permission",
    "security", "login", "session",
]


def _assess_risk_tier(changed_files: list[str], diff_text: str) -> str:
    """Classify the diff into a risk tier for review depth control.

    Tiers:
      trivial — ≤10 changed lines, ≤5 files, no security-sensitive paths.
                Lightest review: skip qualimetry, skip refactorer.
      lite    — ≤100 changed lines, ≤15 files, no security-sensitive paths.
                Standard review: skip refactorer only.
      full    — >100 lines or >15 files or security-sensitive paths touched.
                Full review pipeline.
    """
    file_count = len(changed_files)

    # Count approximate changed lines from the short diff summary.
    # (This is approximate since git_diff may be truncated, but good enough for tiering.)
    lines_changed = sum(
        1 for line in diff_text.splitlines()
        if line.startswith("+") or line.startswith("-")
    ) // 2  # each change appears as + and -

    # Security-sensitive files always get full review
    has_security_files = any(
        any(s in f.lower() for s in _SECURITY_SENSITIVE)
        for f in changed_files
    )
    if has_security_files:
        return "full"

    if file_count <= 5 and lines_changed <= 10:
        return "trivial"
    if file_count <= 15 and lines_changed <= 100:
        return "lite"
    return "full"


def cherry_pick(state: dict) -> dict:
    """Cherry-pick the implementation commit onto the test branch."""
    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", state.get("branch_name", ""))
    impl_sha = state.get("impl_commit_sha", "")
    skeleton_sha = state.get("skeleton_commit_sha", "")

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

    # Compute diff vs skeleton for downstream agents.
    # Write per-file patches to disk instead of embedding in prompts.
    git_diff = ""
    diff_dir = ""
    changed_files: list[str] = []
    risk_tier = "full"
    if ok and skeleton_sha:
        diff_dir, changed_files = git_write_diff_to_file(skeleton_sha)
        # Keep a short inline diff for nodes that need a quick summary (fixer, etc.)
        git_diff, _ = git_diff_since(skeleton_sha)
        if len(git_diff) > 2000:
            git_diff = git_diff[:2000] + f"\n... ({len(git_diff) - 2000} chars omitted)"
        # Compute risk tier from actual diff size (Cloudflare-style)
        risk_tier = _assess_risk_tier(changed_files, git_diff)
        messages = messages + [
            {"role": "assistant", "content": f"diff: {len(changed_files)} files changed, risk_tier={risk_tier}, patches at {diff_dir}"}
        ]

    if ok:
        push_result = git_push(test_branch)
        messages = messages + [{"role": "assistant", "content": push_result}]

    return {
        "cherry_pick_ok": ok,
        "cherry_pick_conflicts": conflicts,
        "current_role": "cherry-pick",
        "messages": messages,
        "changed_files": changed_files,
        "git_diff": git_diff,
        "diff_dir": diff_dir,
        "risk_tier": risk_tier,
    }
