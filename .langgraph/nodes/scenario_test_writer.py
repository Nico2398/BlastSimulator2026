"""scenario_test_writer node — TDD Red phase: write full scenario tests.

Skipped when skip_scenario_tests=True in state (e.g. fix-bug, simple features).
Uses Puppeteer scenario scripts in scripts/scenario-defs/ where applicable.
"""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, skill_hint
from tools.git_tools import git_commit, git_push


def scenario_test_writer(state: dict) -> dict:
    """Write failing full-scenario tests (game-level flows, Puppeteer scenarios).

    Auto-commits scenario files to test_branch after the agent finishes.
    Starts from a fresh message set — does not inherit prior agent history.
    """
    llm = build_llm()
    agent = build_react_agent(
        "test-writer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result, allow_expected_failures=True)
    messages = result["messages"]

    retry_count = state.get("retry_count", 0)
    if ok:
        issue_number = state.get("issue_number", 0)
        test_branch = state.get("test_branch", state.get("branch_name", ""))
        commit_result = git_commit(f"test(scenario): scenario tests for #{issue_number}")
        push_result = git_push(test_branch)
        messages = messages + [
            {"role": "assistant", "content": commit_result},
            {"role": "assistant", "content": push_result},
        ]
    else:
        retry_count += 1

    return {
        "messages": messages,
        "scenario_test_writer_ok": ok,
        "retry_count": retry_count,
        "current_role": "scenario-test-writer",
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        "SCOPE: Full scenario tests — simulate complete game flows (level win/lose/events).",
        "Add or extend scenario definitions in scripts/scenario-defs/ if applicable.",
        "Reference existing scenarios: blast-basic, level1-win-efficient, level1-win-conservative,",
        "  level1-lose-bankruptcy, level1-lose-arrest, level1-lose-ecology, level1-lose-revolt",
        "Tests must fail before any implementation is written.",
        "Read existing scenario files before writing to avoid duplication.",
        "Do NOT commit — the graph commits after you finish.",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Write failing scenario tests for issue #{state.get('issue_number')}. "
        "Use github_get_issue to read the issue body and requirements. "
        "Use read_file and list_dir to inspect existing scenarios before writing new ones."
    )
