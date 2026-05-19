"""fixer node — agentic: fix failing tests with a non-biased approach.

Invoked when test_runner reports test failures. The fixer is a completely
independent agent from the implementer — it uses the "fixer" role prompt
(not "implementer") and receives only the test failure output, not the test
source code. This prevents bias from reading test assertions.

The fixer:
1. Reads the failure output.
2. Inspects the implementation files cited in the stack traces.
3. Writes targeted fixes to the implementation.
4. Auto-commits the fix so test_runner can re-run.
"""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_commit, git_push
from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok, skill_hint


def fixer(state: dict) -> dict:
    """Fix implementation code to make failing tests pass.

    The agent receives only the test failure output — not the test source.
    This keeps the approach unbiased: fixes are driven by error messages and
    stack traces, not by reading assertions.
    """
    llm = build_llm()
    agent = build_react_agent(
        "fixer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(state))})
    ok = extract_ok(result)
    messages = result["messages"]

    issue_number = state.get("issue_number", 0)
    test_branch = state.get("test_branch", state.get("branch_name", ""))

    commit_result = git_commit(f"fix(impl): fix failing tests for #{issue_number}")
    push_result = git_push(test_branch)
    messages = messages + [
        {"role": "assistant", "content": commit_result},
        {"role": "assistant", "content": push_result},
    ]

    return {
        "messages": messages,
        "fixer_ok": ok,
        "current_role": "fixer",
        # fixer owns the retry counter — each attempt consumes one retry slot.
        "retry_count": state.get("retry_count", 0) + 1,
    }


def _build_context(state: dict, _tool_names: list | None = None) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        f"Retry #{state.get('retry_count', 0)}",
        "",
        "ROLE: You are the FIXER, NOT the implementer. You have a fresh perspective.",
        "TASK: Fix the implementation code so the test suite passes.",
        "",
        "CONSTRAINTS:",
        "- Do NOT read or open any test files. Work only from the error output below.",
        "- Only modify implementation files in src/ (not test files).",
        "- Fix only what the errors indicate — do not rewrite working code.",
        "- Do NOT call git yourself — the graph auto-commits your changes after you finish.",
        "",
        "## Test Failure Output",
        state.get("test_output", "(no output captured)"),
    ]
    lines.append(skill_hint(state.get("skill", "")))
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Fix the failing implementation for issue #{state.get('issue_number')}. "
        "Use only the failure output from the system context and repository source files."
    )
