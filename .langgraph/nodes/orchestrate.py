"""Orchestrate node — classify the issue and set the pipeline route.

This is the first node in every pipeline run. It:
1. Fetches the issue from GitHub (using github_tools).
2. Classifies the pipeline type from labels + body keywords.
3. Selects the appropriate skill context if relevant.
4. Sets pipeline, skill, issue_title, issue_body, issue_labels in state.
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.github_tools import github_get_issue, github_list_issue_comments


# ---------------------------------------------------------------------------
# Pipeline classification
# ---------------------------------------------------------------------------

_PIPELINE_RULES: list[tuple[str, list[str]]] = [
    # (pipeline_name, [label_or_keyword_patterns])
    ("review-pr",         ["review", "approved", "lgtm"]),
    ("visual-change",     ["rendering", "ui", "canvas", "three.js", "visual", "threejs"]),
    ("fix-bug",           ["bug", "fix", "broken", "regression", "error"]),
    ("investigate",       ["why", "how", "explain", "analyze", "investigate"]),
    ("implement-feature", ["feature", "implement", "add", "agent-task", "backlog"]),
]


def _classify(labels: list[str], title: str, comment: str) -> str:
    """Return the pipeline type based on labels, title, and trigger comment."""
    haystack = " ".join(labels + [title, comment]).lower()
    for pipeline, keywords in _PIPELINE_RULES:
        if any(kw in haystack for kw in keywords):
            return pipeline
    return "implement-feature"  # default


_SKILL_KEYWORDS: dict[str, list[str]] = {
    "blast-system": ["blast", "explosion", "fragment", "voronoi", "energy"],
    "navmesh": ["navmesh", "pathfind", "ramp", "navigation", "movement"],
    "buildings": ["building", "canteen", "bunkhouse", "warehouse"],
    "vehicle-fleet": ["vehicle", "truck", "drill", "haul", "driver"],
    "employee-skills": ["skill", "xp", "proficiency", "levelup", "level up"],
    "employee-needs": ["hunger", "fatigue", "morale", "need", "rest"],
    "survey-system": ["survey", "seismic", "core sample", "ore grade"],
    "game-design": ["event", "campaign", "economy", "score"],
    "architecture": ["module", "architecture", "refactor", "structure"],
    "testing-strategy": ["test", "vitest", "coverage", "unit test"],
    "coding-conventions": ["convention", "style", "lint", "naming"],
}


def _select_skill(title: str, body: str) -> str:
    haystack = (title + " " + body).lower()
    for skill, keywords in _SKILL_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return skill
    return ""


# ---------------------------------------------------------------------------
# Node function
# ---------------------------------------------------------------------------


def orchestrate(state: dict) -> dict:
    """Classify the issue and populate pipeline routing state."""
    issue_number = state.get("issue_number", 0)
    comment_body = state.get("comment_body", "")

    issue_text = github_get_issue(issue_number)
    github_list_issue_comments(issue_number)

    labels: list[str] = []
    issue_title = ""
    issue_body = issue_text

    for line in issue_text.splitlines():
        if line.startswith("Labels:"):
            raw = line.replace("Labels:", "").strip()
            if raw and raw != "none":
                labels = [lb.strip() for lb in raw.split(",")]
        if line.startswith("#") and not issue_title:
            parts = line.split("]", 1)
            issue_title = parts[1].strip() if len(parts) > 1 else line

    pipeline = _classify(labels, issue_title, comment_body)
    skill = _select_skill(issue_title, issue_text)

    # Skip integration/scenario tests for pipelines that don't need them.
    # fix-bug: only unit tests are pertinent.
    # investigate / review-pr: no test writing at all.
    skip_integration = pipeline in ("fix-bug", "investigate", "review-pr")
    skip_scenario = pipeline in ("fix-bug", "investigate", "review-pr")

    test_branch = f"langgraph/tests-{issue_number}"
    impl_branch = f"langgraph/impl-{issue_number}"

    return {
        "issue_title": issue_title,
        "issue_body": issue_body,
        "issue_labels": labels,
        "pipeline": pipeline,
        "skill": skill,
        "current_role": "orchestrate",
        "retry_count": 0,
        "skip_integration_tests": skip_integration,
        "skip_scenario_tests": skip_scenario,
        # Branch names set here; skeleton_writer creates them.
        "test_branch": test_branch,
        "impl_branch": impl_branch,
        "branch_name": test_branch,
    }
