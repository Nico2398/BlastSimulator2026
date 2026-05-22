"""refactorer node — TDD Refactor phase: clean up implementation code."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, skill_hint


def refactorer(state: dict) -> dict:
    """Refactor the implementation for clarity and convention compliance.

    Starts from a fresh message set. The code_review_report from the previous
    node is included in the context so the refactorer knows what to improve.
    """
    llm = build_llm()
    agent = build_react_agent(
        "refactorer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result)
    retry_count = state.get("retry_count", 0)
    if not ok:
        retry_count += 1
    return {
        "messages": result["messages"],
        "refactorer_ok": ok,
        "retry_count": retry_count,
        "current_role": "refactorer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "",
        "TASK: Clean up the implementation. All tests must still pass after refactoring.",
        "- Fix any issues flagged by the code review below.",
        "- Improve naming, remove dead code, split files exceeding 300 lines.",
        "- Do NOT change test files — only implementation files in src/.",
    ]
    if state.get("code_review_report"):
        lines.append("\n## Code Review Findings\n" + state["code_review_report"])
    if state.get("issue_body"):
        lines.append("\n## Issue Body\n" + state["issue_body"])
    if state.get("changed_files"):
        file_list = "\n".join(f"  - {f}" for f in state["changed_files"])
        lines.append(f"\n## Changed Files\n{file_list}")
    if state.get("diff_dir"):
        lines.append(f"\n## Diff Directory\n{state['diff_dir']}")
        lines.append("Read specific .patch files to see what changed in each file.")
    lines.append(skill_hint(state.get("skill", "")))
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Refactor the implementation for issue #{state.get('issue_number')}. "
        "Address the code review findings in the system context. "
        "Read implementation files with your tools before making changes."
    )
