"""test_runner node — non-agentic: run the test suite and report pass/fail.

Runs after cherry_pick so both tests and implementation code are present on
test_branch. No LLM is involved — pure deterministic pass/fail.

On failure: test output is saved to state as `test_output` so the fixer node
can read it without needing to re-run the suite.

retry_count is NOT incremented here — test_runner is deterministic. The same
code re-run gives the same result. The fixer node owns the retry counter.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langchain_core.messages import AIMessage

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")
_TEST_TIMEOUT = 300  # 5 minutes


def test_runner(state: dict) -> dict:
    """Run the Vitest test suite. Non-agentic — no LLM call."""
    result = subprocess.run(
        "npx vitest run --reporter verbose",
        shell=True,
        capture_output=True,
        text=True,
        cwd=_REPO_ROOT,
        timeout=_TEST_TIMEOUT,
        env={**os.environ},
    )
    output = (result.stdout + result.stderr).strip()
    ok = result.returncode == 0

    status = "✅ TESTS PASSED" if ok else "❌ TESTS FAILED"
    message = AIMessage(content=f"[test_runner]\n{status}\n\n{output}")

    return {
        "messages": [message],
        "test_runner_ok": ok,
        "test_output": output,
        "current_role": "test-runner",
        # retry_count deliberately not modified — fixer owns that counter.
    }
