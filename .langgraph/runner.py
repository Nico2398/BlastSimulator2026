"""BlastSimulator2026 LangGraph pipeline runner.

Entrypoint for both GitHub Actions CI and local CLI execution.

GitHub Actions usage (env vars set by workflow):
    uv run python runner.py

Local CLI usage:
    uv run python runner.py --issue 42 --comment "implement navmesh ramp routing"
    uv run python runner.py --issue 42  # uses COMMENT_BODY env var or empty string

Logging strategy
----------------
All per-node log formatting is handled by pipeline_logger.py. Each graph node
produces a collapsible group in GitHub Actions (::group:: / ::endgroup::).
Inside each group:
  - Agentic nodes: tool calls + LLM final response
  - Non-agentic nodes: full structured output (test results, qualimetry report, …)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("runner")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the BlastSimulator2026 LangGraph autonomous pipeline"
    )
    parser.add_argument(
        "--issue", "-i",
        type=int,
        default=None,
        help="GitHub issue number to work on (overrides ISSUE_NUMBER env var)",
    )
    parser.add_argument(
        "--comment", "-c",
        type=str,
        default=None,
        help="Trigger comment body (overrides COMMENT_BODY env var)",
    )
    parser.add_argument(
        "--model", "-m",
        type=str,
        default=None,
        help="LLM model ID, e.g. 'deepseek:deepseek-v4-flash' (overrides LLM_MODEL_ID env var)",
    )
    return parser.parse_args()


async def run(issue_number: int, comment_body: str) -> None:
    """Invoke the pipeline graph for a given issue."""
    from graph import build_graph
    from pipeline_logger import stream_pipeline

    log.info("Building graph…")
    graph = build_graph()

    config = {"configurable": {"thread_id": str(issue_number)}}
    initial_state: dict = {
        "issue_number": issue_number,
        "comment_body": comment_body,
        "messages": [],
        "retry_count": 0,
        "pr_number": None,
        "awaiting_human": False,
        "human_feedback": None,
        "issue_title": "",
        "issue_body": "",
        "issue_labels": [],
        "pipeline": "",
        "skill": "",
        "current_role": "",
        "branch_name": "",
        "test_branch": "",
        "impl_branch": "",
        "skeleton_commit_sha": "",
        "impl_commit_sha": "",
        "skip_integration_tests": False,
        "skip_scenario_tests": False,
    }

    log.info("Starting pipeline for issue #%d", issue_number)
    log.info("Comment: %r", comment_body)

    await stream_pipeline(graph, initial_state, config)

    log.info("Pipeline complete.")


def main() -> None:
    args = _parse_args()

    if args.model:
        os.environ["LLM_MODEL_ID"] = args.model

    issue_number = args.issue or int(os.environ.get("ISSUE_NUMBER", "0") or "0")
    if not issue_number:
        print(
            "Error: issue number required. Use --issue N or set ISSUE_NUMBER env var.",
            file=sys.stderr,
        )
        sys.exit(1)

    comment_body = (
        args.comment if args.comment is not None
        else os.environ.get("COMMENT_BODY", "")
    )

    asyncio.run(run(issue_number, comment_body))


if __name__ == "__main__":
    main()
