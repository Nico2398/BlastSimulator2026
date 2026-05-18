"""Agent and skill context tools for the LangGraph orchestrator.

Provides functions to list and read agent role definitions and domain skill
specs from the repository's .github/agents/ and .github/skills/ directories.

These tools are used by the orchestrator to load per-role instructions before
spawning each subagent.  The subagent calls get_agent_context() on startup to
receive its own role-specific directives.

Relies on GITHUB_WORKSPACE environment variable (set by the GitHub Actions
workflow) to locate the repository root.
"""

import glob as _glob
import os
import re

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")

# Only allow simple identifier-style names: letters, digits, hyphens, underscores.
# This blocks path traversal via "..", "/", "\" etc.
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _validate_name(name: str, kind: str) -> str | None:
    """Return an error string if *name* is unsafe, else None."""
    if not _SAFE_NAME_RE.match(name):
        return f"error: invalid {kind} name '{name}' — only letters, digits, hyphens, and underscores are allowed"
    return None


# ---------------------------------------------------------------------------
# Agent tools
# ---------------------------------------------------------------------------


def list_agents() -> str:
    """List available agent roles from .github/agents/.

    Returns:
        One role name per line (e.g. implementer, refactorer, test-writer).
        Returns 'no agents found' if the directory is empty or missing.
    """
    paths = sorted(_glob.glob(f"{_REPO_ROOT}/.github/agents/*.agent.md"))
    if not paths:
        return "no agents found"
    return "\n".join(os.path.basename(p).replace(".agent.md", "") for p in paths)


def get_agent_context(agent_name: str) -> str:
    """Return the full instructions for an agent role.

    This is the primary bootstrap tool for subagents.  When a subagent task
    starts with 'AGENT_ROLE: <name>', the subagent MUST call this function
    before taking any other action and follow the returned instructions.

    Args:
        agent_name: Role name, e.g. 'test-writer', 'implementer', 'refactorer',
                    'validator', 'reviewer', 'visual-tester'.

    Returns:
        Full markdown content of .github/agents/{agent_name}.agent.md.
        Returns an error message if the agent is not found.
    """
    err = _validate_name(agent_name, "agent")
    if err:
        return err
    path = f"{_REPO_ROOT}/.github/agents/{agent_name}.agent.md"
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return (
            f"error: agent '{agent_name}' not found — "
            "call list_agents() to see available roles"
        )


# ---------------------------------------------------------------------------
# Skill tools
# ---------------------------------------------------------------------------


def list_skills() -> str:
    """List available skill names from .github/skills/.

    Returns:
        One skill name per line.
        Returns 'no skills found' if the directory is empty or missing.
    """
    skills_dir = f"{_REPO_ROOT}/.github/skills"
    try:
        dirs = sorted(
            d for d in os.listdir(skills_dir)
            if os.path.isdir(os.path.join(skills_dir, d))
        )
    except FileNotFoundError:
        return "no skills found"
    return "\n".join(dirs) if dirs else "no skills found"


def get_skill_context(skill_name: str) -> str:
    """Return the full specification for a domain skill.

    Use this to load domain-specific context before working on a feature.
    The orchestrator may include a relevant skill name in the subagent task;
    the subagent should call this after loading its role context.

    Args:
        skill_name: Skill name, e.g. 'blast-system', 'navmesh', 'buildings'.
                    Call list_skills() to see all available skill names.

    Returns:
        Full markdown content of .github/skills/{skill_name}/SKILL.md.
        Returns an error message if the skill is not found.
    """
    err = _validate_name(skill_name, "skill")
    if err:
        return err
    path = f"{_REPO_ROOT}/.github/skills/{skill_name}/SKILL.md"
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return (
            f"error: skill '{skill_name}' not found — "
            "call list_skills() to see available skill names"
        )
