"""qualimetry_node — non-agentic code quality gate.

Runs after the implementer step. No LLM involved — pure static analysis.
Uses tools/qualimetry.py to detect code duplication in the TypeScript source.
Increments retry_count on failure so the graph's retry loop applies here too.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.messages import AIMessage

from tools.qualimetry import run_qualimetry


def qualimetry_node(state: dict) -> dict:
    """Run code duplication check. No LLM — deterministic pass/fail.

    Skip entirely when fewer than 3 files changed — small diffs don't
    warrant a full duplication scan.
    """
    changed = state.get("changed_files", [])
    if len(changed) < 3:
        message = AIMessage(content="[qualimetry] skipped — <3 files changed")
        return {
            "messages": [message],
            "qualimetry_ok": True,
            "qualimetry_report": "skipped: small diff",
            "current_role": "qualimetry",
            "retry_count": state.get("retry_count", 0),
        }

    repo_root = os.environ.get("GITHUB_WORKSPACE", ".")
    report = run_qualimetry(repo_root)

    message = AIMessage(content=f"[qualimetry]\n{report.summary}")
    retry = state.get("retry_count", 0)
    return {
        "messages": [message],
        "qualimetry_ok": report.ok,
        "qualimetry_report": report.summary,
        "current_role": "qualimetry",
        "retry_count": retry + (0 if report.ok else 1),
    }
