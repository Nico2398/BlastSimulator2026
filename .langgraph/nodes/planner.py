"""planner node — produce a structured task plan from the issue.

Runs after orchestrate, before skeleton_writer. The planner:
1. Reads the issue body and skill context.
2. Produces a structured plan: files to create/modify, acceptance criteria, edge cases.
3. Stores the plan in state so all downstream agents reference it.

This ensures alignment: test-writer, implementer, and reviewer all work
from the same plan instead of independently interpreting the issue.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, skill_hint, extract_message_content


_HUMAN_REVIEW_MARKER = "🧑 HUMAN REVIEW NEEDED:"


def _extract_human_review(text: str) -> "str | None":
    """Return the human-review reason from the planner output, or None."""
    for line in text.splitlines():
        if _HUMAN_REVIEW_MARKER in line:
            return line.split(_HUMAN_REVIEW_MARKER, 1)[1].strip() or None
    return None


def planner(state: dict) -> dict:
    """Produce a structured implementation plan from the issue.

    Uses read-only tools to inspect the codebase before planning.
    The plan is stored in state for all downstream agents.

    If the task requires artistic input or a critical design decision that
    cannot be automated, the planner emits ``🧑 HUMAN REVIEW NEEDED: <reason>``
    which is captured in ``needs_human_review`` so ``open_pr`` can pause
    auto-merge and request human input instead.
    """
    llm = build_llm()
    agent = build_react_agent(
        "planner",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result)
    messages = result["messages"]

    # Extract the plan from the last message.
    plan = ""
    if messages:
        plan = extract_message_content(messages[-1])

    retry_count = state.get("retry_count", 0)
    if not ok:
        retry_count += 1

    return {
        "messages": messages,
        "plan": plan,
        "planner_ok": ok,
        "retry_count": retry_count,
        "current_role": "planner",
        "needs_human_review": _extract_human_review(plan),
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "",
        "TASK: Produce a structured implementation plan.",
        "",
        "1. Read the issue body below to understand requirements.",
        "2. Inspect the codebase with read_file / grep / list_dir.",
        "3. Identify which files need to be created or modified.",
        "4. List acceptance criteria from the issue.",
        "5. Identify edge cases and potential pitfalls.",
        "",
        "Output format (follow exactly):",
        "## Plan",
        "### Files to Create",
        "- path/to/new/file.ts — purpose",
        "### Files to Modify",
        "- path/to/existing/file.ts — what changes",
        "### Acceptance Criteria",
        "- [ ] criterion 1",
        "- [ ] criterion 2",
        "### Edge Cases",
        "- edge case 1",
        "- edge case 2",
        "### Architecture Notes",
        "- note about module boundaries, data flow, etc.",
        "",
        "Be specific. Include file paths. Reference skill specs if relevant.",
        "End with ONE of:",
        "  ✅ PLAN COMPLETE",
        "  ❌ PLAN FAILED",
        "  🧑 HUMAN REVIEW NEEDED: <concise reason>  ← use when the task requires",
        "     artistic direction or a critical design decision that cannot be automated",
        "     (e.g. choice of public-facing feature name, game-balance value needing",
        "     creative input, UI style not covered by existing conventions).",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("skill"):
        lines.append(
            f"\nCall `get_skill_context('{state['skill']}')` to load the domain spec. "
            "Incorporate ALL rules from that spec into the plan."
        )
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Create an implementation plan for issue #{state.get('issue_number')}. "
        "Read the issue body and inspect the codebase. "
        "Produce a structured plan with files, acceptance criteria, and edge cases."
    )
