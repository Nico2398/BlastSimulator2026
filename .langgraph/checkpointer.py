"""Checkpointer factory for the BlastSimulator2026 LangGraph pipeline.

Returns a LangGraph checkpointer appropriate for the current environment:
  - MemorySaver  (default) — in-memory, no setup required, used locally
  - AsyncPostgresSaver — persistent, used in CI if DATABASE_URL is set

The checkpointer enables:
  - Resume from any node after failure
  - Human-in-the-loop via interrupt() + resume
  - Thread-based isolation between concurrent runs
"""

import os


def build_checkpointer():
    """Return the appropriate LangGraph checkpointer.

    Uses AsyncPostgresSaver if DATABASE_URL env var is set,
    otherwise falls back to MemorySaver (in-process, no persistence).

    Returns:
        A LangGraph BaseCheckpointSaver instance.
    """
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url:
        return _build_postgres(db_url)
    return _build_memory()


def _build_memory():
    from langgraph.checkpoint.memory import MemorySaver
    return MemorySaver()


def _build_postgres(db_url: str):
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError as exc:
        raise ImportError(
            "langgraph-checkpoint-postgres not installed. "
            "Run: uv add langgraph-checkpoint-postgres"
        ) from exc
    return AsyncPostgresSaver.from_conn_string(db_url)
