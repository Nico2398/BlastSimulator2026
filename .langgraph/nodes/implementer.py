"""implementer node — TDD Green phase: write minimum code to pass tests."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import WRITE_TOOLS, READ_ONLY_TOOLS, build_react_agent, extract_ok


def implementer(state: dict) -> dict:
    """Implement the feature or fix. Read-only mode when pipeline=investigate."""
    investigate = state.get("pipeline") == "investigate"
    tools = READ_ONLY_TOOLS if investigate else WRITE_TOOLS

    llm = build_llm()
    agent = build_react_agent("implementer", tools, llm, extra_context=_build_context(state))
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "implementer_ok": ok,
        "current_role": "implementer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        f"Retry #{state.get('retry_count', 0)}",
    ]
    if state.get("skill"):
        lines.append(f"Relevant skill: {state['skill']}")
    if state.get("pipeline") == "investigate":
        lines.append("MODE: investigate — read files only, do NOT write or commit.")
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
