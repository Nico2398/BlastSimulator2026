"""Conditional-edge routing functions for the BlastSimulator2026 pipeline.

Imported by graph.py. Kept separate to stay under the 300-line file limit.
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
    return "skeleton_writer"


def route_from_skeleton_writer(state: dict) -> str:
    if state.get("skeleton_writer_ok", False):
        return "unit_test_writer"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "skeleton_writer"


def route_from_unit_test_writer(state: dict) -> str:
    if state.get("unit_test_writer_ok", False):
        return "implementer" if state.get("skip_integration_tests") else "integration_test_writer"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "unit_test_writer"


def route_from_integration_test_writer(state: dict) -> str:
    if state.get("integration_test_writer_ok", False):
        return "implementer" if state.get("skip_scenario_tests") else "scenario_test_writer"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "integration_test_writer"


def route_from_scenario_test_writer(state: dict) -> str:
    if state.get("scenario_test_writer_ok", False):
        return "implementer"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "scenario_test_writer"


def route_from_implementer(state: dict) -> str:
    if state.get("pipeline") == "investigate":
        return END
    if state.get("implementer_ok", False):
        return "cherry_pick"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_cherry_pick(state: dict) -> str:
    if state.get("cherry_pick_ok", False):
        return "test_runner"  # run tests before qualimetry
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "conflict_resolver"


def route_from_conflict_resolver(state: dict) -> str:
    if state.get("conflict_resolver_ok", False):
        return "test_runner"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_test_runner(state: dict) -> str:
    if state.get("test_runner_ok", False):
        return "qualimetry"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "fixer"


def route_from_fixer(state: dict) -> str:
    # After every fixer attempt, re-run tests to verify the fix.
    # If retries are exhausted, interrupt instead of attempting another fix.
    if state.get("retry_count", 0) >= MAX_RETRIES:
        return "__interrupt__"
    return "test_runner"


def route_from_qualimetry(state: dict) -> str:
    if state.get("qualimetry_ok", False):
        return "code_review"  # code review gate after qualimetry
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_code_review(state: dict) -> str:
    if state.get("code_review_ok", False):
        # fix-bug skips refactorer (no integration/scenario tests to worry about)
        return "validator" if state.get("pipeline") == "fix-bug" else "refactorer"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_validator(state: dict) -> str:
    if state.get("validator_ok", False):
        return "visual_tester" if state.get("pipeline") == "visual-change" else "open_pr"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_visual_tester(state: dict) -> str:
    if state.get("visual_tester_ok", False):
        return "open_pr"
    return "__interrupt__" if state.get("retry_count", 0) >= MAX_RETRIES else "implementer"


def route_from_reviewer(_state: dict) -> str:
    return END
