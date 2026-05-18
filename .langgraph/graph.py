"""BlastSimulator2026 LangGraph pipeline graph.

Pipeline paths:
  implement-feature  orchestrate → unit-tests → integration-tests → scenario-tests
                     → implementer → qualimetry → refactorer → validator → open-pr
  fix-bug            orchestrate → unit-tests → implementer → qualimetry → validator → open-pr
  review-pr          orchestrate → reviewer → END
  visual-change      same as implement-feature + visual-tester before open-pr
  investigate        orchestrate → implementer (read-only) → END

Test writers:
  unit_test_writer         always runs (except investigate/review-pr)
  integration_test_writer  skipped when skip_integration_tests=True (e.g. fix-bug)
  scenario_test_writer     skipped when skip_scenario_tests=True (e.g. fix-bug)

Qualimetry:
  Non-agentic node after implementer. Uses jscpd to detect code duplication.
  Fails and returns to implementer when duplication exceeds threshold.

Retry: any coding node fail → back to implementer, max MAX_RETRIES times.
       After MAX_RETRIES: interrupt() posts a comment and suspends the run.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.types import interrupt
from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict

from checkpointer import build_checkpointer
from nodes.orchestrate import orchestrate
from nodes.unit_test_writer import unit_test_writer
from nodes.integration_test_writer import integration_test_writer
from nodes.scenario_test_writer import scenario_test_writer
from nodes.implementer import implementer
from nodes.qualimetry_node import qualimetry_node
from nodes.refactorer import refactorer
from nodes.validator import validator
from nodes.visual_tester import visual_tester
from nodes.reviewer import reviewer
from nodes.open_pr import open_pr

MAX_RETRIES = 3


# ---------------------------------------------------------------------------
# State schema
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    # Inputs
    issue_number: int
    comment_body: str

    # Set by orchestrate
    issue_title: str
    issue_body: str
    issue_labels: list[str]
    pipeline: str   # implement-feature | fix-bug | review-pr | visual-change | investigate
    skill: str      # optional domain skill name
    skip_integration_tests: bool
    skip_scenario_tests: bool

    # Message history (append-only)
    messages: Annotated[list[BaseMessage], add_messages]

    # Execution tracking
    current_role: str
    branch_name: str
    pr_number: int | None
    retry_count: int

    # Per-node success flags
    unit_test_writer_ok: bool
    integration_test_writer_ok: bool
    scenario_test_writer_ok: bool
    implementer_ok: bool
    qualimetry_ok: bool
    qualimetry_report: str
    refactorer_ok: bool
    validator_ok: bool
    visual_tester_ok: bool
    reviewer_ok: bool

    # Human-in-the-loop
    human_feedback: str | None
    awaiting_human: bool


# ---------------------------------------------------------------------------
# Routing helpers
# ---------------------------------------------------------------------------


def _route_from_orchestrate(state: AgentState) -> str:
    pipeline = state.get("pipeline", "implement-feature")
    if pipeline == "review-pr":
        return "reviewer"
    if pipeline == "investigate":
        return "implementer"
    return "unit_test_writer"  # fix-bug, implement-feature, visual-change


def _route_from_unit_test_writer(state: AgentState) -> str:
    if state.get("unit_test_writer_ok", False):
        if state.get("skip_integration_tests", False):
            return "implementer"
        return "integration_test_writer"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "unit_test_writer"


def _route_from_integration_test_writer(state: AgentState) -> str:
    if state.get("integration_test_writer_ok", False):
        if state.get("skip_scenario_tests", False):
            return "implementer"
        return "scenario_test_writer"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "integration_test_writer"


def _route_from_scenario_test_writer(state: AgentState) -> str:
    if state.get("scenario_test_writer_ok", False):
        return "implementer"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "scenario_test_writer"


def _route_from_implementer(state: AgentState) -> str:
    if state.get("pipeline") == "investigate":
        return END
    if state.get("implementer_ok", False):
        return "qualimetry"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "implementer"


def _route_from_qualimetry(state: AgentState) -> str:
    if state.get("qualimetry_ok", False):
        pipeline = state.get("pipeline", "implement-feature")
        return "validator" if pipeline == "fix-bug" else "refactorer"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "implementer"


def _route_from_validator(state: AgentState) -> str:
    if state.get("validator_ok", False):
        return "visual_tester" if state.get("pipeline") == "visual-change" else "open_pr"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "implementer"


def _route_from_visual_tester(state: AgentState) -> str:
    if state.get("visual_tester_ok", False):
        return "open_pr"
    retry = state.get("retry_count", 0)
    return "__interrupt__" if retry >= MAX_RETRIES else "implementer"


def _interrupt_node(state: AgentState) -> dict:
    """Request human intervention after max retries."""
    message = (
        f"Pipeline paused after {state.get('retry_count', 0)} failed attempts "
        f"at '{state.get('current_role', 'unknown')}'. "
        "Review the errors above, add clarification to the issue, then re-trigger."
    )
    interrupt(message)
    return {"awaiting_human": True, "human_feedback": None}


# ---------------------------------------------------------------------------
# Graph factory
# ---------------------------------------------------------------------------


def build_graph():
    """Build and compile the BlastSimulator2026 LangGraph pipeline."""
    builder = StateGraph(AgentState)

    builder.add_node("orchestrate", orchestrate)
    builder.add_node("unit_test_writer", unit_test_writer)
    builder.add_node("integration_test_writer", integration_test_writer)
    builder.add_node("scenario_test_writer", scenario_test_writer)
    builder.add_node("implementer", implementer)
    builder.add_node("qualimetry", qualimetry_node)
    builder.add_node("refactorer", refactorer)
    builder.add_node("validator", validator)
    builder.add_node("visual_tester", visual_tester)
    builder.add_node("reviewer", reviewer)
    builder.add_node("open_pr", open_pr)
    builder.add_node("__interrupt__", _interrupt_node)

    builder.set_entry_point("orchestrate")

    builder.add_conditional_edges("orchestrate", _route_from_orchestrate, {
        "unit_test_writer": "unit_test_writer",
        "implementer": "implementer",
        "reviewer": "reviewer",
    })
    builder.add_conditional_edges("unit_test_writer", _route_from_unit_test_writer, {
        "integration_test_writer": "integration_test_writer",
        "implementer": "implementer",
        "unit_test_writer": "unit_test_writer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("integration_test_writer", _route_from_integration_test_writer, {
        "scenario_test_writer": "scenario_test_writer",
        "implementer": "implementer",
        "integration_test_writer": "integration_test_writer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("scenario_test_writer", _route_from_scenario_test_writer, {
        "implementer": "implementer",
        "scenario_test_writer": "scenario_test_writer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("implementer", _route_from_implementer, {
        "qualimetry": "qualimetry",
        "implementer": "implementer",
        END: END,
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("qualimetry", _route_from_qualimetry, {
        "refactorer": "refactorer",
        "validator": "validator",
        "implementer": "implementer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_edge("refactorer", "validator")
    builder.add_conditional_edges("validator", _route_from_validator, {
        "open_pr": "open_pr",
        "visual_tester": "visual_tester",
        "implementer": "implementer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("visual_tester", _route_from_visual_tester, {
        "open_pr": "open_pr",
        "implementer": "implementer",
        "__interrupt__": "__interrupt__",
    })
    builder.add_conditional_edges("reviewer", lambda _: END, {END: END})
    builder.add_edge("open_pr", END)
    builder.add_edge("__interrupt__", END)

    return builder.compile(checkpointer=build_checkpointer())
