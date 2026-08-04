#!/usr/bin/env bash
# Reject backgrounded delegation.
# Registered as a PreToolUse hook (matcher: "Agent|Task|SendMessage|Monitor") in
# `.claude/settings.json`. Claude Code passes tool name and tool input as JSON
# on stdin.
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
# ▶ `run_in_background: false` is not the only way to background a delegation,
# and gating on that parameter alone left the guard blind. PR #481 lost a run
# that way: the orchestrator's first `Agent` call was foreground and returned
# inside its turn, then it continued that same sub-agent with `SendMessage` —
# which has no `run_in_background` parameter at all and always resumes the agent
# in the background. The matcher did not name `SendMessage`, so the guard never
# saw the call. The orchestrator then opened a `Monitor` to wait for the result
# and ended its turn on "I'll wait for the monitor's notification". `num_turns:
# 0`, a half-finished rebase on the runner's disk, nothing pushed.
#
# So the guard classifies by tool, not only by parameter:
#
#   Agent / Task*  — allowed only with an explicit `run_in_background: false`.
#   SendMessage    — always blocked. Resuming an agent is background by nature;
#                    there is no foreground spelling to re-issue it with.
#   Monitor        — always blocked. Waiting for a condition to come true is a
#                    later-turn tool, and a runner has no later turn.
#
# `Bash` is deliberately NOT matched. A backgrounded Bash is how the playability
# and visual channels start `npm run dev`, and blocking it would take both
# channels out. The killer is never the background process itself — it is ending
# the turn to wait on one.
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

# Two fields, one pass. "false" only when run_in_background is explicitly false;
# omitted reads as "default", which is the trap this hook first opened against.
read -r tool state <<EOF
$(printf '%s' "$raw" | python3 -c 'import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("unreadable unreadable"); sys.exit(0)
tool = data.get("tool_name") or "unknown"
value = (data.get("tool_input") or {}).get("run_in_background")
print(tool, "false" if value is False else "missing" if value is None else "true")')
EOF

if [ "$state" = "unreadable" ]; then
    exit 0
fi

# Tools with no foreground spelling. Naming them here rather than letting them
# fall through the parameter check matters: they carry no `run_in_background`,
# so the check below would read them as "missing" and print advice — "re-issue
# with run_in_background: false" — that cannot be followed.
case "$tool" in
    SendMessage)
        cat >&2 <<'EOF'
Blocked: SendMessage resumes a sub-agent in the background, and there is no
foreground spelling of it.

A resumed agent reports through a notification delivered on a later turn, and a
pipeline run gets exactly one turn: the result never arrives, and the run ends
with its branches unpushed and no PR. PR #481 was lost precisely here — a
foreground delegation, continued with SendMessage, then a turn ended waiting.

Issue a fresh `Agent` call with `run_in_background: false` instead. It costs the
previous agent's context; carry what matters forward in the prompt.
EOF
        exit 2
        ;;
    Monitor)
        cat >&2 <<'EOF'
Blocked: Monitor waits for a condition to become true on a later turn, and a
pipeline run gets exactly one turn.

Whatever you are waiting for, wait for it inside this turn: a foreground `Agent`
call (`run_in_background: false`) returns its result before the turn ends, and a
foreground `Bash` call blocks until the command exits.
EOF
        exit 2
        ;;
esac

# The `run_in_background` check applies to delegation and to nothing else. The
# matcher in settings.json already decides what reaches this script, but the two
# must not be able to drift: widening the matcher one day must not silently start
# rejecting `npm run dev &`, which is how the visual and playability channels
# bring the dev server up.
case "$tool" in
    Agent | Task*) ;;
    *) exit 0 ;;
esac

case "$state" in
    false)
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
