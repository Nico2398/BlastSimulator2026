#!/usr/bin/env bash
# Block mutating git and gh commands for non-pipeline subagents.
# Called as a PreToolUse hook (matcher: "Bash") via agent frontmatter.
# Claude Code passes tool input as JSON on stdin.
#
# Exit 2 = block the tool call and show stderr to the agent.
# Exit 0 = allow.

set -uo pipefail

raw=$(cat)

# Extract .tool_input.command, collapse whitespace. Falls back to the raw
# payload when python3 is unavailable, which fails closed on the patterns below.
if command -v python3 >/dev/null 2>&1; then
    cmd=$(printf '%s' "$raw" | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print(" ".join((data.get("tool_input") or {}).get("command", "").split()))')
else
    cmd=$(printf '%s' "$raw" | tr -s '[:space:]' ' ')
fi

[ -z "$cmd" ] && exit 0

git_mutating='^git (add|am|apply|bisect|checkout|cherry-pick|clean|clone|commit|fetch|init|merge|mv|pull|push|rebase|reset|restore|revert|rm|sparse-checkout|stash|submodule|switch|worktree)( |$)
^git blame --edit( |$)
^git branch (-D|-d|-m|-M|-c|-C|--delete|--move|--copy)( |$)
^git tag (-a|-d|-f|-s|-m)( |$)'

gh_mutating='^gh auth( |$)
^gh pr (checkout|close|comment|create|edit|merge|ready|reopen|review|update-branch)( |$)
^gh issue (close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)( |$)
^gh label (clone|create|delete|edit)( |$)
^gh release (create|delete|edit|upload)( |$)
^gh repo (archive|clone|create|delete|edit|fork|rename|set-default|sync)( |$)
^gh secret( |$)
^gh variable( |$)
^gh workflow (disable|enable|run)( |$)'

matches_any() {
    local value=$1 patterns=$2 pattern
    while IFS= read -r pattern; do
        [ -z "$pattern" ] && continue
        if printf '%s' "$value" | grep -Eq "$pattern"; then
            return 0
        fi
    done <<<"$patterns"
    return 1
}

# `git branch` / `git tag` with no mutating flag are read-only listings.
if printf '%s' "$cmd" | grep -Eq '^git( |$)'; then
    if matches_any "$cmd" "$git_mutating"; then
        echo "Mutating git commands are not allowed in this agent. Use the pipeline orchestrator for git write operations." >&2
        exit 2
    fi
fi

if printf '%s' "$cmd" | grep -Eq '^gh( |$)'; then
    is_mutating_api=false
    if printf '%s' "$cmd" | grep -Eq '^gh api( |$)' \
        && printf '%s' "$cmd" | grep -Eq '(^| )(--method|-X) ?(POST|PUT|PATCH|DELETE)( |$)'; then
        is_mutating_api=true
    fi
    if matches_any "$cmd" "$gh_mutating" || [ "$is_mutating_api" = true ]; then
        echo "Mutating gh commands are not allowed in this agent. Use the pipeline orchestrator for GitHub write operations." >&2
        exit 2
    fi
fi

exit 0
