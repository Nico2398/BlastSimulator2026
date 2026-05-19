"""open_pr node — non-agentic: create the pull request via PyGithub.

Uses PyGithub (not urllib) for PR creation and label management.
No LLM call — deterministic, fast, and idempotent.
"""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from github import GithubException

from tools.pygithub_tools import create_pr, add_label, remove_label


def open_pr(state: dict) -> dict:
    """Create a PR for the completed work and update issue labels."""
    issue_number = state.get("issue_number", 0)
    branch = state.get("test_branch", state.get("branch_name", ""))
    issue_title = state.get("issue_title", f"Issue #{issue_number}")
    pipeline = state.get("pipeline", "implement-feature")

    if not branch:
        return {
            "pr_number": None,
            "current_role": "open-pr",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": "error: branch not set in state — cannot create PR"},
            ],
        }

    pr_title = _pr_title(pipeline, issue_title)
    pr_body = _pr_body(issue_number, state)

    try:
        pr_num, pr_url = create_pr(
            branch=branch,
            title=pr_title,
            body=pr_body,
            base="main",
        )
    except RuntimeError as exc:
        return {
            "pr_number": None,
            "current_role": "open-pr",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": f"error creating PR: {exc}"}
            ],
        }

    messages = state.get("messages", []) + [
        {"role": "assistant", "content": f"PR #{pr_num} created: {pr_url}"}
    ]
    try:
        remove_result = remove_label(issue_number, "in-progress")
        messages = messages + [{"role": "assistant", "content": remove_result}]
    except (RuntimeError, GithubException) as exc:  # PR exists already; label cleanup must not turn success into failure
        messages = messages + [
            {"role": "assistant", "content": f"warning: label update failed: {exc}"}
        ]

    try:
        add_result = add_label(issue_number, "in-review")
        messages = messages + [{"role": "assistant", "content": add_result}]
    except (RuntimeError, GithubException) as exc:  # PR exists already; label cleanup must not turn success into failure
        messages = messages + [
            {"role": "assistant", "content": f"warning: label update failed: {exc}"}
        ]

    return {
        "pr_number": pr_num,
        "current_role": "open-pr",
        "messages": messages,
    }


def _pr_title(pipeline: str, issue_title: str) -> str:
    prefix_map = {
        "implement-feature": "feat",
        "fix-bug": "fix",
        "visual-change": "feat",
        "investigate": "docs",
    }
    prefix = prefix_map.get(pipeline, "chore")
    return f"{prefix}: {issue_title}"


def _pr_body(issue_number: int, state: dict) -> str:
    pipeline = state.get("pipeline", "")
    skill = state.get("skill", "")
    lines = [
        f"Closes #{issue_number}",
        "",
        f"**Pipeline:** {pipeline}",
    ]
    if skill:
        lines.append(f"**Skill context:** {skill}")
    lines += [
        "",
        "## Commits",
        "| Branch | Purpose |",
        "|---|---|",
        f"| `{state.get('test_branch', '')}` | Tests + refactor |",
        f"| `{state.get('impl_branch', '')}` | Implementation (cherry-picked) |",
        "",
        "## Validation",
        "- [ ] TypeScript: `npx tsc --noEmit`",
        "- [ ] Tests: `npx vitest run`",
        "- [ ] Build: `npx vite build`",
    ]
    return "\n".join(lines)
