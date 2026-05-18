"""integration_test_writer node — TDD Red phase: write failing integration tests.

Skipped for fix-bug pipelines (skip_integration_tests=True in state).
"""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import WRITE_TOOLS, build_react_agent, extract_ok


def integration_test_writer(state: dict) -> dict:
    """Write failing integration tests (multiple components, feature-scale)."""
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
        "integration_test_writer_ok": ok,
        "current_role": "integration-test-writer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "SCOPE: Integration tests — feature-scale, multiple interacting components.",
        "Tests should verify the complete feature works end-to-end within src/core/.",
        "Tests must fail before any implementation is written.",
    ]
    if state.get("skill"):
        lines.append(f"Relevant skill: {state['skill']}")
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
