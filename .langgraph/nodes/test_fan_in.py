"""test_fan_in — merge results from parallel test writers.

After all test writers complete, this node checks their success flags
and routes to implementer (all pass) or handle_interrupt (any fail).
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


def test_fan_in(state: dict) -> dict:
    """Merge results from parallel test writers.

    Checks all test writer success flags. If any failed, increments retry.
    Routes to implementer when all pass.
    """
    unit_ok = state.get("unit_test_writer_ok", False)
    integration_ok = state.get("integration_test_writer_ok", True)  # default True if skipped
    scenario_ok = state.get("scenario_test_writer_ok", True)  # default True if skipped

    all_ok = unit_ok and integration_ok and scenario_ok
    retry_count = state.get("retry_count", 0)
    if not all_ok:
        retry_count += 1

    return {
        "current_role": "test-fan-in",
        "retry_count": retry_count,
        # The routing function checks these flags.
    }
