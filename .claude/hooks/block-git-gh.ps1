# Block mutating git and gh commands for non-pipeline subagents.
# Called as a PreToolUse hook (matcher: "Bash") via agent frontmatter.
# Claude Code passes tool input as JSON on stdin.

$raw = [Console]::In.ReadToEnd()
$data = $raw | ConvertFrom-Json
$cmd = [Regex]::Replace($data.tool_input.command, '\s+', ' ').Trim()
$gitMutatingPatterns = @(
    '^git (add|am|apply|bisect|checkout|cherry-pick|clean|clone|commit|fetch|init|merge|mv|pull|push|rebase|reset|restore|revert|rm|sparse-checkout|stash|submodule|switch|worktree)\b',
    '^git blame --edit\b',
    '^git branch(?! (-a|--all|-l|--list)\b)',
    '^git tag(?! (-l|--list)\b)'
)
$ghMutatingPatterns = @(
    '^gh auth\b',
    '^gh pr (checkout|close|comment|create|edit|merge|ready|reopen|review|update-branch)\b',
    '^gh issue (close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)\b',
    '^gh label (clone|create|delete|edit)\b',
    '^gh release (create|delete|edit|upload)\b',
    '^gh repo (archive|clone|create|delete|edit|fork|rename|set-default|sync)\b',
    '^gh secret\b',
    '^gh variable\b',
    '^gh workflow (disable|enable|run)\b'
)

function Test-AnyPattern {
    param(
        [string]$value,
        [string[]]$patterns
    )

    foreach ($pattern in $patterns) {
        if ($value -match $pattern) {
            return $true
        }
    }
    return $false
}

if ($cmd -match '^git\b') {
    # Allow read-only git usage while blocking mutating operations.
    if (Test-AnyPattern $cmd $gitMutatingPatterns) {
        Write-Error "Mutating git commands are not allowed in this agent. Use the pipeline orchestrator for git write operations."
        exit 2
    }
}

if ($cmd -match '^gh\b') {
    # Allow read-only gh usage while blocking mutating operations.
    $isMutatingApiRequest = ($cmd -match '^gh api\b' -and $cmd -match '(^| )(--method|-X)\s*(POST|PUT|PATCH|DELETE)\b')
    if ((Test-AnyPattern $cmd $ghMutatingPatterns) -or $isMutatingApiRequest) {
        Write-Error "Mutating gh commands are not allowed in this agent. Use the pipeline orchestrator for GitHub write operations."
        exit 2
    }
}
exit 0
