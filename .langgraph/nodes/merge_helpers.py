"""Shared helpers for merge operations.

Risk tier assessment extracted from cherry_pick.py for reuse in merge_branches.
"""


_SECURITY_SENSITIVE = [
    "auth", "crypto", "password", "secret", "token", "permission",
    "security", "login", "session",
]


def _assess_risk_tier(changed_files: list[str], diff_text: str) -> str:
    """Classify the diff into a risk tier for review depth control.

    Tiers:
      trivial — ≤10 changed lines, ≤5 files, no security-sensitive paths.
      lite    — ≤100 changed lines, ≤15 files, no security-sensitive paths.
      full    — >100 lines or >15 files or security-sensitive paths touched.
    """
    file_count = len(changed_files)
    lines_changed = sum(
        1 for line in diff_text.splitlines()
        if line.startswith("+") or line.startswith("-")
    ) // 2

    has_security_files = any(
        any(s in f.lower() for s in _SECURITY_SENSITIVE)
        for f in changed_files
    )
    if has_security_files:
        return "full"

    if file_count <= 5 and lines_changed <= 10:
        return "trivial"
    if file_count <= 15 and lines_changed <= 100:
        return "lite"
    return "full"
