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
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_react_agent, extract_ok


def code_review(state: dict) -> dict:
    """Agentic code review — checks quality gates before refactoring."""
    llm = build_llm()
    agent = build_react_agent(
        "code-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = agent.invoke({"messages": state.get("messages", [])})
    ok = extract_ok(result)
    messages = result["messages"]

    # Extract final review summary from last message.
    last_content = ""
    if messages:
        last = messages[-1]
        last_content = getattr(last, "content", "") or ""

    retry = state.get("retry_count", 0)
    return {
        "messages": messages,
        "code_review_ok": ok,
        "code_review_report": last_content,
        "current_role": "code-review",
        "retry_count": retry + (0 if ok else 1),
    }


def _build_context(state: dict) -> str:
    return (
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}\n"
        f"Pipeline: {state.get('pipeline', '')}\n"
        "\n"
        "TASK: Review the implementation that was just written.\n"
        "Check ALL of the following:\n"
        "1. Architecture boundaries: src/core/ has no DOM/WebGL/window imports.\n"
        "2. No Math.random() — only seeded PRNG from src/core/math/Random.ts.\n"
        "3. 300-line limit per file (data/i18n files exempt).\n"
        "4. Named exports everywhere (except entry points).\n"
        "5. All user-facing strings use t('key') — no hardcoded player-visible text.\n"
        "6. TypeScript strict — no 'any' except in test fixtures.\n"
        "7. No hardcoded balance numbers — use src/core/config/.\n"
        "\n"
        "Read the relevant implementation files with read_file / grep before judging.\n"
        "Conclude with either:\n"
        "  ✅ CODE REVIEW PASSED — ready for refactor\n"
        "  ❌ CODE REVIEW FAILED — list each violation with file + line number\n"
    )
