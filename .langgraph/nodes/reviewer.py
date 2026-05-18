"""reviewer node — audit PR for architecture compliance and post APPROVED."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import WRITE_TOOLS, GITHUB_WRITE_TOOLS, build_react_agent, extract_ok


def reviewer(state: dict) -> dict:
    """Review a PR, push fixes if needed, post APPROVED comment when ready."""
    tools = WRITE_TOOLS + GITHUB_WRITE_TOOLS

    llm = build_llm()
    agent = build_react_agent(
        "reviewer",
        tools,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "reviewer_ok": ok,
        "current_role": "reviewer",
    }


def _build_context(state: dict) -> str:
    return (
        f"Issue/PR #{state.get('issue_number')}: {state.get('issue_title', '')}\n"
        "Review the PR:\n"
        "1. Fetch PR diff and inline review comments.\n"
        "2. Check: architecture boundaries, i18n strings, 300-line limit, no Math.random().\n"
        "3. Run: npm run validate\n"
        "4. If fixes needed: write files, git commit, git push.\n"
        "5. Post APPROVED comment as the FINAL action — nothing after it.\n"
        "APPROVED comment triggers auto-merge. Post it only when all checks pass."
    )
