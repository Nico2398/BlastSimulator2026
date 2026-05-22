"""test_fan_out — router node that dispatches test writers in parallel.

Uses LangGraph Send API to fan-out to unit/integration/scenario test writers
concurrently. Skipped test types are not dispatched.

After all test writers complete, the test_fan_in node merges results.

Two exports:
  - test_fan_out(state) -> dict:  node function (pass-through, no state change)
  - route_from_test_fan_out(state) -> list[Send]:  conditional-edge routing
"""

from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langgraph.types import Send


def test_fan_out(state: dict) -> dict:
    """Node function — pass-through router. Returns empty dict (no state change).

    The actual fan-out logic is in route_from_test_fan_out, used as the
    conditional-edge function from this node.
    """
    return {}


def route_from_test_fan_out(state: dict) -> list[Send]:
    """Dispatch test writers in parallel based on skip flags.

    Returns a list of Send objects — one per non-skipped test writer.
    LangGraph runs them concurrently.
    """
    sends: list[Send] = []

    # Unit tests always run (even for fix-bug).
    sends.append(Send("unit_test_writer", state))

    # Integration tests: skip when flag set.
    if not state.get("skip_integration_tests", False):
        sends.append(Send("integration_test_writer", state))

    # Scenario tests: skip when flag set.
    if not state.get("skip_scenario_tests", False):
        sends.append(Send("scenario_test_writer", state))

    return sends
