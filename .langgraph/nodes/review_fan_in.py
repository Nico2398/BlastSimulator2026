"""review_fan_in — merge findings from specialized sub-reviewers.

Runs the review-coordinator agent to deduplicate, filter false positives,
and make a final pass/fail decision based on all sub-reviewer reports.

This replaces the old single-agent code_review node with a coordinated
multi-reviewer approach inspired by Cloudflare's system.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, extract_message_content, skill_hint


def review_fan_in(state: dict) -> dict:
    """Merge sub-reviewer findings via coordinator agent.

    The coordinator receives all sub-reviewer reports, deduplicates,
    filters false positives, and makes a final pass/fail decision.
    """
    llm = build_llm()
    agent = build_react_agent(
        "review-coordinator",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_coordinator_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_coordinator_task(state)))
    ok = _extract_coordinator_ok(result)
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
        "current_role": "review-coordinator",
        "retry_count": retry + (0 if ok else 1),
    }


def _build_coordinator_context(state: dict) -> str:
    """Build context for the coordinator — all sub-reviewer reports + shared context."""
    risk_tier = state.get("risk_tier", "full")

    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
        f"Risk tier: {risk_tier}",
        "",
        "You are the REVIEW COORDINATOR. Merge findings from sub-reviewers below.",
        "Deduplicate, filter false positives, verify uncertain items by reading source.",
        "Make final pass/fail decision. Bias toward approval.",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("skill"):
        lines.append(
            f"\nCall `get_skill_context('{state['skill']}')` to verify domain spec compliance."
        )
    if state.get("issue_body"):
        lines.append("\n## Issue Body\n" + state["issue_body"])
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    if state.get("changed_files"):
        file_list = "\n".join(f"  - {f}" for f in state["changed_files"])
        lines.append(f"\n## Changed Files\n{file_list}")
    if state.get("diff_dir"):
        lines.append(f"\n## Diff Directory\n{state['diff_dir']}")

    # Sub-reviewer reports
    if state.get("security_review_report"):
        lines.append("\n## Security Review Report\n" + state["security_review_report"])
    if state.get("quality_review_report"):
        lines.append("\n## Quality Review Report\n" + state["quality_review_report"])
    if state.get("i18n_review_report"):
        lines.append("\n## i18n Review Report\n" + state["i18n_review_report"])

    return "\n".join(lines)


def _build_coordinator_task(state: dict) -> str:
    return (
        f"Coordinate the code review for issue #{state.get('issue_number')}. "
        "Merge all sub-reviewer findings. Deduplicate, filter, and make a final decision."
    )


def _extract_coordinator_ok(agent_result: dict) -> bool:
    """Determine if the coordinated review passed.

    Priority:
    1. Explicit ✅/❌ marker in last message.
    2. Severity-based: only [critical] items cause failure.
    3. Fallback to extract_ok().
    """
    messages = agent_result.get("messages", [])
    if not messages:
        return False

    content = extract_message_content(messages[-1])
    match = re.search(r"^(✅ CODE REVIEW PASSED|❌ CODE REVIEW FAILED)\b", content, re.MULTILINE)
    if match:
        return match.group(1) == "✅ CODE REVIEW PASSED"

    # Severity-based: count critical items
    critical_count = len(re.findall(r"\[critical\]", content, re.IGNORECASE))
    if critical_count > 0:
        return False

    return extract_ok(agent_result)
