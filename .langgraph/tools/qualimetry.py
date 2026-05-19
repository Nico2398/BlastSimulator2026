"""qualimetry — non-agentic code quality analysis.

Checks the TypeScript source for code duplication via jscpd.
Returns a structured report. Fails when duplication exceeds the threshold.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

DUPLICATE_THRESHOLD_PCT: float = float(
    os.environ.get("QUALIMETRY_DUPLICATE_THRESHOLD", "5.0")
)
_SRC_DIR = "src"


@dataclass
class QualimetryReport:
    ok: bool
    duplicate_pct: float
    duplications: list[dict] = field(default_factory=list)
    error: str = ""
    summary: str = ""


def run_qualimetry(repo_root: str | None = None) -> QualimetryReport:
    """Run code duplication check via jscpd.

    Args:
        repo_root: Path to the repo root. Defaults to GITHUB_WORKSPACE or cwd.

    Returns:
        QualimetryReport with ok=True when duplicate_pct <= DUPLICATE_THRESHOLD_PCT.
    """
    root = Path(repo_root or os.environ.get("GITHUB_WORKSPACE", "."))
    src = root / _SRC_DIR
    if not src.exists():
        return QualimetryReport(
            ok=True, duplicate_pct=0.0, summary=f"{_SRC_DIR}/ not found — skipping"
        )

    with tempfile.TemporaryDirectory() as tmp:
        cmd = [
            "npx", "--yes", "jscpd",
            str(src),
            "--min-lines", "5",
            "--min-tokens", "50",
            "--reporters", "json",
            "--output", tmp,
            "--silent",
        ]
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(root),
                capture_output=True,
                text=True,
                timeout=120,
            )
            if proc.returncode not in (0, 1):  # 1 = duplicates found (expected)
                return QualimetryReport(
                    ok=False,
                    duplicate_pct=0.0,
                    error=f"jscpd exited with code {proc.returncode}: {proc.stderr.strip()}",
                )
        except subprocess.TimeoutExpired:
            return QualimetryReport(ok=False, duplicate_pct=0.0, error="jscpd timed out")
        except FileNotFoundError:
            return QualimetryReport(ok=False, duplicate_pct=0.0, error="npx not found")

        json_files = sorted(Path(tmp).glob("*.json"))
        if not json_files:
            return QualimetryReport(
                ok=True,
                duplicate_pct=0.0,
                summary="No jscpd report generated — no duplicates detected",
            )

        try:
            data = json.loads(json_files[0].read_text())
        except (json.JSONDecodeError, OSError) as exc:
            return QualimetryReport(ok=False, duplicate_pct=0.0, error=str(exc))

    statistics = data.get("statistics", {})
    total = statistics.get("total", {})
    duplicated_lines = total.get("duplicatedLines", 0)
    total_lines = max(total.get("lines", 1), 1)
    pct = round((duplicated_lines / total_lines) * 100, 2)

    clones: list[dict] = data.get("duplicates", [])
    ok = pct <= DUPLICATE_THRESHOLD_PCT

    lines = [f"Code duplication: {pct}% ({duplicated_lines}/{total_lines} lines)"]
    if not ok:
        lines.append(
            f"❌ QUALIMETRY FAILED: {pct}% exceeds threshold {DUPLICATE_THRESHOLD_PCT}%"
        )
        for clone in clones[:5]:
            first = clone.get("firstFile", {})
            second = clone.get("secondFile", {})
            lines.append(
                f"  Duplicate: {first.get('name', '?')}:{first.get('start', '?')}"
                f" ↔ {second.get('name', '?')}:{second.get('start', '?')}"
                f" ({clone.get('lines', '?')} lines)"
            )
    else:
        lines.append(f"✅ QUALIMETRY PASSED: {pct}% within threshold {DUPLICATE_THRESHOLD_PCT}%")

    return QualimetryReport(
        ok=ok,
        duplicate_pct=pct,
        duplications=clones,
        summary="\n".join(lines),
    )
