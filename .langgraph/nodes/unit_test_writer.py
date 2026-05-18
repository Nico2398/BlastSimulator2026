"""unit_test_writer node — TDD Red phase: write failing atomic unit tests."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import WRITE_TOOLS, build_react_agent, extract_ok


def unit_test_writer(state: dict) -> dict:
    """Write failing unit tests (isolated, fast, one function/class at a time)."""
    llm = build_llm()
    agent = build_react_agent(
        "test-writer",
        WRITE_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "unit_test_writer_ok": ok,
        "current_role": "unit-test-writer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "SCOPE: Unit tests only — atomic, isolated, zero external I/O.",
        "Each test covers a single function or class in src/core/.",
        "Tests must fail before any implementation is written.",
    ]
    if state.get("skill"):
        lines.append(f"Relevant skill: {state['skill']}")
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
