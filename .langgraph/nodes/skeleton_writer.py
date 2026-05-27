"""skeleton_writer node — write empty stubs on skeleton_branch.

Already on skeleton_branch (set up by setup_branches node).
For coding pipelines: invokes an LLM agent to write empty TypeScript
function/class stubs, then auto-commits them.
For fix-bug pipelines: no stubs needed, just records the SHA.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import (
    git_get_head_sha,
    git_commit,
)
from llm import build_llm
from nodes._base import CODING_TOOLS, build_react_agent, extract_ok, invoke_agent, skill_hint


def skeleton_writer(state: dict) -> dict:
    """Write empty stubs on skeleton_branch (already checked out)."""
    issue_number = state.get("issue_number", 0)
    pipeline = state.get("pipeline", "implement-feature")
    skeleton_ok = True

    skeleton_sha = git_get_head_sha()

    messages = state.get("messages", [])

    # For coding pipelines that need new code: write empty stubs via LLM.
    if pipeline in ("implement-feature", "visual-change"):
        llm = build_llm()
        agent = build_react_agent(
            "implementer",
            CODING_TOOLS,
            llm,
            extra_context=_build_context(state),
        )
        result = invoke_agent(agent, messages)
        skeleton_ok = extract_ok(result)
        messages = result["messages"]

        if skeleton_ok:
            commit_result = git_commit(
                f"chore(skeleton): empty stubs for #{issue_number}"
            )
            skeleton_sha = git_get_head_sha()
            messages = messages + [
                {"role": "assistant", "content": commit_result}
            ]

    return {
        "messages": messages,
        "skeleton_commit_sha": skeleton_sha,
        "skeleton_writer_ok": skeleton_ok,
        "retry_count": state.get("retry_count", 0) + (0 if skeleton_ok else 1),
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
        "- For constants: use `undefined as any` or `0 // TODO` — never the real value.",
        "- Do NOT add JSDoc, comments or documentation strings.",
        "- Do NOT write test code (no describe/it/expect blocks).",
        "- Do NOT restore deleted code — the implementer will do that.",
        "- Only touch files listed in the issue's `files` field.",
        "- Do NOT write any real logic. Do NOT write tests.",
        "- Commit nothing — the graph will commit after you finish.",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
