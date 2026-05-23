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
from pathlib import Path

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE") or str(Path(__file__).parent.parent.parent)

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
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return (
            f"error: agent '{agent_name}' not found — "
            "call list_agents() to see available roles"
        )


def list_skills(agent_name: str = "") -> str:
    """List available skill files in .github/skills/.

    Args:
        agent_name: Optional agent name to filter by (skills may be tagged).

    Returns:
        Newline-separated list of skill names, or all skills if no filter.
    """
    skills_dir = Path(f"{_REPO_ROOT}/.github/skills")
    if not skills_dir.is_dir():
        return "error: .github/skills/ directory not found"
    all_skills = sorted(s.name for s in skills_dir.iterdir() if s.is_dir())
    if not agent_name:
        return "\n".join(all_skills)
    tagged = [s for s in all_skills if _skill_tagged_for_agent(s, agent_name)]
    return "\n".join(tagged) if tagged else f"no skills tagged for '{agent_name}'"


def get_skill_context(skill_name: str) -> str:
    """Read the full content of a skill's SKILL.md file.

    Args:
        skill_name: Name of the skill directory under .github/skills/.

    Returns:
        Full markdown content of .github/skills/{skill_name}/SKILL.md.
        Returns an error message if the skill is not found.
    """
    err = _validate_name(skill_name, "skill")
    if err:
        return err
    path = f"{_REPO_ROOT}/.github/skills/{skill_name}/SKILL.md"
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return (
            f"error: skill '{skill_name}' not found — "
            "call list_skills() to see available skill names"
        )
