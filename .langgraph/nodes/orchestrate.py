"""Orchestrate node — classify the issue and set the pipeline route.

This is the first node in every pipeline run. It:
1. Fetches the issue from GitHub (using github_tools).
2. Classifies the pipeline type from labels + body keywords.
3. Selects the appropriate skill context if relevant.
4. Analyzes the issue scope to decide which optional steps to skip.
5. Sets pipeline, skill, skip flags, issue_title, issue_body, issue_labels in state.

Skip logic is driven entirely by issue analysis — no manual labels required.
The orchestrator inspects the issue body, title, and skill to determine:
- Does this change touch the renderer/UI? → integration + scenario tests
- Is this a config/data-only change? → skip most quality gates
- Is this a docs-only change? → skip all test writing + quality gates
- Is this a core-only change? → skip scenario + visual tests
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from tools.github_tools import github_get_issue


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
    "gameplay-blast-system": ["blast", "explosion", "fragment", "voronoi", "energy"],
    "gameplay-navmesh": ["navmesh", "pathfind", "ramp", "navigation", "movement"],
    "gameplay-buildings": ["building", "canteen", "bunkhouse", "warehouse"],
    "gameplay-vehicle-fleet": ["vehicle", "truck", "drill", "haul", "driver"],
    "gameplay-employee-skills": ["skill", "xp", "proficiency", "levelup", "level up"],
    "gameplay-employee-needs": ["hunger", "fatigue", "morale", "need", "rest"],
    "gameplay-survey-system": ["survey", "seismic", "core sample", "ore grade"],
    "gameplay-game-design": ["event", "campaign", "economy", "score"],
    "dev-architecture": ["module", "architecture", "refactor", "structure"],
    "dev-testing-strategy": ["test", "vitest", "coverage", "unit test"],
    "dev-coding-conventions": ["convention", "style", "lint", "naming"],
    "dev-visual-testing": ["visual", "screenshot", "puppeteer", "rendering"],
    "agentic-backlog": ["backlog"],
    "agentic-autonomous-pipeline": ["pipeline", "langgraph", "autonomous"],
}


def _select_skill(title: str, body: str) -> str:
    haystack = (title + " " + body).lower()
    for skill, keywords in _SKILL_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return skill
    return ""


# ---------------------------------------------------------------------------
# Issue scope analysis — determines which steps to skip
# ---------------------------------------------------------------------------

# Keywords that indicate the change is confined to a specific layer.
_RENDERER_KEYWORDS = [
    "terrainmesh", "buildingmesh", "vehiclemesh", "charactermesh", "fragmentmesh",
    "skybox", "proceduraltexture", "blasteffects", "ghostmesh", "entitysync",
    "scenemanager", "cameracontroller", "distant scenery", "renderer",
    "three.js", "threejs", "webgl", "shader", "mesh", "overlay render",
    "visual", "render", "screenshot", "puppeteer",
]

_CORE_KEYWORDS = [
    "src/core/", "gamestate", "tick", "engine", "config", "balance",
    "economy", "score", "campaign", "weather", "math/", "random.ts",
    "prng", "seeded",
]

_CONFIG_KEYWORDS = [
    "config", "balance.ts", "balance value", "tuning", "constant",
    "threshold", "multiplier", "rate", "coefficient",
]

_DOCS_KEYWORDS = [
    "readme", "documentation", "doc:", "docs", "changelog", "comment",
    "typo", "spelling", "grammar", "markdown", ".md",
]

_I18N_KEYWORDS = [
    "i18n", "translation", "locale", "en.json", "fr.json", "localize",
    "localization",
]


def _analyze_scope(
    title: str,
    body: str,
    skill: str,
    pipeline: str,
    labels: list[str],
) -> dict[str, bool]:
    """Analyze the issue to determine which pipeline steps to skip.

    Returns a dict of skip flags. All default to False (run everything).
    The orchestrator is conservative: when uncertain, it runs the step.
    """
    haystack = (title + " " + body).lower()
    label_str = " ".join(labels).lower()

    # --- Base skips by pipeline type ---
    # fix-bug: only unit tests, no integration/scenario/visual
    # investigate: read-only, no tests at all
    # review-pr: reviewer only, no coding steps
    if pipeline in ("investigate", "review-pr"):
        return {
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "skip_code_review": True,
            "skip_qualimetry": True,
            "skip_refactorer": True,
            "skip_visual_tester": True,
        }

    if pipeline == "fix-bug":
        return {
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "skip_code_review": False,
            "skip_qualimetry": False,
            "skip_refactorer": True,  # bug fixes: minimal change, no refactor
            "skip_visual_tester": True,
        }

    # --- implement-feature / visual-change: smart analysis ---
    is_renderer = any(kw in haystack for kw in _RENDERER_KEYWORDS)
    is_core = any(kw in haystack for kw in _CORE_KEYWORDS)
    is_config = any(kw in haystack for kw in _CONFIG_KEYWORDS)
    is_docs = any(kw in haystack for kw in _DOCS_KEYWORDS)
    is_i18n = any(kw in haystack for kw in _I18N_KEYWORDS)

    # Config-only changes: just balance values, no logic change
    if is_config and not is_renderer and not is_core:
        return {
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "skip_code_review": False,
            "skip_qualimetry": True,  # trivial diff, no duplication risk
            "skip_refactorer": True,   # nothing to refactor
            "skip_visual_tester": True,
        }

    # Docs-only changes: no code at all
    if is_docs and not is_renderer and not is_core and not is_config:
        return {
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "skip_code_review": True,   # no code to review
            "skip_qualimetry": True,
            "skip_refactorer": True,
            "skip_visual_tester": True,
        }

    # i18n-only changes: translation strings, no logic
    if is_i18n and not is_renderer and not is_core:
        return {
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "skip_code_review": False,
            "skip_qualimetry": True,
            "skip_refactorer": True,
            "skip_visual_tester": True,
        }

    # Core-only changes: no renderer involvement
    if is_core and not is_renderer:
        return {
            "skip_integration_tests": False,
            "skip_scenario_tests": True,  # scenarios test visual flows
            "skip_code_review": False,
            "skip_qualimetry": False,
            "skip_refactorer": False,
            "skip_visual_tester": True,
        }

    # Renderer changes: need visual testing
    if is_renderer:
        return {
            "skip_integration_tests": False,
            "skip_scenario_tests": False,
            "skip_code_review": False,
            "skip_qualimetry": False,
            "skip_refactorer": False,
            "skip_visual_tester": False,  # visual changes need visual testing
        }

    # Default: run everything (conservative)
    return {
        "skip_integration_tests": False,
        "skip_scenario_tests": False,
        "skip_code_review": False,
        "skip_qualimetry": False,
        "skip_refactorer": False,
        "skip_visual_tester": pipeline != "visual-change",
    }


# ---------------------------------------------------------------------------
# Node function
# ---------------------------------------------------------------------------


def orchestrate(state: dict) -> dict:
    """Classify the issue and populate pipeline routing state."""
    issue_number = state.get("issue_number", 0)
    comment_body = state.get("comment_body", "")

    issue_text = github_get_issue(issue_number)
    if issue_text.startswith("error:"):
        return {"messages": [{"role": "assistant", "content": issue_text}]}

    # If the issue fetch failed, treat it as an error — return minimal state.
    if issue_text.startswith("error"):
        return {
            "issue_title": "",
            "issue_body": issue_text,
            "issue_labels": [],
            "pipeline": "implement-feature",
            "skill": "",
            "current_role": "orchestrate",
            "retry_count": 1,
            "skip_integration_tests": True,
            "skip_scenario_tests": True,
            "test_branch": f"langgraph/tests-{issue_number}",
            "impl_branch": f"langgraph/impl-{issue_number}",
            "branch_name": f"langgraph/tests-{issue_number}",
            "orchestrate_ok": False,
        }

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

    # Analyze issue scope to determine skip flags.
    skip_flags = _analyze_scope(issue_title, issue_body, skill, pipeline, labels)

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
        **skip_flags,
        # Branch names set here; skeleton_writer creates them.
        "test_branch": test_branch,
        "impl_branch": impl_branch,
        "branch_name": test_branch,
    }
