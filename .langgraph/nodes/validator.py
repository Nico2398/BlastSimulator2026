"""validator node — run full validation suite (tsc + vitest + build)."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.tools import tool as lc_tool

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, extract_message_content
from tools.shell_tools import run_shell


def validator(state: dict) -> dict:
    """Run the full validation suite and report results.

    Starts from a fresh message set — runs validation commands directly.
    """
    llm = build_llm()
    tools = READ_ONLY_TOOLS + [lc_tool(run_shell)]

    agent = build_react_agent("validator", tools, llm, extra_context=_build_context(state))
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result)
    report = extract_message_content(result["messages"][-1]) if result.get("messages") else ""
    return {
        "messages": result["messages"],
        "validator_ok": ok,
        "validator_report": report,
        "current_role": "validator",
        "retry_count": state.get("retry_count", 0) + (0 if ok else 1),
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Retry count so far: {state.get('retry_count', 0)}",
        "Run: npm run validate",
        "All three steps must pass: TypeScript type check, Vitest tests, Vite build.",
        "Report ✅ VALIDATION PASSED or ❌ VALIDATION FAILED with exact errors.",
    ]
    if state.get("validator_report"):
        lines.append("\n## Previous Validation Output\n" + state["validator_report"])
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Validate the implementation for issue #{state.get('issue_number')}. "
        "Run `npm run validate` via run_shell and report the result."
    )
