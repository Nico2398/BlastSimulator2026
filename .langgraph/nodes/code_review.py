"""code_review node — agentic code review after qualimetry.

Runs after qualimetry passes and before refactorer. The reviewer inspects
the implementation for architecture compliance, naming conventions, i18n
coverage, the 300-line file limit, and other quality gates.

Unlike the `reviewer` node (which audits an existing PR), this node runs
within the coding pipeline — it may request improvements that will be picked
up by the refactorer in the next step.

Output:
- `code_review_ok=True`   → refactorer runs (or validator for fix-bug)
- `code_review_ok=False`  → retry via implementer (max MAX_RETRIES total)
- `code_review_report`    → text summary added to state for refactorer context
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok, extract_message_content, skill_hint


def code_review(state: dict) -> dict:
    """Agentic code review — checks quality gates before refactoring.

    Uses a fresh message set so the reviewer reads implementation files
    directly via tools, unbiased by the implementer's message history.
    """
    llm = build_llm()
    agent = build_react_agent(
        "code-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(state))})
    ok = _extract_code_review_ok(result)
    messages = result["messages"]

    # Extract final review summary from last message.
    last_content = ""
    if messages:
        last_content = extract_message_content(messages[-1])

    retry = state.get("retry_count", 0)
    return {
        "messages": messages,
        "code_review_ok": ok,
        "code_review_report": last_content,
        "current_role": "code-review",
        "retry_count": retry + (0 if ok else 1),
    }


def _build_context(state: dict) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        f"Retry #{state.get('retry_count', 0)}",
        "",
        "TASK: Review the implementation that was just written.",
        "Check ALL of the following:",
        "1. Architecture boundaries: src/core/ has no DOM/WebGL/window imports.",
        "2. No Math.random() — only seeded PRNG from src/core/math/Random.ts.",
        "3. 300-line limit per file (data/i18n files exempt).",
        "4. Named exports everywhere (except entry points).",
        "5. All user-facing strings use t('key') — no hardcoded player-visible text.",
        "6. TypeScript strict — no 'any' except in test fixtures.",
        "7. No hardcoded balance numbers — use src/core/config/.",
        "",
        "Read the relevant implementation files with read_file / grep before judging.",
        "Conclude with either:",
        "  ✅ CODE REVIEW PASSED — ready for refactor",
        "  ❌ CODE REVIEW FAILED — list each violation with file + line number",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("issue_body"):
        lines.append("\n## Issue Body\n" + state["issue_body"])
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Review the implementation for issue #{state.get('issue_number')}. "
        "Read implementation files in src/ using your tools before making a judgment."
    )


def _extract_code_review_ok(agent_result: dict) -> bool:
    messages = agent_result.get("messages", [])
    if not messages:
        return False

    content = extract_message_content(messages[-1])
    match = re.search(r"^(✅ CODE REVIEW PASSED|❌ CODE REVIEW FAILED)\b", content, re.MULTILINE)
    if match:
        return match.group(1) == "✅ CODE REVIEW PASSED"
    return extract_ok(agent_result)
