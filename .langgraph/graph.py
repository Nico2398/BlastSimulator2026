"""BlastSimulator2026 LangGraph pipeline graph.

Pipeline paths:
  implement-feature  orchestrate → skeleton_writer → [unit-tests ‖ integration-tests ‖ scenario-tests]
                     → implementer → cherry_pick → [conflict_resolver]
                     → test_runner → [fixer] → qualimetry → code_review
                     → refactorer → validator → open_pr
  fix-bug            orchestrate → skeleton_writer → unit-tests → implementer
                     → cherry_pick → test_runner → [fixer] → qualimetry
                     → code_review → validator → open_pr
  review-pr          orchestrate → review_fan_out → [security ‖ quality ‖ i18n ‖ duplication]
                     → review_fan_in (coordinator) → reviewer → END
  visual-change      same as implement-feature + visual_tester before open_pr
  investigate        orchestrate → implementer (read-only) → END

Test writing uses fan-out parallelism: unit/integration/scenario tests run
concurrently when not skipped. A fan-in node merges results before implementer.

Quality gates (in order after cherry_pick):
  test_runner         non-agentic: runs Vitest, fails → fixer
  fixer               agentic: fixes impl from error output only (unbiased); loops back to test_runner
  qualimetry          non-agentic: jscpd syntactic duplication check; fails → implementer
  review_fan_out      dispatches parallel sub-reviewers based on risk tier
  security_reviewer   agentic: exploitable vulnerabilities (full tier only)
  quality_reviewer    agentic: architecture, conventions, naming intent, TypeScript strictness
  i18n_reviewer       agentic: hardcoded strings, locale mismatches (lite + full tiers)
  duplication_reviewer agentic: semantic duplication, non-atomic functions, generic code placement
  review_fan_in       agentic coordinator: merges all sub-reviewer findings → code_review_ok

See routing.py for all conditional-edge functions.
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
from langgraph.types import interrupt, Send
from langchain_core.messages import BaseMessage
from typing_extensions import TypedDict

from checkpointer import build_checkpointer
from nodes.orchestrate import orchestrate
from nodes.planner import planner
from nodes.skeleton_writer import skeleton_writer
from nodes.unit_test_writer import unit_test_writer
from nodes.integration_test_writer import integration_test_writer
from nodes.scenario_test_writer import scenario_test_writer
from nodes.test_fan_out import test_fan_out, route_from_test_fan_out
from nodes.test_fan_in import test_fan_in
from nodes.implementer import implementer
from nodes.qualimetry_node import qualimetry_node
from nodes.refactorer import refactorer
from nodes.validator import validator
from nodes.visual_tester import visual_tester
from nodes.reviewer import reviewer
from nodes.cherry_pick import cherry_pick
from nodes.conflict_resolver import conflict_resolver
from nodes.test_runner import test_runner
from nodes.fixer import fixer
from nodes.code_review import code_review
from nodes.review_fan_out import review_fan_out, route_from_review_fan_out, security_reviewer, quality_reviewer, i18n_reviewer, duplication_reviewer
from nodes.review_fan_in import review_fan_in
from nodes.open_pr import open_pr
from routing import (
    MAX_RETRIES,
    route_from_orchestrate,
    route_from_planner,
    route_from_skeleton_writer,
    route_from_test_fan_in,
    route_from_implementer,
    route_from_cherry_pick,
    route_from_conflict_resolver,
    route_from_test_runner,
    route_from_fixer,
    route_from_qualimetry,
    route_from_code_review,
    route_from_review_fan_in,
    route_from_refactorer,
    route_from_validator,
    route_from_visual_tester,
    route_from_reviewer,
)


# ---------------------------------------------------------------------------
# State schema
# ---------------------------------------------------------------------------


class InputState(TypedDict):
    """Only these fields are visible for input in LangGraph Studio."""
    issue_number: int
    comment_body: str


class AgentState(InputState):
    """Full pipeline state — all fields beyond InputState are internal."""

    # Set by orchestrate
    issue_title: str
    issue_body: str
    issue_labels: list[str]
    pipeline: str   # implement-feature | fix-bug | review-pr | visual-change | investigate
    skill: str
    # Step-skip flags — set by orchestrate based on issue analysis
    skip_integration_tests: bool
    skip_scenario_tests: bool
    skip_code_review: bool
    skip_qualimetry: bool
    skip_refactorer: bool
    skip_visual_tester: bool

    # Set by planner
    plan: str
    planner_ok: bool

    # Branch strategy (set by orchestrate + skeleton_writer)
    test_branch: str           # langgraph/tests-<N>  — holds tests + final code
    impl_branch: str           # langgraph/impl-<N>   — isolates implementer
    branch_name: str           # alias for test_branch
    skeleton_commit_sha: str   # HEAD of test_branch after stubs committed
    impl_commit_sha: str       # HEAD of impl_branch after implementation

    # Message history (append-only)
    messages: Annotated[list[BaseMessage], add_messages]

    # Execution tracking
    current_role: str
    pr_number: int | None
    retry_count: int

    # Per-node success flags
    skeleton_writer_ok: bool
    unit_test_writer_ok: bool
    integration_test_writer_ok: bool
    scenario_test_writer_ok: bool
    implementer_ok: bool
    cherry_pick_ok: bool
    cherry_pick_conflicts: list[str]
    conflict_resolver_ok: bool
    test_runner_ok: bool
    test_output: str
    fixer_ok: bool
    qualimetry_ok: bool
    qualimetry_report: str
    code_review_ok: bool
    code_review_report: str
    # Sub-reviewer reports (from review fan-out)
    security_review_ok: bool
    security_review_report: str
    quality_review_ok: bool
    quality_review_report: str
    i18n_review_ok: bool
    i18n_review_report: str
    duplication_review_ok: bool
    duplication_review_report: str
    refactorer_ok: bool
    validator_ok: bool
    validator_report: str
    visual_tester_ok: bool
    reviewer_ok: bool

    # Diff-aware context (computed after cherry_pick)
    changed_files: list[str]       # files modified vs skeleton_commit_sha
    git_diff: str                  # short inline diff summary (≤2000 chars)
    diff_dir: str                  # path to per-file patch directory (agents read from disk)
    risk_tier: str                 # "trivial" | "lite" | "full" — controls review depth

    # Human-in-the-loop
    human_feedback: str | None
    awaiting_human: bool

    # Human-review signal — when set, open_pr skips auto-merge and posts
    # a comment with this reason string instead. Used for tasks needing
    # artistic input or critical software design decisions.
    needs_human_review: str | None


# ---------------------------------------------------------------------------
# Interrupt node
# ---------------------------------------------------------------------------


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
    builder = StateGraph(AgentState, input=InputState)

    for name, fn in [
        ("orchestrate", orchestrate),
        ("planner", planner),
        ("skeleton_writer", skeleton_writer),
        ("test_fan_out", test_fan_out),
        ("unit_test_writer", unit_test_writer),
        ("integration_test_writer", integration_test_writer),
        ("scenario_test_writer", scenario_test_writer),
        ("test_fan_in", test_fan_in),
        ("implementer", implementer),
        ("cherry_pick", cherry_pick),
        ("conflict_resolver", conflict_resolver),
        ("test_runner", test_runner),
        ("fixer", fixer),
        ("qualimetry", qualimetry_node),
        ("code_review", code_review),
        ("review_fan_out", review_fan_out),
        ("security_reviewer", security_reviewer),
        ("quality_reviewer", quality_reviewer),
        ("i18n_reviewer", i18n_reviewer),
        ("duplication_reviewer", duplication_reviewer),
        ("review_fan_in", review_fan_in),
        ("refactorer", refactorer),
        ("validator", validator),
        ("visual_tester", visual_tester),
        ("reviewer", reviewer),
        ("open_pr", open_pr),
        ("handle_interrupt", _interrupt_node),
    ]:
        builder.add_node(name, fn)

    builder.set_entry_point("orchestrate")

    builder.add_conditional_edges("orchestrate", route_from_orchestrate, {
        "planner": "planner",
        "implementer": "implementer",
        "review_fan_out": "review_fan_out",
    })
    builder.add_conditional_edges("planner", route_from_planner, {
        "skeleton_writer": "skeleton_writer",
        "planner": "planner",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("skeleton_writer", route_from_skeleton_writer, {
        "test_fan_out": "test_fan_out",
        "skeleton_writer": "skeleton_writer",
        "handle_interrupt": "handle_interrupt",
    })
    # Fan-out: dispatches to unit/integration/scenario test writers in parallel.
    # Each test writer node sends its result to test_fan_in.
    builder.add_conditional_edges("test_fan_out", route_from_test_fan_out, ["unit_test_writer", "integration_test_writer", "scenario_test_writer"])
    # Each test writer routes to test_fan_in on completion.
    builder.add_edge("unit_test_writer", "test_fan_in")
    builder.add_edge("integration_test_writer", "test_fan_in")
    builder.add_edge("scenario_test_writer", "test_fan_in")
    # Fan-in: merges results, routes to implementer or retry.
    builder.add_conditional_edges("test_fan_in", route_from_test_fan_in, {
        "implementer": "implementer",
        "test_fan_out": "test_fan_out",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("implementer", route_from_implementer, {
        "cherry_pick": "cherry_pick",
        "implementer": "implementer",
        END: END,
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("cherry_pick", route_from_cherry_pick, {
        "test_runner": "test_runner",
        "conflict_resolver": "conflict_resolver",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("conflict_resolver", route_from_conflict_resolver, {
        "test_runner": "test_runner",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("test_runner", route_from_test_runner, {
        "qualimetry": "qualimetry",
        "review_fan_out": "review_fan_out",
        "code_review": "code_review",
        "refactorer": "refactorer",
        "validator": "validator",
        "fixer": "fixer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("fixer", route_from_fixer, {
        "test_runner": "test_runner",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("qualimetry", route_from_qualimetry, {
        "review_fan_out": "review_fan_out",
        "code_review": "code_review",
        "refactorer": "refactorer",
        "validator": "validator",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    # Fan-out: dispatches to specialized sub-reviewers in parallel.
    builder.add_conditional_edges("review_fan_out", route_from_review_fan_out, ["security_reviewer", "quality_reviewer", "i18n_reviewer", "duplication_reviewer"])
    # Each sub-reviewer routes to review_fan_in on completion.
    builder.add_edge("security_reviewer", "review_fan_in")
    builder.add_edge("quality_reviewer", "review_fan_in")
    builder.add_edge("i18n_reviewer", "review_fan_in")
    builder.add_edge("duplication_reviewer", "review_fan_in")
    # Review fan-in: coordinator merges findings, routes to refactorer, retry, or reviewer.
    builder.add_conditional_edges("review_fan_in", route_from_review_fan_in, {
        "refactorer": "refactorer",
        "validator": "validator",
        "implementer": "implementer",
        "reviewer": "reviewer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("code_review", route_from_code_review, {
        "refactorer": "refactorer",
        "validator": "validator",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("refactorer", route_from_refactorer, {
        "test_runner": "test_runner",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("validator", route_from_validator, {
        "open_pr": "open_pr",
        "visual_tester": "visual_tester",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("visual_tester", route_from_visual_tester, {
        "open_pr": "open_pr",
        "implementer": "implementer",
        "handle_interrupt": "handle_interrupt",
    })
    builder.add_conditional_edges("reviewer", route_from_reviewer, {END: END})
    builder.add_edge("open_pr", END)
    builder.add_edge("handle_interrupt", END)

    return builder.compile(checkpointer=build_checkpointer()).with_config(
        {"recursion_limit": 150}
    )
