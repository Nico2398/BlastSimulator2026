"""LangChain Community GitHub toolkit integration.

Replaces custom PyGithub wrappers for agent tool sets where the
langchain_community.agent_toolkits.github.toolkit.GitHubToolkit
provides an equivalent tool.

Custom tools kept (no toolkit equivalent):
  - github_list_issue_comments
  - github_get_pr_reviews
  - github_get_pr_review_comments
  - github_add_label / github_remove_label

Authentication: reads GITHUB_TOKEN, DEFAULT_REPO_OWNER, DEFAULT_REPO_NAME
from the environment — same variables used by the rest of the pipeline.
"""

from __future__ import annotations

import os
from typing import List

from langchain_core.tools import BaseTool


# ---------------------------------------------------------------------------
# Lazy initialisation
# ---------------------------------------------------------------------------

_toolkit = None


def _get_toolkit():
    """Return the GitHubToolkit, initialising it on first call."""
    global _toolkit
    if _toolkit is None:
        from langchain_community.agent_toolkits.github.toolkit import GitHubToolkit
        from langchain_community.utilities.github import GitHubAPIWrapper

        token = os.environ.get("GITHUB_TOKEN", "")
        owner = os.environ.get("DEFAULT_REPO_OWNER", "")
        name = os.environ.get("DEFAULT_REPO_NAME", "")

        wrapper = GitHubAPIWrapper(
            github_personal_access_token=token,
            github_repository=f"{owner}/{name}",
        )
        _toolkit = GitHubToolkit.from_github_api_wrapper(wrapper)
    return _toolkit


# ---------------------------------------------------------------------------
# Exported tool groups
# ---------------------------------------------------------------------------

# Tool names as returned by GitHubToolkit.get_tools():
_READ_NAMES = {"Get Issue", "Get Pull Request", "List Pull Requests' Files"}
_WRITE_NAMES = {"Comment on Issue"}


def get_github_read_tools() -> List[BaseTool]:
    """Agent-facing read-only GitHub tools from the langchain toolkit.

    Replaces the custom lc_tool() wrappers for:
      github_get_issue     → "Get Issue"
      github_get_pr        → "Get Pull Request"
      github_get_pr_files  → "List Pull Requests' Files"
    """
    return [t for t in _get_toolkit().get_tools() if t.name in _READ_NAMES]


def get_github_write_tools() -> List[BaseTool]:
    """Agent-facing GitHub write tools from the langchain toolkit.

    Replaces the custom lc_tool() wrapper for:
      github_post_comment  → "Comment on Issue"
    """
    return [t for t in _get_toolkit().get_tools() if t.name in _WRITE_NAMES]
