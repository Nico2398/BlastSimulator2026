"""validator node — run full validation suite (tsc + vitest + build)."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.tools import tool as lc_tool

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_react_agent, extract_ok, get_message_content
from tools.shell_tools import run_shell


def validator(state: dict) -> dict:
    """Run the full validation suite and report results."""
    llm = build_llm()
    tools = READ_ONLY_TOOLS + [lc_tool(run_shell)]

    agent = build_react_agent("validator", tools, llm, extra_context=_build_context(state))
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    report = get_message_content(result["messages"][-1]) if result.get("messages") else ""
    return {
        "messages": result["messages"],
        "validator_ok": ok,
        "validator_report": report,
        "current_role": "validator",
        "retry_count": state.get("retry_count", 0) + (0 if ok else 1),
    }


def _build_context(state: dict) -> str:
    return (
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}\n"
        f"Retry count so far: {state.get('retry_count', 0)}\n"
        "Run: npm run validate\n"
        "All three steps must pass: TypeScript type check, Vitest tests, Vite build.\n"
        "Report ✅ VALIDATION PASSED or ❌ VALIDATION FAILED with exact errors."
    )
