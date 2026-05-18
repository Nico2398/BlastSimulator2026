"""BlastSimulator2026 LangGraph pipeline graph.

Defines the StateGraph with 5 pipeline paths:
  implement-feature: orchestrate → test-writer → implementer → refactorer → validator → open-pr
  fix-bug:           orchestrate → implementer → validator → open-pr
  review-pr:         orchestrate → reviewer → END
  visual-change:     orchestrate → test-writer → implementer → refactorer → validator → visual-tester → open-pr
  investigate:       orchestrate → implementer → END (read-only, posts comment)

Retry logic:
  validator fails → back to implementer (max MAX_RETRIES times)
  After MAX_RETRIES: interrupt() to request human guidance

Human-in-the-loop via langgraph.types.interrupt():
  Suspends the run and waits for human input via state update.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

# Add this dir to sys.path so tool/node imports work
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
from nodes.test_writer import test_writer
from nodes.implementer import implementer
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

    # Set by orchestrate node
    issue_title: str
    issue_body: str
    issue_labels: list[str]
    pipeline: str      # 'implement-feature' | 'fix-bug' | 'review-pr' | 'visual-change' | 'investigate'
    skill: str         # optional domain skill name

    # Message history (append-only via add_messages reducer)
    messages: Annotated[list[BaseMessage], add_messages]

    # Execution tracking
    current_role: str
    branch_name: str
    pr_number: int | None
    retry_count: int

    # Per-node success flags
    test_writer_ok: bool
    implementer_ok: bool
    refactorer_ok: bool
    validator_ok: bool
    visual_tester_ok: bool
    reviewer_ok: bool

    # Human-in-the-loop
    human_feedback: str | None
    awaiting_human: bool


# ---------------------------------------------------------------------------
# Routing functions (conditional edges)
# ---------------------------------------------------------------------------


def _route_from_orchestrate(state: AgentState) -> str:
    pipeline = state.get("pipeline", "implement-feature")
    match pipeline:
        case "fix-bug":
            return "implementer"
        case "review-pr":
            return "reviewer"
        case "investigate":
            return "implementer"
        case "visual-change":
            return "test_writer"
        case _:  # implement-feature (default)
            return "test_writer"


def _route_from_test_writer(state: AgentState) -> str:
    if state.get("test_writer_ok", False):
        return "implementer"
    retry = state.get("retry_count", 0)
    if retry >= MAX_RETRIES:
        return "__interrupt__"
    return "test_writer"  # retry


def _route_from_implementer(state: AgentState) -> str:
    pipeline = state.get("pipeline", "implement-feature")
    if pipeline == "investigate":
        return END
    if state.get("implementer_ok", False):
        return "refactorer"
    retry = state.get("retry_count", 0)
    if retry >= MAX_RETRIES:
        return "__interrupt__"
    return "implementer"  # retry


def _route_from_refactorer(state: AgentState) -> str:
    return "validator"


def _route_from_validator(state: AgentState) -> str:
    if state.get("validator_ok", False):
        pipeline = state.get("pipeline", "implement-feature")
        if pipeline == "visual-change":
            return "visual_tester"
        return "open_pr"
    retry = state.get("retry_count", 0)
    if retry >= MAX_RETRIES:
        return "__interrupt__"
    return "implementer"  # retry with failure context


def _route_from_visual_tester(state: AgentState) -> str:
    if state.get("visual_tester_ok", False):
        return "open_pr"
    retry = state.get("retry_count", 0)
    if retry >= MAX_RETRIES:
        return "__interrupt__"
    return "implementer"  # retry with screenshot context


def _route_from_reviewer(state: AgentState) -> str:
    return END  # reviewer posts APPROVED comment itself; graph ends here


def _interrupt_node(state: AgentState) -> dict:
    """Request human intervention after max retries."""
    retry = state.get("retry_count", 0)
    role = state.get("current_role", "unknown")
    message = (
        f"Pipeline paused after {retry} failed attempts at '{role}'. "
        "Please review the error messages above and provide guidance. "
        "Update the issue with clarification, then re-trigger the workflow."
    )
    interrupt(message)
    return {"awaiting_human": True, "human_feedback": None}


# ---------------------------------------------------------------------------
# Graph factory
# ---------------------------------------------------------------------------


def build_graph():
    """Build and compile the BlastSimulator2026 LangGraph pipeline.

    Returns:
        A compiled LangGraph CompiledStateGraph ready to invoke.
    """
    builder = StateGraph(AgentState)

    # --- Nodes ---
    builder.add_node("orchestrate", orchestrate)
    builder.add_node("test_writer", test_writer)
    builder.add_node("implementer", implementer)
    builder.add_node("refactorer", refactorer)
    builder.add_node("validator", validator)
    builder.add_node("visual_tester", visual_tester)
    builder.add_node("reviewer", reviewer)
    builder.add_node("open_pr", open_pr)
    builder.add_node("__interrupt__", _interrupt_node)

    # --- Entry point ---
    builder.set_entry_point("orchestrate")

    # --- Edges ---
    builder.add_conditional_edges("orchestrate", _route_from_orchestrate, {
        "test_writer": "test_writer",
        "implementer": "implementer",
        "reviewer": "reviewer",
    })

    builder.add_conditional_edges("test_writer", _route_from_test_writer, {
        "implementer": "implementer",
        "test_writer": "test_writer",
        "__interrupt__": "__interrupt__",
    })

    builder.add_conditional_edges("implementer", _route_from_implementer, {
        "refactorer": "refactorer",
        "implementer": "implementer",
        END: END,
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

    builder.add_conditional_edges("reviewer", _route_from_reviewer, {
        END: END,
    })

    builder.add_edge("open_pr", END)
    builder.add_edge("__interrupt__", END)

    checkpointer = build_checkpointer()
    return builder.compile(checkpointer=checkpointer)
