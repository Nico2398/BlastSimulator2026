"""TODO list tool for LangGraph pipeline agents.

Each agent can maintain a private TODO list to break down its work into steps,
track progress, and avoid missing tasks. The list is stored in a temp file so
it survives multiple tool calls within the same agent session.

Storage: <tempdir>/langgraph_todo_<issue_number>.json  (tempdir = tempfile.gettempdir(),
cross-platform on Linux, macOS, and Windows).
Issue number is read from the ISSUE_NUMBER env var (always set by the workflow).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

_TODO_DIR = Path(tempfile.gettempdir())


def _todo_file() -> Path:
    issue = os.environ.get("ISSUE_NUMBER", "0")
    return _TODO_DIR / f"langgraph_todo_{issue}.json"


def _load() -> list[dict]:
    f = _todo_file()
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _save(tasks: list[dict]) -> None:
    _todo_file().write_text(json.dumps(tasks, indent=2), encoding="utf-8")


def todo_add(task: str) -> str:
    """Add a new task to the agent's TODO list.

    Args:
        task: Short description of the sub-task to track (e.g. 'write tests for VoxelGrid.clearVoxel').

    Returns:
        Confirmation with the task index.
    """
    tasks = _load()
    tasks.append({"task": task.strip(), "done": False})
    _save(tasks)
    return f"[{len(tasks)}] ☐ {task.strip()}"


def todo_list() -> str:
    """Show all pending and completed TODO items.

    Returns:
        Numbered list with ☐ (pending) or ☑ (done) status.
    """
    tasks = _load()
    if not tasks:
        return "(empty TODO list — use todo_add to plan your work)"
    lines = []
    for i, t in enumerate(tasks, 1):
        mark = "☑" if t["done"] else "☐"
        lines.append(f"[{i}] {mark} {t['task']}")
    done = sum(1 for t in tasks if t["done"])
    lines.append(f"\n{done}/{len(tasks)} done")
    return "\n".join(lines)


def todo_done(index: int) -> str:
    """Mark a TODO item as completed by its 1-based index.

    Args:
        index: 1-based position in the list (from todo_list output).

    Returns:
        Confirmation or error if index is out of range.
    """
    tasks = _load()
    if index < 1 or index > len(tasks):
        return f"error: index {index} out of range (1–{len(tasks)})"
    tasks[index - 1]["done"] = True
    _save(tasks)
    return f"[{index}] ☑ {tasks[index - 1]['task']}"


def todo_clear() -> str:
    """Remove all completed tasks from the TODO list.

    Returns:
        How many items were removed.
    """
    tasks = _load()
    before = len(tasks)
    tasks = [t for t in tasks if not t["done"]]
    _save(tasks)
    removed = before - len(tasks)
    return f"cleared {removed} completed task(s); {len(tasks)} remaining"
