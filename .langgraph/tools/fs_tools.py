"""Filesystem tools for the LangGraph pipeline agents.

Agents use these to read, write, and inspect files inside the repository.
All paths are resolved relative to GITHUB_WORKSPACE (the checked-out repo root).
"""

import os
import shlex
import subprocess

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE", ".")


def _resolve(path: str) -> str:
    """Resolve path relative to repo root, blocking path traversal."""
    resolved = os.path.realpath(os.path.join(_REPO_ROOT, path))
    repo_real = os.path.realpath(_REPO_ROOT)
    if not resolved.startswith(repo_real + os.sep) and resolved != repo_real:
        raise ValueError(f"Path '{path}' resolves outside the repository root")
    return resolved


def read_file(path: str) -> str:
    """Read a file from the repository.

    Args:
        path: Path relative to repo root (e.g. 'src/core/mining/BlastCalc.ts').

    Returns:
        File contents as a string, or an error message if not found.
    """
    try:
        with open(_resolve(path), encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return f"error: file not found: {path}"
    except ValueError as exc:
        return f"error: {exc}"


def write_file(path: str, content: str) -> str:
    """Write (create or overwrite) a file in the repository.

    Args:
        path: Path relative to repo root.
        content: Full file contents to write.

    Returns:
        Confirmation message.
    """
    try:
        resolved = _resolve(path)
        os.makedirs(os.path.dirname(resolved), exist_ok=True)
        with open(resolved, "w", encoding="utf-8") as f:
            f.write(content)
        return f"wrote {path} ({len(content)} chars)"
    except ValueError as exc:
        return f"error: {exc}"


def delete_file(path: str) -> str:
    """Delete a file from the repository.

    Args:
        path: Path relative to repo root.

    Returns:
        Confirmation message or error.
    """
    try:
        resolved = _resolve(path)
        os.remove(resolved)
        return f"deleted {path}"
    except FileNotFoundError:
        return f"error: file not found: {path}"
    except ValueError as exc:
        return f"error: {exc}"


def list_dir(path: str = ".") -> str:
    """List files and directories at a path.

    Args:
        path: Path relative to repo root (default: repo root).

    Returns:
        Newline-separated list of entries, or error message.
    """
    try:
        resolved = _resolve(path)
        entries = sorted(os.listdir(resolved))
        return "\n".join(entries) if entries else "(empty directory)"
    except FileNotFoundError:
        return f"error: directory not found: {path}"
    except ValueError as exc:
        return f"error: {exc}"


def grep(pattern: str, path: str = ".", flags: str = "") -> str:
    """Search for a pattern in files using ripgrep (falls back to grep).

    Args:
        pattern: Regular expression pattern to search for.
        path: Directory or file path relative to repo root (default: repo root).
        flags: Extra flags to pass to rg/grep (e.g. '-i' for case-insensitive).

    Returns:
        Matching lines with file:line format, or 'no matches'.
    """
    try:
        resolved = _resolve(path)
    except ValueError as exc:
        return f"error: {exc}"

    # Try ripgrep first, fall back to grep
    flag_args = shlex.split(flags) if flags else []
    for cmd in [["rg", "--no-heading", "-n"], ["grep", "-rn"]]:
        try:
            args = cmd + flag_args + [pattern, resolved]
            result = subprocess.run(
                args, capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                return result.stdout.strip() or "no matches"
            if result.returncode == 1:
                return "no matches"
            # returncode > 1 means error — try fallback
        except FileNotFoundError:
            continue
        except subprocess.TimeoutExpired:
            return "error: search timed out"
    return "error: neither rg nor grep is available"
