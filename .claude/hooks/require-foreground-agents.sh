#!/usr/bin/env bash
# Reject backgrounded delegation.
# Registered as a PreToolUse hook (matcher: "Agent|Task") in
# `.claude/settings.json`. Claude Code passes tool input as JSON on stdin.
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
# ▶ Where this hook is registered is load-bearing, and it must stay in
# settings.json. It first shipped declared in the orchestrator's own frontmatter,
# and it never fired once. Frontmatter hooks are registered per session by the
# code that starts a sub-agent through the `Agent` tool — which is how every
# specialist in `.claude/agents/` gets `block-git-gh.sh`, and it works there. The
# orchestrator is not started that way: `/agentic-run` carries `agent:
# orchestrator` plus `context: fork`, so the session forks into the orchestrator
# without any `Agent` call and its frontmatter hook block is never registered.
# Issue #406 then died 58 seconds in — planner launched in the background, turn
# ended, `num_turns: 0`, nothing on the remote — with the guard sitting inert in
# a file that had passed `validate:context`. Settings hooks demonstrably do fire
# in the runner: the SessionStart hook declared next to this one ran in that same
# job log.
#
# Blocking is the default, and that is the safe direction: a runner cannot lose a
# run to an environment variable that failed to arrive. A human who wants a
# backgrounded sub-agent in an interactive session exports
# AGENTIC_ALLOW_BACKGROUND_AGENTS=1. No pipeline workflow sets it.
#
# Exit 2 = block the tool call and show stderr to the agent.
# Exit 0 = allow.

set -uo pipefail

raw=$(cat)

case "${AGENTIC_ALLOW_BACKGROUND_AGENTS:-}" in
    1 | true | TRUE | yes)
        exit 0
        ;;
esac

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

Delegation in this project is synchronous. A backgrounded sub-agent reports
through a notification delivered on a later turn, and a pipeline run gets
exactly one turn: the result never arrives, and the run ends with its branches
unpushed and no PR.

Re-issue this call with run_in_background: false. To run several agents in
parallel, put all of those calls in a single message — they still execute
concurrently, and you receive every result inside this turn.
EOF
exit 2
