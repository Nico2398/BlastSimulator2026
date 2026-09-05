#!/usr/bin/env bash
# Tell the orchestrator how much of the run's loop budget is left.
# Registered as a PreToolUse hook (matcher: "Agent|Task") in
# `.claude/settings.json`, so it speaks before every delegation — the moment
# the orchestrator has just decided what the next step is. Claude Code passes
# the tool input as JSON on stdin and honours `additionalContext` on this event.
#
# The rule it serves is `agentic-autonomous-pipeline`'s loop budget: every
# pipeline bounds its loops by count, each count was set alone, and together
# they add up to more than the job holds. Runs 565, 591, 606 and 609 (#921,
# #947, #953, #956) each finished their TDD cycle inside the first hour and
# spent the next five iterating until the job clock cut them off. The runner
# sets one deadline for all of a run's loops and exports it here as
# AGENTIC_LOOP_DEADLINE_EPOCH; past it, no new loop iteration starts — the one
# in flight finishes, and the pipeline's linear steps run through.
#
# The variable is absent in a session nobody timed — a CLI, a human at a
# terminal — and then this hook says nothing: the budget is open. It never
# blocks: what to do with the number is the orchestrator's decision under the
# skill, and a delegation past the deadline is often the right one (the
# iteration in flight, a reviewer, the validator, the PR).
#
# Exit 0 always. Output is the JSON Claude Code reads for additional context.

set -uo pipefail

cat >/dev/null

deadline="${AGENTIC_LOOP_DEADLINE_EPOCH:-}"
case "${deadline}" in
    '' | *[!0-9]*)
        exit 0
        ;;
esac

now=$(date +%s)
remaining=$(( (deadline - now) / 60 ))

if [ "${remaining}" -gt 0 ]; then
    message="LOOP BUDGET: ${remaining} min left before loop iterations close (agentic-autonomous-pipeline, The loop budget)."
else
    message="LOOP BUDGET CLOSED ($(( -remaining )) min past the deadline): start no new loop iteration. Finish the iteration already in flight, then take every remaining linear step straight through — review, validation, the pull request, await-ci — agentic-autonomous-pipeline, The loop budget."
fi

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "${message}"
exit 0
