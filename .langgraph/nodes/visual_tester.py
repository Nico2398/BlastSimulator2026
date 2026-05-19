"""visual-tester node — run Puppeteer scenario tests and capture screenshots."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.tools import tool as lc_tool

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok
from tools.shell_tools import run_shell


def visual_tester(state: dict) -> dict:
    """Run visual scenario tests with Puppeteer.

    Starts from a fresh message set — independent of the build pipeline history.
    """
    tools = READ_ONLY_TOOLS + [lc_tool(run_shell)]

    llm = build_llm()
    agent = build_react_agent(
        "visual-tester",
        tools,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(state))})
    ok = extract_ok(result)
    retry_count = state.get("retry_count", 0)
    if not ok:
        retry_count += 1
    return {
        "messages": result["messages"],
        "visual_tester_ok": ok,
        "retry_count": retry_count,
        "current_role": "visual-tester",
    }


def _build_context(state: dict) -> str:
    return (
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}\n"
        "Run visual scenario tests:\n"
        "  npm run dev &\n"
        "  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium "
        "npx tsx scripts/scenario-test.ts --scenario blast-basic\n"
        "Available scenarios: blast-basic, level1-win-efficient, level1-win-conservative,\n"
        "  level1-lose-bankruptcy, level1-lose-arrest, level1-lose-ecology, level1-lose-revolt\n"
        "Report pass/fail for each scenario."
    )


def _build_task_prompt(state: dict) -> str:
    return (
        f"Run visual scenario tests for issue #{state.get('issue_number')}. "
        "Follow the commands in the system context and report pass/fail for each scenario."
    )
