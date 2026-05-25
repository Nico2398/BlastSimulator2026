"""reviewer node — audit PR for architecture compliance and report outcome."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from llm import build_llm
from nodes._base import REVIEW_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent, skill_hint


def reviewer(state: dict) -> dict:
    """Review a PR, push fixes if needed, post review outcome when ready.

    Starts from a fresh message set so the reviewer focuses on the PR diff,
    not on noise accumulated from the build pipeline.
    """
    llm = build_llm()
    agent = build_react_agent(
        "reviewer",
        REVIEW_TOOLS,
        llm,
        extra_context=_build_context(state),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(state)))
    ok = extract_ok(result)
    return {
        "messages": result["messages"],
        "reviewer_ok": ok,
        "current_role": "reviewer",
    }


def _build_context(state: dict) -> str:
    risk_tier = state.get("risk_tier", "full")
    tier_note = {
        "trivial": "Risk tier: TRIVIAL — light review.",
        "lite": "Risk tier: LITE — standard review.",
        "full": "Risk tier: FULL — deep review.",
    }.get(risk_tier, "")

    lines = [
        f"Issue/PR #{state.get('issue_number')}: {state.get('issue_title', '')}",
        tier_note,
        "Review the PR:",
        "1. Fetch PR diff and inline review comments.",
        "2. Check: architecture boundaries, i18n strings, 300-line limit, no Math.random().",
        "3. Verify issue acceptance criteria are ALL met.",
        "4. Run: npm run validate",
        "5. If minor fixes needed: write the files (run_shell to re-validate after).",
        "6. Post review summary as the FINAL action — nothing after it.",
        "",
        "## What NOT to Flag",
        "- Theoretical risks requiring unlikely preconditions",
        "- Issues in unchanged code that this PR doesn't affect",
        "- 'Consider using library X' suggestions",
        "- Style preferences not in coding-conventions skill",
        "- `as any` in test fixtures (acceptable)",
        "",
        "## Severity Tags",
        "When flagging issues, tag severity: [critical] [warning] [suggestion].",
        "Only [critical] items should block merge. Bias toward approval.",
    ]
    lines.append(skill_hint(state.get("skill", "")))
    if state.get("skill"):
        lines.append(
            f"\nCall `get_skill_context('{state['skill']}')` to load the domain spec. "
            "Verify the PR follows ALL rules in that spec."
        )
    if state.get("issue_body"):
        lines.append("\n## Issue Body\n" + state["issue_body"])
    if state.get("plan"):
        lines.append("\n## Implementation Plan\n" + state["plan"])
    if state.get("diff_dir"):
        lines.append(f"\n## Diff Directory\n{state['diff_dir']}")
        lines.append("Read SUMMARY.md first, then specific .patch files as needed.")
    if state.get("changed_files"):
        file_list = "\n".join(f"  - {f}" for f in state["changed_files"])
        lines.append(f"\n## Changed Files\n{file_list}")
    return "\n".join(lines)


def _build_task_prompt(state: dict) -> str:
    return (
        f"Review PR/issue #{state.get('issue_number')}. "
        "Fetch the PR details and diff using your tools, then audit the changes. "
        "Verify every acceptance criterion from the issue is implemented."
    )
