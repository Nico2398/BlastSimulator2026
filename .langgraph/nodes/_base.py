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
from tools.shell_tools import run_shell, git_commit, git_push, git_checkout_branch
from tools.git_tools import git_checkout_existing
from tools.github_write import (
    github_create_pr, github_post_comment, github_add_label, github_remove_label,
)
from tools.backlog_tools import (
    backlog_list, backlog_next, backlog_start, backlog_done,
    backlog_block, backlog_reset, backlog_stats,
)

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")

# ---------------------------------------------------------------------------
# Tool sets
# ---------------------------------------------------------------------------

READ_ONLY_TOOLS = [lc_tool(f) for f in [
    list_agents, get_agent_context, list_skills, get_skill_context,
    github_get_issue, github_list_issue_comments,
    github_get_pr, github_get_pr_files, github_get_pr_reviews, github_get_pr_review_comments,
    read_file, list_dir, grep,
]]

WRITE_TOOLS = READ_ONLY_TOOLS + [lc_tool(f) for f in [
    write_file, delete_file, run_shell,
    git_commit, git_push, git_checkout_branch, git_checkout_existing,
]]

BACKLOG_TOOLS = [lc_tool(f) for f in [
    backlog_list, backlog_next, backlog_start, backlog_done,
    backlog_block, backlog_reset, backlog_stats,
]]

GITHUB_WRITE_TOOLS = [lc_tool(f) for f in [
    github_create_pr, github_post_comment, github_add_label, github_remove_label,
]]


def load_agent_prompt(role: str) -> str:
    """Load the agent role system prompt from .github/agents/<role>.agent.md."""
    path = Path(_REPO_ROOT) / ".github" / "agents" / f"{role}.agent.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return f"You are the {role} agent. Follow project conventions."


def build_react_agent(role: str, tools: list, llm, extra_context: str = ""):
    """Build a LangGraph ReAct agent for a given role."""
    from langgraph.prebuilt import create_react_agent as lg_react_agent
    system_prompt = load_agent_prompt(role)
    if extra_context:
        system_prompt = system_prompt + "\n\n## Additional Context\n" + extra_context
    return lg_react_agent(llm, tools, prompt=system_prompt)


def build_fresh_messages(*parts: str) -> list[HumanMessage]:
    """Build a fresh message list for nodes that must not inherit old history."""
    content = "\n\n".join(part.strip() for part in parts if part and part.strip())
    return [HumanMessage(content=content)] if content else []


def get_message_content(message: Any) -> str:
    """Return plain text content from a LangChain message-like object."""
    return getattr(message, "content", "") or ""


def extract_ok(agent_result: dict) -> bool:
    """Determine if the agent run succeeded by inspecting final messages."""
    messages = agent_result.get("messages", [])
    if not messages:
        return False
    content = get_message_content(messages[-1])
    fail_signals = ["validation failed", "tests fail", "error:", "cannot", "blocked"]
    return not any(sig in content.lower() for sig in fail_signals)
