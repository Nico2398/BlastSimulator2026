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
from tools.git_tools import git_commit, git_push


def integration_test_writer(state: dict) -> dict:
    """Write failing integration tests (multiple components, feature-scale).

    Auto-commits test files to test_branch after the agent finishes.
    """
    llm = build_llm()
    agent = build_react_agent(
        "test-writer",
        WRITE_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    messages = result["messages"]

    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", state.get("branch_name", ""))

    commit_result = git_commit(f"test(integration): integration tests for #{issue_number}")
    push_result = git_push(test_branch)
    messages = messages + [
        {"role": "assistant", "content": commit_result},
        {"role": "assistant", "content": push_result},
    ]

    return {
        "messages": messages,
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
        "Do NOT commit — the graph commits after you finish.",
    ]
    if state.get("skill"):
        lines.append(f"Relevant skill: {state['skill']}")
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)
