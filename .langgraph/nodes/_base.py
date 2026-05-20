"""Shared helpers for coding nodes."""

from __future__ import annotations

import os
import sys
from typing import Any
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool as lc_tool

from tools.agent_tools import list_agents, get_agent_context, list_skills, get_skill_context
from tools.github_tools import (
    github_get_issue, github_list_issue_comments,
    github_get_pr, github_get_pr_files, github_get_pr_reviews, github_get_pr_review_comments,
)
from tools.fs_tools import read_file, write_file, delete_file, list_dir, grep
from tools.shell_tools import run_shell
from tools.github_write import (
    github_post_comment, github_add_label, github_remove_label,
)
from tools.backlog_tools import (
    backlog_list, backlog_next, backlog_start, backlog_done,
    backlog_block, backlog_reset, backlog_stats,
)
from tools.todo_tools import todo_add, todo_list, todo_done, todo_clear

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")

# ---------------------------------------------------------------------------
# Tool set building blocks
# (git / PR-creation tools are intentionally absent here — those operations
#  are performed by non-agentic graph nodes, not by the agents themselves)
# ---------------------------------------------------------------------------

# Context tools: fetch issue/PR data and agent/skill context from GitHub.
# All GitHub reads go through PyGithub via our custom tools — no external SDK.
_CONTEXT_TOOLS = [lc_tool(f) for f in [
    list_agents, get_agent_context, list_skills, get_skill_context,
    github_get_issue, github_list_issue_comments,
    github_get_pr, github_get_pr_files, github_get_pr_reviews, github_get_pr_review_comments,
]]

# Filesystem read tools: inspect repository files.
_CODE_READ_TOOLS = [lc_tool(f) for f in [read_file, list_dir, grep]]

# Filesystem write + shell: edit source files and run validation commands.
_CODE_WRITE_TOOLS = [lc_tool(f) for f in [write_file, delete_file, run_shell]]

# Per-session task tracking: agents plan and track their sub-steps.
_TODO_TOOLS = [lc_tool(f) for f in [todo_add, todo_list, todo_done, todo_clear]]

# Backlog management: read/update the project backlog.
BACKLOG_TOOLS = [lc_tool(f) for f in [
    backlog_list, backlog_next, backlog_start, backlog_done,
    backlog_block, backlog_reset, backlog_stats,
]]

# GitHub write: post comments and manage labels (reviewer only).
_GH_WRITE_TOOLS = [lc_tool(f) for f in [
    github_post_comment, github_add_label, github_remove_label,
]]

# ---------------------------------------------------------------------------
# Composed tool sets — one per agent role
# ---------------------------------------------------------------------------

# READ_ONLY_TOOLS: context + file reads + TODO.
# Use for: code_review, reviewer (reading phase), investigate mode.
READ_ONLY_TOOLS = _CONTEXT_TOOLS + _CODE_READ_TOOLS + _TODO_TOOLS

# CODING_TOOLS: context + file r/w + shell + TODO.
# Use for: test writers, implementer, fixer, refactorer.
# No git ops — branches and commits are managed by non-agentic nodes.
CODING_TOOLS = _CONTEXT_TOOLS + _CODE_READ_TOOLS + _CODE_WRITE_TOOLS + _TODO_TOOLS

# REVIEW_TOOLS: like CODING_TOOLS + GitHub write.
# Use for: reviewer (can post APPROVED comment and push last-minute fixes).
REVIEW_TOOLS = CODING_TOOLS + _GH_WRITE_TOOLS

# Kept for any node that explicitly still needs GitHub write tools.
GITHUB_WRITE_TOOLS = _GH_WRITE_TOOLS

# ---------------------------------------------------------------------------
# TODO usage reminder injected into every agent system prompt
# ---------------------------------------------------------------------------

_TODO_REMINDER = """
## Task Management
Use the `todo_add`, `todo_list`, `todo_done` tools to manage your work:
1. **Start**: call `todo_list` to see pending items; then `todo_add` to record each sub-step.
2. **Work**: complete one item at a time, then call `todo_done` with its index.
3. **Finish**: call `todo_list` again to confirm all planned work is done before you stop.
"""

# ---------------------------------------------------------------------------
# Agent builder helpers
# ---------------------------------------------------------------------------


def load_agent_prompt(role: str) -> str:
    """Load the agent role system prompt from .github/agents/<role>.agent.md."""
    path = Path(_REPO_ROOT) / ".github" / "agents" / f"{role}.agent.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return f"You are the {role} agent. Follow project conventions."


def build_react_agent(role: str, tools: list, llm, extra_context: str = ""):
    """Build a LangGraph ReAct agent for a given role."""
    from langgraph.prebuilt import create_react_agent as lg_react_agent
    system_prompt = load_agent_prompt(role) + _TODO_REMINDER
    if extra_context:
        system_prompt = system_prompt + "\n\n## Additional Context\n" + extra_context
    return lg_react_agent(llm, tools, prompt=system_prompt).with_config(
        {"recursion_limit": 100}
    )


def build_fresh_messages(*parts: str) -> list[HumanMessage]:
    """Build a fresh message list for nodes that must not inherit old history."""
    content = "\n\n".join(part.strip() for part in parts if part and part.strip())
    return [HumanMessage(content=content)] if content else []


def extract_message_content(message: Any) -> str:
    """Return plain text content from a LangChain message-like object."""
    return getattr(message, "content", "") or ""


def extract_ok(agent_result: dict, *, allow_expected_failures: bool = False) -> bool:
    """Determine if the agent run succeeded by inspecting final messages.

    Args:
        agent_result: The dict returned by agent.invoke().
        allow_expected_failures: When True (Red phase test writers), treat
            "tests fail as expected" as success rather than failure.
    """
    messages = agent_result.get("messages", [])
    if not messages:
        return False
    content = extract_message_content(messages[-1])
    cl = content.lower()
    if allow_expected_failures and ("as expected" in cl or "failing" in cl):
        # Red phase: tests intentionally fail — don't treat that as a pipeline failure.
        # Note: do NOT include "error:" here — test output routinely contains
        # "Error: not implemented" which is exactly the expected Red phase output.
        hard_fails = ["validation failed", "cannot write", "permission denied", "blocked"]
        return not any(sig in cl for sig in hard_fails)
    fail_signals = ["validation failed", "tests fail", "error:", "cannot", "blocked"]
    return not any(sig in cl for sig in fail_signals)


def skill_hint(skill: str) -> str:
    """Return a prompt snippet encouraging the agent to load the skill spec."""
    if not skill:
        return ""
    return (
        f"\nRelevant skill: **{skill}**\n"
        f"Call `get_skill_context('{skill}')` to load the full system specification "
        "before starting your work."
    )
