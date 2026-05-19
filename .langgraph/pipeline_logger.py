"""pipeline_logger — structured log streaming for the LangGraph pipeline.

Processes `astream_events` (LangGraph v2) and emits:
  - GitHub Actions collapsible groups (::group:: / ::endgroup::) per node
  - Tool call traces for agentic nodes  (on_tool_start / on_tool_end)
  - LLM final response per step         (on_chat_model_end)
  - Full structured output for non-agentic nodes (test_runner, qualimetry, …)

Non-agentic nodes log their return dict directly; agentic nodes log tool calls
and LLM outputs so every agent decision is traceable from CI logs alone.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("runner")

# True when running inside GitHub Actions.
_IN_GHA: bool = os.environ.get("GITHUB_ACTIONS") == "true"

# Max chars for tool inputs/outputs and LLM responses before truncation.
_TRUNCATE = 600

# Deterministic nodes — no LLM, we print their full return dict directly.
_NON_AGENTIC = frozenset({
    "orchestrate", "skeleton_writer", "cherry_pick",
    "test_runner", "qualimetry", "open_pr", "__interrupt__",
})


# ---------------------------------------------------------------------------
# GitHub Actions log markers
# ---------------------------------------------------------------------------

def _gha_group(title: str) -> None:
    if _IN_GHA:
        print(f"::group::{title}", flush=True)


def _gha_endgroup() -> None:
    if _IN_GHA:
        print("::endgroup::", flush=True)


def _truncate(value: Any, limit: int = _TRUNCATE) -> str:
    s = str(value) if not isinstance(value, str) else value
    return s if len(s) <= limit else s[:limit] + f"… [{len(s) - limit} chars omitted]"


# ---------------------------------------------------------------------------
# Non-agentic node output formatter
# ---------------------------------------------------------------------------

def _log_non_agentic(node: str, output: dict) -> None:
    """Print full structured output for deterministic (non-LLM) nodes."""
    if node == "orchestrate":
        log.info("  pipeline         : %s", output.get("pipeline", ""))
        log.info("  skill            : %s", output.get("skill") or "—")
        log.info("  skip_integration : %s", output.get("skip_integration_tests", False))
        log.info("  skip_scenario    : %s", output.get("skip_scenario_tests", False))
        log.info("  test_branch      : %s", output.get("test_branch", ""))
        log.info("  impl_branch      : %s", output.get("impl_branch", ""))

    elif node == "skeleton_writer":
        ok = output.get("skeleton_writer_ok", False)
        log.info("  skeleton_writer_ok  : %s", "✅" if ok else "❌")
        sha = output.get("skeleton_commit_sha", "")
        if sha:
            log.info("  skeleton_commit_sha : %s", sha)

    elif node == "cherry_pick":
        ok = output.get("cherry_pick_ok", False)
        log.info("  cherry_pick_ok : %s", "✅" if ok else "❌")
        for path in (output.get("cherry_pick_conflicts") or []):
            log.info("  conflict : %s", path)

    elif node == "test_runner":
        ok = output.get("test_runner_ok", False)
        log.info("%s", "✅ TESTS PASSED" if ok else "❌ TESTS FAILED")
        for line in (output.get("test_output") or "").splitlines():
            log.info("  %s", line)

    elif node == "qualimetry":
        ok = output.get("qualimetry_ok", False)
        log.info("%s", "✅ QUALIMETRY PASSED" if ok else "❌ QUALIMETRY FAILED")
        for line in (output.get("qualimetry_report") or "").splitlines():
            log.info("  %s", line)

    elif node == "open_pr":
        pr = output.get("pr_number")
        if pr:
            log.info("  PR #%s opened", pr)
        else:
            log.info("  PR not created — check messages above for details")

    elif node == "__interrupt__":
        log.warning("  ⚠️  Pipeline paused — human intervention required")


def _log_end_status(node: str, output: dict) -> None:
    """Log ✅/❌ for any node using its *_ok flag."""
    role = output.get("current_role", node) if isinstance(output, dict) else node
    ok_key = f"{role.replace('-', '_')}_ok"
    if isinstance(output, dict) and ok_key in output:
        status = "✅" if output[ok_key] else "❌"
        log.info("NODE END: %s %s", node, status)
    else:
        log.info("NODE END: %s", node)


# ---------------------------------------------------------------------------
# Main stream processor
# ---------------------------------------------------------------------------

async def stream_pipeline(graph: Any, initial_state: dict, config: dict) -> None:
    """Process astream_events and emit per-node structured logs."""
    current_node: str = ""

    async for event in graph.astream_events(initial_state, config=config, version="v2"):
        kind: str = event.get("event", "")
        name: str = event.get("name", "")
        metadata: dict = event.get("metadata", {})
        data: dict = event.get("data", {})
        node: str = metadata.get("langgraph_node", "")

        # Open a new collapsible group when the active node changes.
        if node and node != current_node and node not in ("LangGraph", ""):
            if current_node:
                _gha_endgroup()
            _gha_group(f"Node: {node}")
            log.info("NODE START: %s", node)
            current_node = node

        # Top-level node ended → print structured output + status.
        if kind == "on_chain_end" and name == node and node not in ("LangGraph", ""):
            output = data.get("output") or {}
            if isinstance(output, dict):
                if node in _NON_AGENTIC:
                    _log_non_agentic(node, output)
                _log_end_status(node, output)

        # Tool call started (agentic nodes).
        elif kind == "on_tool_start" and node:
            raw = data.get("input", {})
            try:
                input_str = json.dumps(raw, ensure_ascii=False)
            except (TypeError, ValueError):
                input_str = str(raw)
            log.info("  → tool: %s(%s)", name, _truncate(input_str))

        # Tool call completed (agentic nodes).
        elif kind == "on_tool_end" and node:
            out = data.get("output", "")
            content = getattr(out, "content", None) or str(out)
            log.info("  ← tool: %s → %s", name, _truncate(content))

        # LLM step completed (agentic nodes).
        elif kind == "on_chat_model_end" and node:
            llm_out = data.get("output")
            content = getattr(llm_out, "content", None) or ""
            if content:
                log.info("  LLM: %s", _truncate(content))

        # Error in any node.
        elif kind == "on_chain_error":
            log.error("Pipeline error in %s: %s", name, data.get("error", "unknown"))

    # Close the final open group.
    if current_node:
        _gha_endgroup()
