"""TODO list tool for LangGraph pipeline agents.

Each agent can maintain a private TODO list to break down its work into steps,
track progress, and avoid missing tasks.

Storage: module-level dict keyed by issue number — pure Python, no I/O, no
temp files. All tool calls happen in the same process so the dict lives for
the duration of the run.
"""

from __future__ import annotations

import os

# { issue_number: [{"task": str, "done": bool}, ...] }
_TODO: dict[str, list[dict]] = {}


def _key() -> str:
    return os.environ.get("ISSUE_NUMBER", "0")


def _load() -> list[dict]:
    return _TODO.setdefault(_key(), [])


def _save(tasks: list[dict]) -> None:
    _TODO[_key()] = tasks


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
