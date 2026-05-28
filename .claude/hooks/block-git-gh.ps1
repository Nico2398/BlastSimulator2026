# Block mutating git and gh commands for non-pipeline subagents.
# Called as a PreToolUse hook (matcher: "Bash") via agent frontmatter.
# Claude Code passes tool input as JSON on stdin.

$raw = [Console]::In.ReadToEnd()
$data = $raw | ConvertFrom-Json
$cmd = $data.tool_input.command.Trim()

if ($cmd -match '^git\b') {
    # Allow read-only git usage while blocking mutating operations.
    if ($cmd -match '^git\s+(add|am|apply|bisect|blame\s+--edit|branch(?!\s+(-a|--all|-l|--list)\b)|checkout|cherry-pick|clean|clone|commit|fetch|init|merge|mv|pull|push|rebase|reset|restore|revert|rm|sparse-checkout|stash|submodule|switch|tag(?!\s+(-l|--list)\b)|worktree)\b') {
        Write-Error "Mutating git commands are not allowed in this agent. Use the pipeline orchestrator for git write operations."
        exit 2
    }
}

if ($cmd -match '^gh\b') {
    # Allow read-only gh usage while blocking mutating operations.
    if ($cmd -match '^gh\s+(auth|pr\s+(checkout|checks|close|comment|create|diff|edit|merge|ready|reopen|review|status|update-branch)|issue\s+(close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)|label\s+(clone|create|delete|edit)|release\s+(create|delete|edit|upload)|repo\s+(archive|clone|create|delete|edit|fork|rename|set-default|sync)|secret|variable|workflow\s+(disable|enable|run)|api\b.*(--method|-X)\s*(POST|PUT|PATCH|DELETE))\b') {
        Write-Error "Mutating gh commands are not allowed in this agent. Use the pipeline orchestrator for GitHub write operations."
        exit 2
    }
}
exit 0
