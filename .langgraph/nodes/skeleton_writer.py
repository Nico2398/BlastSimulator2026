"""skeleton_writer node — create the working branch and commit empty stubs.

This is the first coding node. It:
1. Creates `test_branch` from the current HEAD of main.
2. Records that HEAD SHA as `skeleton_commit_sha`.
3. For implement-feature / visual-change pipelines: invokes an LLM agent to
   write empty TypeScript function/class stubs based on the issue, then
   auto-commits them with message 'chore(skeleton): empty stubs for #N'.
4. For fix-bug pipelines: only the branch setup runs (no LLM, no new files).
5. Pushes `test_branch` to origin.

The `skeleton_commit_sha` stored in state is later used as the base for
`impl_branch` — so the implementer never sees the test commits.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import (
    git_checkout_branch,
    git_get_head_sha,
    git_commit,
    git_push,
)
from llm import build_llm
from nodes._base import WRITE_TOOLS, build_react_agent, extract_ok


def skeleton_writer(state: dict) -> dict:
    """Set up the test branch and optionally write empty stubs."""
    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", f"langgraph/tests-{issue_number}")
    pipeline = state.get("pipeline", "implement-feature")

    # 1. Create test_branch from HEAD (main).
    checkout_msg = git_checkout_branch(test_branch)

    # 2. Record skeleton_commit_sha = current HEAD on test_branch.
    skeleton_sha = git_get_head_sha()

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": checkout_msg},
    ]

    # 3. For coding pipelines that need new code: write empty stubs via LLM.
    skeleton_ok = True
    if pipeline in ("implement-feature", "visual-change"):
        llm = build_llm()
        agent = build_react_agent(
            "implementer",
            WRITE_TOOLS,
            llm,
            extra_context=_build_context(state),
        )
        result = agent.invoke({"messages": messages})
        skeleton_ok = extract_ok(result)
        messages = result["messages"]

        # Auto-commit stubs; SHA only advances when files were actually written.
        commit_result = git_commit(
            f"chore(skeleton): empty stubs for #{issue_number}"
        )
        skeleton_sha = git_get_head_sha()  # unchanged if nothing was committed
        messages = messages + [
            {"role": "assistant", "content": commit_result}
        ]

    # 4. Push test_branch so it exists on origin.
    push_result = git_push(test_branch)
    messages = messages + [
        {"role": "assistant", "content": push_result}
    ]

    return {
        "messages": messages,
        "skeleton_commit_sha": skeleton_sha,
        "test_branch": test_branch,
        "branch_name": test_branch,  # keep branch_name pointing at test_branch
        "skeleton_writer_ok": skeleton_ok,
        "current_role": "skeleton-writer",
    }


def _build_context(state: dict) -> str:
    issue_number = state.get("issue_number", 0)
    lines = [
        f"Issue #{issue_number}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "",
        "TASK: Write EMPTY TypeScript stubs only. No implementation logic.",
        "- Add exported function/class/interface skeletons to the correct src/ files.",
        "- Each stub body must be `throw new Error('not implemented')` or `return undefined`.",
        "- Do NOT write any real logic. Do NOT write tests.",
        "- Commit nothing — the graph will commit after you finish.",
    ]
    if state.get("skill"):
        lines.append(f"Relevant skill: {state['skill']}")
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
