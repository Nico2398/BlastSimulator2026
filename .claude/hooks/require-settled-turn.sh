#!/usr/bin/env bash
# Refuse to end a turn while a long run is still going.
# Registered as a Stop and a SubagentStop hook in `.claude/settings.json`.
# Claude Code passes the stop payload as JSON on stdin.
#
# The last line of defence, and the only one that acts at the moment the run is
# actually lost. `require-foreground-bash.sh` decides what may be started;
# this decides whether the turn may end. Both exist because prose did not hold:
# CLAUDE.md, the orchestrator definition and the retry prompt all already said
# every result must arrive inside the turn that asked for it, and three runs in
# four days ended on a sentence promising to wait — #604 ("pausing here until it
# reports back"), #594 ("will be notified automatically"), and their retries.
#
# What it reads is `.agentic/long/`, the handle directory `npm run long` writes.
# A handle with a live pid and no exit file is a command whose result nobody has
# read yet, and ending the turn on it throws that result away along with
# everything the run has not yet pushed.
#
# ▶ The brake. Blocking forever is its own outage: a job that cannot end never
# reaches the rescue step, so the branch dies with the VM instead of becoming a
# draft PR somebody can finish. So this is a counter with a bound, not a wall —
# after AGENTIC_STOP_BLOCK_LIMIT consecutive refusals it lets the turn end and
# says so in the log. Reaching the brake means the agent ignored the block four
# times, which is a finding, not a routine outcome.
#
# Exit 2 = refuse the stop; stderr goes back to the agent as the reason.
# Exit 0 = let the turn end.

set -uo pipefail

raw=$(cat)

case "${AGENTIC_ALLOW_UNSETTLED_TURN:-}" in
    1 | true | TRUE | yes)
        exit 0
        ;;
esac

project="${CLAUDE_PROJECT_DIR:-$(pwd)}"
long_dir="${project}/.agentic/long"
counter="${long_dir}/.stop-blocks"
limit="${AGENTIC_STOP_BLOCK_LIMIT:-4}"

# Nothing was ever started through the wrapper: there is nothing this hook can
# say anything about.
[ -d "$long_dir" ] || exit 0

# Fail open without python3, for the same reason the sibling hook does: an
# unreadable payload must not be able to wedge a turn shut.
if ! command -v python3 >/dev/null 2>&1; then
    exit 0
fi

# A pid file with no exit file beside it, whose process is still alive. The exit
# file is written by the detached shell itself, so it is authoritative and it
# outlives the process — checked first, so a command that finished a moment ago
# reads as finished rather than as gone.
pending=$(python3 - "$long_dir" <<'PY'
import os, sys

directory = sys.argv[1]
live = []
try:
    names = os.listdir(directory)
except OSError:
    sys.exit(0)

for name in names:
    if not name.endswith('.pid'):
        continue
    label = name[:-4]
    if os.path.exists(os.path.join(directory, label + '.exit')):
        continue
    try:
        with open(os.path.join(directory, name)) as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        continue
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        continue
    except PermissionError:
        pass
    live.append(label)

print(' '.join(sorted(live)))
PY
)

if [ -z "${pending// /}" ]; then
    rm -f "$counter"
    exit 0
fi

blocked=0
[ -f "$counter" ] && blocked=$(cat "$counter" 2>/dev/null || echo 0)
case "$blocked" in
    ''|*[!0-9]*) blocked=0 ;;
esac
blocked=$((blocked + 1))
printf '%s' "$blocked" > "$counter"

if [ "$blocked" -gt "$limit" ]; then
    rm -f "$counter"
    echo "::warning::Turn ended with long run(s) still going: ${pending}. The stop guard refused ${limit} times and released on its brake — the result of those commands was never read." >&2
    exit 0
fi

cat >&2 <<EOF
Blocked: you are ending this turn while a long run is still going — ${pending}.

There is no later turn. This session is unattended: when the turn ends the
process exits, the notification you are waiting for is never delivered, and
everything this run has not pushed dies with the runner. PR #604 ended exactly
here, on "pausing here until it reports back", after 3h11m of finished work.

Wait for it now, in this turn. Pass an explicit timeout of at least 600000 ms
on the call itself — without one, this harness's own shorter default can
background the \`wait\` call before it reports anything, which reproduces the
same failure one level up:

$(for label in ${pending}; do echo "    npm run long -- wait ${label}"; done)

That call blocks for one bounded slice and exits 75 if the command is still
going — which is not a failure. Call it again, as many times as it takes, until
it prints FINISHED, then act on the exit code. Only then is this turn finished.
EOF
exit 2
