"""unit_test_writer node — TDD Red phase: write failing atomic unit tests."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok, skill_hint
from tools.git_tools import git_commit, git_push


def unit_test_writer(state: dict) -> dict:
    """Write failing unit tests (isolated, fast, one function/class at a time).

    Auto-commits test files to test_branch after the agent finishes.
    Starts from a fresh message set — does not inherit prior agent history.
    """
    llm = build_llm()
    agent = build_react_agent(
        "test-writer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(state))})
    ok = extract_ok(result)
    messages = result["messages"]

    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", state.get("branch_name", ""))

    commit_result = git_commit(f"test(unit): unit tests for #{issue_number}")
    push_result = git_push(test_branch)
    messages = messages + [
        {"role": "assistant", "content": commit_result},
        {"role": "assistant", "content": push_result},
    ]

    return {
        "messages": messages,
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
        "Check existing test files before writing to avoid duplication.",
        "Do NOT commit — the graph commits after you finish.",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    lines.append("\n## Issue Body\n" + state.get("issue_body", ""))
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Write failing unit tests for issue #{state.get('issue_number')}. "
        "Read the issue body from the system context. "
        "Use read_file and grep to inspect existing tests before writing new ones."
    )
