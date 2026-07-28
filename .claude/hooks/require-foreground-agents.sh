#!/usr/bin/env bash
# Reject backgrounded delegation from the pipeline orchestrator.
# Called as a PreToolUse hook (matcher: "Agent|Task") via agent frontmatter.
# Claude Code passes tool input as JSON on stdin.
#
# The pipeline requires every delegation to return inside the turn that issued
# it — the shared skill bodies state that rule in runtime-neutral terms, and
# this is the runtime that needs enforcing: `run_in_background` defaults to
# `true`, so an orchestrator that simply omits it gets a sub-agent reporting
# through a notification delivered on a later turn. A GitHub Actions runner
# takes exactly one turn, so that notification never arrives: the run ends with
# its branches unpushed and no PR. Issue #404 died this way after 2h08 of
# completed work.
#
# Exit 2 = block the tool call and show stderr to the agent.
# Exit 0 = allow.

set -uo pipefail

raw=$(cat)

# Absent python3 we cannot read the payload, and blocking every delegation
# would halt the pipeline outright. Fail open: the skill bodies still carry the
# rule, and `npm run validate:context` proves the hook is wired up.
if ! command -v python3 >/dev/null 2>&1; then
    exit 0
fi

# "false" only when run_in_background is explicitly false. Omitted reads as
# "default", which is the trap this hook exists to close.
state=$(printf '%s' "$raw" | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("unreadable"); sys.exit(0)
value = (data.get("tool_input") or {}).get("run_in_background")
print("false" if value is False else "missing" if value is None else "true")')

case "$state" in
    false|unreadable)
        exit 0
        ;;
esac

if [ "$state" = "missing" ]; then
    reason="run_in_background was not set, and it defaults to true"
else
    reason="run_in_background was set to true"
fi

cat >&2 <<EOF
Blocked: this delegation would run in the background — $reason.

The pipeline orchestrator delegates synchronously. A backgrounded sub-agent
reports through a notification delivered on a later turn, and a pipeline run
gets exactly one turn: the result never arrives, and the run ends with its
branches unpushed and no PR.

Re-issue this call with run_in_background: false. To run several agents in
parallel, put all of those calls in a single message — they still execute
concurrently, and you receive every result inside this turn.
EOF
exit 2
