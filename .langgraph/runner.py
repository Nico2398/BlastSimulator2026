"""BlastSimulator2026 LangGraph pipeline runner.

Entrypoint for both GitHub Actions CI and local CLI execution.

GitHub Actions usage (env vars set by workflow):
    uv run python runner.py

Local CLI usage:
    uv run python runner.py --issue 42 --comment "implement navmesh ramp routing"
    uv run python runner.py --issue 42  # uses COMMENT_BODY env var or empty string
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

# Add this dir to sys.path so graph/tool imports work
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

    log.info("Building graph...")
    graph = build_graph()

    config = {
        "configurable": {
            "thread_id": str(issue_number),
        }
    }

    initial_state = {
        "issue_number": issue_number,
        "comment_body": comment_body,
        "messages": [],
        "retry_count": 0,
        "branch_name": "",
        "pr_number": None,
        "test_writer_ok": False,
        "implementer_ok": False,
        "refactorer_ok": False,
        "validator_ok": False,
        "visual_tester_ok": False,
        "reviewer_ok": False,
        "awaiting_human": False,
        "human_feedback": None,
        "issue_title": "",
        "issue_body": "",
        "issue_labels": [],
        "pipeline": "",
        "skill": "",
        "current_role": "",
    }

    log.info(f"Starting pipeline for issue #{issue_number}")
    log.info(f"Comment: {comment_body!r}")

    # Stream events for live progress logging
    async for event in graph.astream_events(initial_state, config=config, version="v2"):
        kind = event.get("event", "")
        name = event.get("name", "")

        if kind == "on_chain_start" and name not in ("LangGraph", ""):
            log.info(f"→ Node starting: {name}")

        elif kind == "on_chain_end" and name not in ("LangGraph", ""):
            data = event.get("data", {})
            output = data.get("output", {})
            role = output.get("current_role", name) if isinstance(output, dict) else name
            ok_key = f"{role.replace('-', '_')}_ok"
            if isinstance(output, dict) and ok_key in output:
                status = "✅" if output[ok_key] else "❌"
                log.info(f"← Node done: {role} {status}")
            else:
                log.info(f"← Node done: {name}")

        elif kind == "on_chain_error":
            err = event.get("data", {}).get("error", "unknown error")
            log.error(f"Pipeline error in {name}: {err}")

    log.info("Pipeline complete.")


def main() -> None:
    args = _parse_args()

    # Override LLM_MODEL_ID if --model passed
    if args.model:
        os.environ["LLM_MODEL_ID"] = args.model

    # Resolve issue number: CLI arg > env var > fail
    issue_number = args.issue or int(os.environ.get("ISSUE_NUMBER", "0") or "0")
    if not issue_number:
        print("Error: issue number required. Use --issue N or set ISSUE_NUMBER env var.", file=sys.stderr)
        sys.exit(1)

    # Resolve comment body: CLI arg > env var > empty string
    comment_body = args.comment if args.comment is not None else os.environ.get("COMMENT_BODY", "")

    asyncio.run(run(issue_number, comment_body))


if __name__ == "__main__":
    main()
