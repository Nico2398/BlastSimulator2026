# Block git and gh commands for non-pipeline subagents.
# Called as a PreToolUse hook (matcher: "Bash") via agent frontmatter.
# Claude Code passes tool input as JSON on stdin.

$raw = [Console]::In.ReadToEnd()
$data = $raw | ConvertFrom-Json
$cmd = $data.tool_input.command

if ($cmd -match '^(git|gh)\b') {
    Write-Error "git/gh commands are not allowed in this agent. Only the pipeline orchestrator may run git or gh commands."
    exit 2
}
exit 0
