"""refactorer node — TDD Refactor phase: clean up implementation code."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import CODING_TOOLS, build_react_agent, extract_ok


def refactorer(state: dict) -> dict:
    """Refactor the implementation for clarity and convention compliance."""
    llm = build_llm()
    agent = build_react_agent(
        "refactorer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "refactorer_ok": ok,
        "current_role": "refactorer",
    }


def _build_context(state: dict) -> str:
    return (
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}\n"
        f"Pipeline: {state.get('pipeline', '')}\n"
        "Clean up the implementation. All tests must still pass after refactoring."
    )
