"""Git operations via gitpython.

All git operations in the LangGraph pipeline go through this module.
Uses the GITHUB_WORKSPACE env var (or CWD) as the repository root.
"""

from __future__ import annotations

import os
from pathlib import Path

import git

_REPO_ROOT = os.environ.get("GITHUB_WORKSPACE") or str(
    Path(__file__).parent.parent.parent
)


def _repo() -> git.Repo:
    return git.Repo(_REPO_ROOT, search_parent_directories=True)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def git_current_branch() -> str:
    """Return the name of the currently checked-out branch."""
    repo = _repo()
    if repo.head.is_detached:
        return repo.head.commit.hexsha[:12]
    return repo.active_branch.name


def git_get_head_sha() -> str:
    """Return the full SHA of HEAD."""
    return _repo().head.commit.hexsha


def git_get_conflict_files() -> list[str]:
    """Return a list of paths with unresolved merge/cherry-pick conflicts."""
    repo = _repo()
    return list(repo.index.unmerged_blobs().keys())


# ---------------------------------------------------------------------------
# Branch operations
# ---------------------------------------------------------------------------


def git_checkout_branch(branch: str, from_ref: str | None = None) -> str:
    """Create a new branch (optionally from a specific ref) and switch to it.

    Args:
        branch: New branch name.
        from_ref: Commit SHA or branch to start from. Defaults to HEAD.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    start = repo.commit(from_ref) if from_ref else repo.head.commit
    try:
        new_branch = repo.create_head(branch, commit=start)
        new_branch.checkout()
        return f"created and switched to branch '{branch}' from {start.hexsha[:12]}"
    except git.GitCommandError as exc:
        return f"error creating branch '{branch}': {exc}"


def git_force_checkout_branch(branch: str, from_ref: str | None = None) -> str:
    """Force-create a branch (overwriting if exists) and switch to it.
    Like ``git switch -C <branch> [<from_ref>]``.
    """
    repo = _repo()
    start = repo.commit(from_ref) if from_ref else repo.head.commit
    try:
        if any(head.name == branch for head in repo.heads):
            repo.delete_head(branch, force=True)
        new_branch = repo.create_head(branch, commit=start)
        new_branch.checkout()
        return f"created and switched to branch '{branch}' from {start.hexsha[:12]}"
    except git.GitCommandError as exc:
        return f"error creating branch '{branch}': {exc}"


def git_branch_exists(branch: str) -> bool:
    """Return True when a local branch exists."""
    repo = _repo()
    return any(head.name == branch for head in repo.heads)


def git_checkout_existing(branch: str) -> str:
    """Switch to an existing branch.

    Args:
        branch: Branch name.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    try:
        repo.git.checkout(branch)
        return f"switched to branch '{branch}'"
    except git.GitCommandError as exc:
        return f"error checking out '{branch}': {exc}"


# ---------------------------------------------------------------------------
# Commit / push
# ---------------------------------------------------------------------------


_LANGGRAPH_ACTOR = git.Actor("langgraph", "langgraph@noreply.github.com")


def git_commit(message: str) -> str:
    """Stage all changes and create a git commit.

    Args:
        message: Commit message.

    Returns:
        Short SHA and message on success, or info if nothing to commit.
    """
    repo = _repo()
    if not repo.is_dirty(untracked_files=True):
        return "nothing to commit — working tree clean"
    repo.git.add("-A")
    commit = repo.index.commit(message, author=_LANGGRAPH_ACTOR, committer=_LANGGRAPH_ACTOR)
    return f"[{commit.hexsha[:12]}] {message}"


def git_push(branch: str) -> str:
    """Push a branch to origin.

    Args:
        branch: Branch name to push.

    Returns:
        Confirmation message.
    """
    repo = _repo()
    try:
        result = repo.git.push("--set-upstream", "origin", branch)
        return result or f"pushed '{branch}' to origin"
    except git.GitCommandError as exc:
        return f"error pushing '{branch}': {exc}"


# ---------------------------------------------------------------------------
# Cherry-pick
# ---------------------------------------------------------------------------


def git_cherry_pick(commit_sha: str) -> tuple[bool, list[str]]:
    """Cherry-pick a commit onto the current branch.

    Args:
        commit_sha: The full or short commit SHA to cherry-pick.

    Returns:
        (success, conflict_files) — success=True means clean pick.
    """
    repo = _repo()
    try:
        repo.git.cherry_pick(commit_sha)
        return True, []
    except git.GitCommandError:
        conflicts = git_get_conflict_files()
        return False, conflicts


def git_abort_cherry_pick() -> str:
    """Abort an in-progress cherry-pick."""
    repo = _repo()
    try:
        repo.git.cherry_pick("--abort")
        return "cherry-pick aborted"
    except git.GitCommandError as exc:
        return f"error aborting cherry-pick: {exc}"


def git_continue_cherry_pick(message: str) -> str:
    """Stage all resolved files and finish the cherry-pick.

    Args:
        message: Commit message for the resolved cherry-pick.

    Returns:
        Confirmation message with new commit SHA.
    """
    repo = _repo()
    repo.git.add("-A")
    try:
        repo.git.cherry_pick("--continue", "--no-edit")
        sha = repo.head.commit.hexsha[:12]
        return f"cherry-pick continued: [{sha}]"
    except git.GitCommandError:
        # Fall back to a regular commit if --continue fails
        commit = repo.index.commit(message, author=_LANGGRAPH_ACTOR, committer=_LANGGRAPH_ACTOR)
        return f"cherry-pick resolved via commit: [{commit.hexsha[:12]}]"


# ---------------------------------------------------------------------------
# Diff helpers
# ---------------------------------------------------------------------------


def git_diff_since(ref: str) -> tuple[str, list[str]]:
    """Return the diff and list of changed file paths since a given ref.

    Args:
        ref: Commit SHA or branch to diff against (e.g. skeleton_commit_sha).

    Returns:
        (diff_text, changed_files) — diff_text is the full unified diff,
        changed_files is a list of file paths modified/added/deleted.
    """
    repo = _repo()
    try:
        diff_text = repo.git.diff(ref, "--", no_color=True)
        # Parse changed files from the diff
        diff_names = repo.git.diff(ref, "--name-only").strip()
        changed_files = [f for f in diff_names.splitlines() if f] if diff_names else []
        return diff_text, changed_files
    except git.GitCommandError as exc:
        return f"error computing diff: {exc}", []


def git_write_diff_to_file(ref: str, dest_dir: str = ".langgraph/diffs") -> tuple[str, list[str]]:
    """Write per-file patches to disk and return (diff_dir, changed_files).

    Instead of embedding the full diff in agent prompts (token waste),
    write each changed file's patch to a separate file in dest_dir.
    Agents read only the patches they need via read_file tool.

    Also writes a shared summary file with file list and stats.

    Noise files (lock files, vendored deps, generated assets) are excluded
    from patches — agents never see them.

    Returns:
        (diff_dir_path, changed_files) — absolute path to diff directory,
        list of changed file paths (noise files excluded).
    """
    import re

    diff_text, changed_files = git_diff_since(ref)
    if not diff_text or diff_text.startswith("error"):
        return "", changed_files

    diff_dir = Path(_REPO_ROOT) / dest_dir
    diff_dir.mkdir(parents=True, exist_ok=True)

    # --- Noise filtering: skip files that don't need review ---
    _NOISE_PATTERNS = [
        # Lock files
        "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
        "Cargo.lock", "go.sum", "poetry.lock", "Pipfile.lock", "flake.lock",
        # Vendored / generated
        "node_modules/", "vendor/", ".venv/",
        # Minified / bundled assets
        ".min.js", ".min.css", ".bundle.js", ".map",
        # Generated files (unless they're DB migrations)
        ".generated.", ".auto.",
    ]
    _NOISE_EXTENSIONS = {".lock", ".min.js", ".min.css", ".map", ".svg", ".ico"}

    def _is_noise(filepath: str) -> bool:
        """Return True if the file should be excluded from review."""
        lower = filepath.lower()
        # Check extension
        if any(lower.endswith(ext) for ext in _NOISE_EXTENSIONS):
            return True
        # Check known noise patterns
        if any(pat.lower() in lower for pat in _NOISE_PATTERNS):
            return True
        # DB migrations are never noise even if "generated"
        if "migration" in lower:
            return False
        return False

    # Split unified diff into per-file patches.
    # A new file's diff starts with "diff --git a/..." at the beginning of a line.
    file_patches: dict[str, str] = {}
    current_file: str | None = None
    current_lines: list[str] = []

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            # Flush previous file
            if current_file and current_lines:
                file_patches[current_file] = "\n".join(current_lines)
            # Extract file path from "diff --git a/path b/path"
            match = re.match(r"diff --git a/(.+?) b/(.+)", line)
            current_file = match.group(2) if match else "unknown"
            current_lines = [line]
        else:
            current_lines.append(line)

    # Flush last file
    if current_file and current_lines:
        file_patches[current_file] = "\n".join(current_lines)

    # Filter out noise files
    filtered_files = [f for f in changed_files if not _is_noise(f)]
    filtered_patches = {f: p for f, p in file_patches.items() if not _is_noise(f)}

    # Write each patch to a file (slug the path for safety)
    for filepath, patch in filtered_patches.items():
        safe_name = filepath.replace("/", "__").replace("\\", "__")
        (diff_dir / f"{safe_name}.patch").write_text(patch, encoding="utf-8")

    # Write shared summary
    summary_lines = [
        f"Diff vs {ref}",
        f"Files changed: {len(filtered_files)} ({len(changed_files) - len(filtered_files)} noise files excluded)",
        "",
        "## Changed Files",
    ]
    for f in filtered_files:
        patch_lines = filtered_patches.get(f, "")
        added = sum(1 for l in patch_lines.splitlines() if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in patch_lines.splitlines() if l.startswith("-") and not l.startswith("---"))
        summary_lines.append(f"  {f} (+{added}/-{removed})")

    summary_lines.extend([
        "",
        "## Patch Files",
        "Each changed file has a .patch file in this directory.",
        "Use read_file to read specific patches instead of the full diff.",
    ])
    for f in filtered_files:
        safe_name = f.replace("/", "__").replace("\\", "__")
        summary_lines.append(f"  {safe_name}.patch → {f}")

    (diff_dir / "SUMMARY.md").write_text("\n".join(summary_lines), encoding="utf-8")

    return str(diff_dir), filtered_files
