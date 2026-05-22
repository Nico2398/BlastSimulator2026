"""Conditional-edge routing functions for the BlastSimulator2026 pipeline.

Imported by graph.py. Kept separate to stay under the 300-line file limit.

Skip flags (set by orchestrate) control which optional nodes are bypassed:
- skip_integration_tests  → unit_test_writer routes directly to implementer
- skip_scenario_tests     → integration_test_writer routes directly to implementer
- skip_code_review        → qualimetry routes directly to refactorer (or validator for fix-bug)
- skip_qualimetry         → test_runner routes directly to code_review
- skip_refactorer         → code_review routes directly to validator
- skip_visual_tester      → validator routes directly to open_pr (default True)
"""

from __future__ import annotations

from langgraph.graph import END

MAX_RETRIES = 7


def route_from_orchestrate(state: dict) -> str:
    pipeline = state.get("pipeline", "implement-feature")
    if pipeline == "review-pr":
        return "reviewer"
    if pipeline == "investigate":
        return "implementer"
    # All coding pipelines go through planner first.
    return "planner"


def route_from_planner(state: dict) -> str:
    """Route after planner: on success → skeleton_writer, on failure → retry/interrupt."""
    if state.get("planner_ok", False):
        return "skeleton_writer"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "planner"


def route_from_skeleton_writer(state: dict) -> str:
    if state.get("skeleton_writer_ok", False):
        return "test_fan_out"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "skeleton_writer"


def route_from_test_fan_in(state: dict) -> str:
    """Route after all parallel test writers complete.

    Checks all test writer success flags. If all pass → implementer.
    If any fail → handle_interrupt or retry via test_fan_out.
    """
    unit_ok = state.get("unit_test_writer_ok", False)
    integration_ok = state.get("integration_test_writer_ok", True)
    scenario_ok = state.get("scenario_test_writer_ok", True)
    all_ok = unit_ok and integration_ok and scenario_ok

    if all_ok:
        return "implementer"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "test_fan_out"


def route_from_implementer(state: dict) -> str:
    if state.get("pipeline") == "investigate":
        return END
    if state.get("implementer_ok", False):
        return "cherry_pick"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_cherry_pick(state: dict) -> str:
    if state.get("cherry_pick_ok", False):
        return "test_runner"  # run tests before qualimetry
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "conflict_resolver"


def route_from_conflict_resolver(state: dict) -> str:
    if state.get("conflict_resolver_ok", False):
        return "test_runner"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_test_runner(state: dict) -> str:
    if state.get("test_runner_ok", False):
        # Skip qualimetry when flag set (e.g. config-only, i18n-only changes)
        if state.get("skip_qualimetry"):
            return _route_after_qualimetry(state)
        return "qualimetry"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "fixer"


def route_from_fixer(state: dict) -> str:
    # After every fixer attempt, re-run tests to verify the fix.
    # If retries are exhausted, interrupt instead of attempting another fix.
    if state.get("retry_count", 0) >= MAX_RETRIES:
        return "handle_interrupt"
    return "test_runner"


def _route_after_qualimetry(state: dict) -> str:
    """Determine next step after qualimetry (or when qualimetry is skipped)."""
    if state.get("skip_code_review"):
        # Skip code_review too — route to refactorer or validator
        return _route_after_code_review(state)
    # Use fan-out review (specialized sub-reviewers + coordinator)
    return "review_fan_out"


def route_from_qualimetry(state: dict) -> str:
    if state.get("qualimetry_ok", False):
        return _route_after_qualimetry(state)
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def _route_after_code_review(state: dict) -> str:
    """Determine next step after code_review (or when code_review is skipped)."""
    if state.get("skip_refactorer"):
        # fix-bug or config-only: skip refactorer, go straight to validator
        return "validator"
    # fix-bug skips refactorer (no integration/scenario tests to worry about)
    if state.get("pipeline") == "fix-bug":
        return "validator"
    return "refactorer"


def route_from_code_review(state: dict) -> str:
    if state.get("code_review_ok", False):
        return _route_after_code_review(state)
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_review_fan_in(state: dict) -> str:
    """Route after review coordinator merges sub-reviewer findings.

    Same logic as route_from_code_review — the coordinator sets code_review_ok.
    """
    if state.get("code_review_ok", False):
        return _route_after_code_review(state)
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_refactorer(state: dict) -> str:
    if state.get("refactorer_ok", False):
        return "validator"
    retry_count = state.get("retry_count", 0)
    return "handle_interrupt" if retry_count >= MAX_RETRIES else "implementer"


def route_from_validator(state: dict) -> str:
    if state.get("validator_ok", False):
        if state.get("skip_visual_tester", True):
            return "open_pr"
        return "visual_tester"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_visual_tester(state: dict) -> str:
    if state.get("visual_tester_ok", False):
        return "open_pr"
    return "handle_interrupt" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_reviewer(_state: dict) -> str:
    return END
