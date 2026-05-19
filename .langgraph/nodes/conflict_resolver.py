"""conflict_resolver node — resolve cherry-pick merge conflicts.

Invoked only when cherry_pick detects conflicts. The agent:
- Reads each conflicted file.
- Removes conflict markers and writes clean content.
- Stages all files and finalises the cherry-pick.
- The node then auto-commits and pushes.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.git_tools import git_continue_cherry_pick, git_push, git_get_head_sha
from llm import build_llm
from nodes._base import CODING_TOOLS, build_fresh_messages, build_react_agent, extract_ok


def conflict_resolver(state: dict) -> dict:
    """Resolve cherry-pick conflicts and finalise the merge.

    Uses a fresh message set — the full conflict list is in the context.
    """
    test_branch = state.get("test_branch", state.get("branch_name", ""))
    conflicts = state.get("cherry_pick_conflicts", [])
    issue_number = state.get("issue_number", 0)

    llm = build_llm()
    agent = build_react_agent(
        "implementer",
        CODING_TOOLS,
        llm,
        extra_context=_build_context(state, conflicts),
    )
    result = agent.invoke({"messages": build_fresh_messages(_build_task_prompt(conflicts))})
    ok = extract_ok(result)
    messages = result["messages"]

    # Finalise cherry-pick (stages all files + commits).
    commit_msg = f"fix(cherry-pick): resolve conflicts for #{issue_number}"
    continue_result = git_continue_cherry_pick(commit_msg)
    messages = messages + [{"role": "assistant", "content": continue_result}]

    impl_sha = git_get_head_sha()

    push_result = git_push(test_branch)
    messages = messages + [{"role": "assistant", "content": push_result}]

    return {
        "messages": messages,
        "conflict_resolver_ok": ok,
        "impl_commit_sha": impl_sha,
        "current_role": "conflict-resolver",
    }


def _build_context(state: dict, conflicts: list[str]) -> str:
    lines = [
        f"Issue #{state.get('issue_number')}: {state.get('issue_title', '')}",
        "",
        "TASK: Resolve cherry-pick merge conflicts.",
        "The following files contain conflict markers (<<<<<<, =======, >>>>>>>):",
        *[f"  - {f}" for f in conflicts],
        "",
        "Context: the conflict is between test code (<<<<<<< HEAD, the test_branch) "
        "and implementation code (>>>>>>> the impl_branch cherry-pick).",
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
        "Resolve the following cherry-pick conflicts. "
        "For each file, read it, remove conflict markers, merge both sides cleanly, "
        "and write the resolved file back:\n"
        + conflict_list
    )
