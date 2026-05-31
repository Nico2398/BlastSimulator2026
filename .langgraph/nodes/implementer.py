"""implementer node — TDD Green phase: write minimum code to pass tests."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import (
    CODING_TOOLS,
    READ_ONLY_TOOLS,
    build_fresh_messages,
    build_react_agent,
    extract_ok,
    invoke_agent,
    skill_hint,
)
from tools.git_tools import (
    git_force_checkout_branch,
    git_commit,
    git_get_head_sha,
)


def implementer(state: dict) -> dict:
    """Implement the feature or fix. Read-only mode when pipeline=investigate.

    Already on impl_branch (switched by switch_to_impl_branch).
    After the agent finishes, auto-commits any uncommitted changes.
    Records `impl_commit_sha` for the downstream merge_branches node.
    """
    investigate = state.get("pipeline") == "investigate"
    tools = READ_ONLY_TOOLS if investigate else CODING_TOOLS

    # Ensure we're on impl_branch (retry paths may arrive from other branches).
    if not investigate:
        impl_branch = state.get("impl_branch", "")
        skeleton_sha = state.get("skeleton_commit_sha", "")
        checkout_msg = git_force_checkout_branch(impl_branch, from_ref=skeleton_sha or None)
    else:
        checkout_msg = ""
        impl_branch = ""

    llm = build_llm()
    agent = build_react_agent("implementer", tools, llm, extra_context=_build_context(state))
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result)
    messages = result["messages"]

    impl_commit_sha = ""
    if not investigate:
        issue_number = state.get("issue_number", 0)
        commit_result = git_commit(
            f"feat(impl): implementation for #{issue_number}"
        )
        impl_commit_sha = git_get_head_sha()
        messages = messages + [
            {"role": "assistant", "content": checkout_msg},
            {"role": "assistant", "content": commit_result},
        ]

    retry_count = state.get("retry_count", 0)
    if not ok:
        retry_count += 1

    return {
        "messages": messages,
        "implementer_ok": ok,
        "impl_commit_sha": impl_commit_sha,
        "retry_count": retry_count,
        "current_role": "implementer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        f"Retry #{state.get('retry_count', 0)}",
    ]
    if state.get("pipeline") == "investigate":
        lines.append("MODE: investigate — read files only, do NOT write or commit.")
    else:
        lines.append(
            "NOTE: You are on the implementation branch. "
            "Test files are on a separate branch — you do NOT see them. "
            "Implement the feature so that tests (once merged) will pass."
        )
    lines.append(skill_hint(state.get("skill", "")))
    lines.extend(_retry_feedback(state))
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Implement issue #{state.get('issue_number')}. "
        "Use github_get_issue to read the issue body and requirements. "
        "Do not rely on prior graph message history."
    )


def _retry_feedback(state: dict) -> list[str]:
    feedback: list[str] = []

    if state.get("human_feedback"):
        feedback.append("\n## Human Feedback\n" + state["human_feedback"])
    if state.get("qualimetry_report"):
        feedback.append("\n## Qualimetry Feedback\n" + state["qualimetry_report"])
    if state.get("code_review_report"):
        feedback.append("\n## Code Review Feedback\n" + state["code_review_report"])
    if state.get("validator_report"):
        feedback.append("\n## Validator Feedback\n" + state["validator_report"])
    if state.get("merge_conflicts"):
        conflict_list = "\n".join(f"- {path}" for path in state["merge_conflicts"])
        feedback.append("\n## Merge Conflicts Still Open\n" + conflict_list)

    return feedback
