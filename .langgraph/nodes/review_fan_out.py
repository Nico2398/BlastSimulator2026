"""review_fan_out — dispatch specialized sub-reviewers in parallel.

Used in two pipeline paths:
  - Development pipeline (implement-feature, fix-bug, visual-change): runs after qualimetry,
    before refactorer. Fan-in (coordinator) routes to refactorer or implementer.
  - Review-PR pipeline: runs immediately after orchestrate (user-triggered review request).
    Fan-in (coordinator) routes to reviewer for runtime validation.

Risk tier controls which reviewers run:
  trivial — quality only (1 reviewer)
  lite    — quality + i18n + duplication (3 reviewers)
  full    — security + quality + i18n + duplication (4 reviewers)
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langgraph.types import Send
from nodes._base import READ_ONLY_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, skill_hint, extract_message_content
from llm import build_llm


def review_fan_out(state: dict) -> dict:
    """Fan-out node: no-op, returns empty dict. Routing is done via route_from_review_fan_out."""
    return {}


def route_from_review_fan_out(state: dict) -> list[Send]:
    """Dispatch specialized sub-reviewers based on risk tier.

    Returns a list of Send objects targeting the sub-reviewer nodes.
    """
    risk_tier = state.get("risk_tier", "full")
    reviewers = _select_reviewers(risk_tier)

    sends = []
    for reviewer_name, _ in reviewers:
        sends.append(Send(reviewer_name, state))

    return sends


def _select_reviewers(risk_tier: str) -> list[tuple[str, callable]]:
    """Return (name, function) pairs for the reviewers to run."""
    if risk_tier == "trivial":
        return [("quality_reviewer", quality_reviewer)]
    if risk_tier == "lite":
        return [
            ("quality_reviewer", quality_reviewer),
            ("i18n_reviewer", i18n_reviewer),
            ("duplication_reviewer", duplication_reviewer),
        ]
    # full
    return [
        ("security_reviewer", security_reviewer),
        ("quality_reviewer", quality_reviewer),
        ("i18n_reviewer", i18n_reviewer),
        ("duplication_reviewer", duplication_reviewer),
    ]


# ---------------------------------------------------------------------------
# Sub-reviewer node functions
# ---------------------------------------------------------------------------

def _build_shared_context(state: dict) -> str:
    """Build context shared by all sub-reviewers."""
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        f"Pipeline: {state.get('pipeline', '')}",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    if state.get("changed_files"):
        file_list = "\n".join(f"  - {f}" for f in state["changed_files"])
        lines.append(f"\n## Changed Files\n{file_list}")
    if state.get("diff_dir"):
        lines.append(f"\n## Diff Directory\n{state['diff_dir']}")
        lines.append("Read SUMMARY.md first, then specific .patch files as needed.")
    return "\n".join(lines)


def security_reviewer(state: dict) -> dict:
    """Security-focused sub-reviewer."""
    llm = build_llm()
    agent = build_react_agent(
        "security-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_shared_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(
        f"Security review for issue #{state.get('issue_number')}. "
        "Read changed files and check for exploitable vulnerabilities."
    ))
    ok = extract_ok(result)
    messages = result["messages"]
    content = extract_message_content(messages[-1]) if messages else ""

    return {
        "messages": messages,
        "security_review_ok": ok,
        "security_review_report": content,
    }


def quality_reviewer(state: dict) -> dict:
    """Code quality sub-reviewer."""
    llm = build_llm()
    agent = build_react_agent(
        "quality-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_shared_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(
        f"Quality review for issue #{state.get('issue_number')}. "
        "Read changed files and check architecture, naming, file size, TypeScript strictness."
    ))
    ok = extract_ok(result)
    messages = result["messages"]
    content = extract_message_content(messages[-1]) if messages else ""

    return {
        "messages": messages,
        "quality_review_ok": ok,
        "quality_review_report": content,
    }


def i18n_reviewer(state: dict) -> dict:
    """i18n sub-reviewer."""
    llm = build_llm()
    agent = build_react_agent(
        "i18n-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_shared_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(
        f"i18n review for issue #{state.get('issue_number')}. "
        "Read changed files and locale JSONs. Check for hardcoded strings and missing keys."
    ))
    ok = extract_ok(result)
    messages = result["messages"]
    content = extract_message_content(messages[-1]) if messages else ""

    return {
        "messages": messages,
        "i18n_review_ok": ok,
        "i18n_review_report": content,
    }


def duplication_reviewer(state: dict) -> dict:
    """Semantic duplication sub-reviewer.

    Inspects the diff for semantic duplication, non-atomic functions, and
    generic code placed in domain-specific modules — complementing the
    non-agentic jscpd check that only detects syntactic clones.

    Args:
        state: Pipeline state dict. Reads issue_number, diff_dir, changed_files,
               skill, issue_body, and plan.

    Returns:
        Partial state dict with keys:
          - messages: agent message history
          - duplication_review_ok: True when no [critical] duplication found
          - duplication_review_report: full text of the agent's findings
    """
    llm = build_llm()
    agent = build_react_agent(
        "duplication-reviewer",
        READ_ONLY_TOOLS,
        llm,
        extra_context=_build_shared_context(state),
    )
    task = (
        f"Duplication review for issue #{state.get('issue_number')}. "
        "Read SUMMARY.md in the diff directory, then read each changed file. "
        "Check for semantic duplication against the existing codebase, non-atomic functions, "
        "and generic code placed in domain-specific modules."
    )
    result = invoke_agent(agent, build_fresh_messages(task))
    ok = extract_ok(result)
    messages = result["messages"]
    content = extract_message_content(messages[-1]) if messages else ""

    return {
        "messages": messages,
        "duplication_review_ok": ok,
        "duplication_review_report": content,
    }
