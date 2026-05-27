"""conflict_resolver node — resolve merge conflicts.

Invoked when merge_branches detects conflicts. The agent:
- Reads each conflicted file.
- Removes conflict markers and writes clean content.
- Stages all files and finalises the merge.
- The node then pushes.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import git as gitpy

from tools.git_tools import git_push, git_get_head_sha
from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok, invoke_agent


def conflict_resolver(state: dict) -> dict:
    """Resolve merge conflicts and finalise the merge.

    Uses a fresh message set — the full conflict list is in the context.
    """
    current_branch = state.get("branch_name", state.get("full_branch", ""))
    conflicts = state.get("merge_conflicts", state.get("cherry_pick_conflicts", []))
    issue_number = state.get("issue_number", 0)

    llm = build_llm()
    agent = build_react_agent(
        "conflict-resolver",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state, conflicts),
    )
    result = invoke_agent(agent, build_fresh_messages(_build_task_prompt(conflicts)))
    ok = extract_ok(result)
    messages = result["messages"]

    # Stage resolved files and complete the merge.
    repo = gitpy.Repo(Path(__file__).parent.parent.parent, search_parent_directories=True)
    repo.git.add("-A")
    try:
        done_msg = _finish_merge(repo, issue_number)
    except gitpy.GitCommandError as exc:
        done_msg = f"error finalising merge: {exc}"

    messages = messages + [{"role": "assistant", "content": done_msg}]

    merge_sha = git_get_head_sha()

    push_result = git_push(current_branch)
    messages = messages + [{"role": "assistant", "content": push_result}]

    retry_count = state.get("retry_count", 0)
    if not ok:
        retry_count += 1

    return {
        "messages": messages,
        "conflict_resolver_ok": ok,
        "merge_sha": merge_sha,
        "retry_count": retry_count,
        "current_role": "conflict-resolver",
    }


def _finish_merge(repo, issue_number: int) -> str:
    """Finalise the in-progress merge by staging and committing."""
    from git import Actor

    actor = Actor("langgraph", "langgraph@noreply.github.com")
    try:
        repo.git.merge("--continue", "--no-edit")
        sha = repo.head.commit.hexsha[:12]
        return f"merge continued: [{sha}]"
    except gitpy.GitCommandError:
        commit = repo.index.commit(
            f"fix(merge): resolve conflicts for #{issue_number}",
            author=actor,
            committer=actor,
        )
        return f"merge resolved via commit: [{commit.hexsha[:12]}]"


def _build_context(state: dict, conflicts: list[str]) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        "",
        "TASK: Resolve merge conflicts.",
        "The following files contain conflict markers (<<<<<<, =======, >>>>>>>):",
        *[f"  - {f}" for f in conflicts],
        "",
        "Context: two branches are being merged into a full branch:",
        "  - test_branch (test code)",
        "  - impl_branch (implementation code)",
        "Resolution rule: keep BOTH sides merged cleanly. The implementation logic "
        "must coexist with the test file content — do not discard either side.",
        "For each conflicted file:",
        "1. Read the file.",
        "2. Remove all conflict markers, integrating both sides into valid code.",
        "3. Write the resolved file back.",
        "DO NOT commit — the graph commits after you finish.",
    ]
    return "\n".join(lines)


def _build_task_prompt(conflicts: list[str]) -> str:
    conflict_list = "\n".join(f"  - {f}" for f in conflicts)
    return (
        "Resolve the following merge conflicts. "
        "For each file, read it, remove conflict markers, merge both sides cleanly, "
        "and write the resolved file back:\n"
        + conflict_list
    )
