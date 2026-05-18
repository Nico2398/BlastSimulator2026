"""open-pr node — create the pull request and update backlog + labels."""

from __future__ import annotations
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.github_write import github_create_pr, github_add_label, github_remove_label


def open_pr(state: dict) -> dict:
    """Create a PR for the completed work and update issue labels."""
    issue_number = state.get("issue_number", 0)
    branch = state.get("branch_name", "")
    issue_title = state.get("issue_title", f"Issue #{issue_number}")
    pipeline = state.get("pipeline", "implement-feature")

    if not branch:
        return {
            "pr_number": None,
            "current_role": "open-pr",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": "error: branch_name not set in state — cannot create PR"}
            ],
        }

    pr_title = _pr_title(pipeline, issue_title)
    pr_body = _pr_body(issue_number, state)

    try:
        result = github_create_pr(
            branch=branch,
            title=pr_title,
            body=pr_body,
            base="main",
        )
        pr_num = None
        for token in result.split():
            if token.startswith("#"):
                try:
                    pr_num = int(token[1:])
                except ValueError:
                    pass

        github_remove_label(issue_number, "in-progress")
        github_add_label(issue_number, "in-review")

        return {
            "pr_number": pr_num,
            "current_role": "open-pr",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": result}
            ],
        }
    except RuntimeError as exc:
        return {
            "pr_number": None,
            "current_role": "open-pr",
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": f"error creating PR: {exc}"}
            ],
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
        "## Changes",
        "_See commits for details._",
        "",
        "## Validation",
        "- [ ] TypeScript: `npx tsc --noEmit`",
        "- [ ] Tests: `npx vitest run`",
        "- [ ] Build: `npx vite build`",
    ]
    return "\n".join(lines)
