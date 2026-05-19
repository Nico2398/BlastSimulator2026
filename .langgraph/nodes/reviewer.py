"""reviewer node — audit PR for architecture compliance and post APPROVED."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import REVIEW_TOOLS, build_fresh_messages, build_react_agent, extract_ok


def reviewer(state: dict) -> dict:
    """Review a PR, push fixes if needed, post APPROVED comment when ready.

    Starts from a fresh message set so the reviewer focuses on the PR diff,
    not on noise accumulated from the build pipeline.
    """
    llm = build_llm()
    agent = build_react_agent(
        "reviewer",
        REVIEW_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(state))})
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "reviewer_ok": ok,
        "current_role": "reviewer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue/PR #{state.get('issue_number')}: {state.get('issue_title', '')}",
        "Review the PR:",
        "1. Fetch PR diff and inline review comments.",
        "2. Check: architecture boundaries, i18n strings, 300-line limit, no Math.random().",
        "3. Run: npm run validate",
        "4. If minor fixes needed: write the files (run_shell to re-validate after).",
        "5. Post APPROVED comment as the FINAL action — nothing after it.",
        "APPROVED comment triggers auto-merge. Post it only when all checks pass.",
    ]
    if state.get("issue_body"):
        lines.append("\n## Issue Body\n" + state["issue_body"])
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Review PR/issue #{state.get('issue_number')}. "
        "Fetch the PR details and diff using your tools, then audit the changes."
    )
