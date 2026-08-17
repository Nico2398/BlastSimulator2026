#!/usr/bin/env bash
# Reject a backgrounded shell command.
# Registered as a PreToolUse hook (matcher: "Bash") in `.claude/settings.json`.
# Claude Code passes tool input as JSON on stdin.
#
# The sibling of `require-foreground-agents.sh`, closing the same hole one layer
# down. That hook stopped a run from losing its work to a backgrounded sub-agent
# (#404, #406). The identical failure then came back through the shell instead:
#
#   PR #604  `npm run scenarios` backgrounded, then "pausing here until it
#            reports back". Turn over. 3h11m of finished TDD work discarded with
#            the runner VM, and the retry repeated it inside three minutes.
#   PR #594  "Waiting for the background vitest run (task `bip2e4izv`) to
#            complete — will be notified automatically." Both attempts.
#
# A backgrounded command reports through a notification delivered on a later
# turn. An unattended run gets exactly one turn, so that notification never
# arrives: the run ends with its branches unpushed and no PR, and the job's own
# rescue step opens a draft nobody asked for.
#
# The answer is not "never detach" — `npm run scenarios` is ~9m20s in a sandbox
# and longer on a 2-core runner, and `npm run ci:await` waits on CI for as long
# as CI takes, both past the Bash tool's 600s ceiling. It is "detach through the
# one wrapper that can be waited on inside this turn": `npm run long`. That
# wrapper is also what `require-settled-turn.sh` reads, so a run started through
# it cannot be abandoned by ending the turn either. Detaching any other way is
# invisible to both guards, which is what this hook is for.
#
# Blocking is the default, and that is the safe direction: a runner cannot lose a
# run to an environment variable that failed to arrive. A human at an interactive
# CLI, where a later turn genuinely exists, exports
# AGENTIC_ALLOW_BACKGROUND_BASH=1. No pipeline workflow sets it.
#
# Exit 2 = block the tool call and show stderr to the agent.
# Exit 0 = allow.

set -uo pipefail

raw=$(cat)

case "${AGENTIC_ALLOW_BACKGROUND_BASH:-}" in
    1 | true | TRUE | yes)
        exit 0
        ;;
esac

# Absent python3 we cannot read the payload, and blocking every shell command
# would halt the pipeline outright. Fail open: CLAUDE.md still carries the rule,
# `require-settled-turn.sh` still catches the turn that tries to end on it, and
# `npm run validate:context` proves this hook is wired up.
if ! command -v python3 >/dev/null 2>&1; then
    exit 0
fi

# Two ways a Bash call detaches, and both have to be caught:
#
#   run_in_background: true  — the tool's own flag. Unlike the Agent tool this
#                              defaults to false, so only an explicit true is a
#                              backgrounding request.
#   detach syntax            — `nohup`, `setsid`, `disown`, or a trailing `&` in
#                              the command itself, which the flag never sees.
#
# `&&` and `2>&1` are not backgrounding and must keep working, so the trailing-&
# test is anchored per line and refuses a preceding `&` or `>`.
verdict=$(printf '%s' "$raw" | python3 -c '
import json, re, sys

try:
    data = json.load(sys.stdin)
except Exception:
    print("unreadable"); raise SystemExit(0)

tool_input = data.get("tool_input") or {}
command = tool_input.get("command") or ""

# The two allowances are checked before anything else, because both describe a
# command that is *meant* to outlive the call and neither can lose a result.

# The sanctioned wrapper detaches on purpose and is waitable.
if re.search(r"\bnpm run long\b", command):
    print("allowed"); raise SystemExit(0)

# A server is not a result. What this hook exists to stop is a turn ending to
# collect an answer that will never be delivered; a dev server is started so the
# browser has something to talk to, it produces no verdict, and nothing ever
# waits on its exit code. The visual channel cannot run without one, and
# `npm run dev &` is the incantation this project already documents in
# `dev-visual-testing`, `rendering.md`, `visual-tester` and `verify-env`.
#
# Narrow on purpose, and it has to stay that way or naming `npm run dev`
# launders anything typed after it:
#   - anchored at the start, so `setsid npm run dev` is not a dev-server start
#   - no `;`, `|` or further `&` past the one that backgrounds it, so
#     `npm run dev & npx vitest run &` is not one either
# Redirections are blanked first, otherwise the `&` in the entirely ordinary
# `npm run dev > /tmp/dev.log 2>&1 &` would read as a second command.
redirectless = re.sub(r"(\d?>&\d?|&>|>>|[<>])", " ", command.strip())
if re.match(r"^(npm run dev|npx vite|vite)\b[^;|&]*&?$", redirectless):
    print("allowed"); raise SystemExit(0)

if tool_input.get("run_in_background") is True:
    print("flag"); raise SystemExit(0)

if re.search(r"(^|[;&|(]|\s)(nohup|setsid)\s", command):
    print("detach"); raise SystemExit(0)
if re.search(r"(^|[;&|(]|\s)disown(\s|$)", command):
    print("detach"); raise SystemExit(0)

for line in command.split("\n"):
    if re.search(r"(?<![&>])&[ \t]*$", line.rstrip()):
        print("detach"); raise SystemExit(0)

print("foreground")
')

case "$verdict" in
    foreground|allowed|unreadable)
        exit 0
        ;;
esac

if [ "$verdict" = "flag" ]; then
    reason="run_in_background was set to true"
else
    reason="the command detaches itself (nohup, setsid, disown, or a trailing \`&\`)"
fi

cat >&2 <<EOF
Blocked: this command would run in the background — $reason.

A backgrounded command reports on a later turn, and an unattended run gets
exactly one turn. Ending your turn to wait for it discards everything this run
has done: PR #604 lost 3h11m of finished work that way, and PR #594 lost two
attempts to it.

If the command fits in one Bash call, run it in the foreground with an explicit
timeout (the ceiling is 600000 ms):

    npm run test          # ~3m
    npm run typecheck

If it does not fit — \`npm run scenarios\` is ~9m20s and slower on a runner,
\`npm run ci:await\` waits on CI for as long as CI takes — use the wrapper that
can be waited on inside this turn:

    npm run long -- start scenarios -- npm run scenarios
    npm run long -- wait scenarios          # repeat while it exits 75

\`wait\` blocks for one bounded slice and returns 75 meaning "still going, ask
again". Keep calling it in this same turn until it reports FINISHED, then act on
the exit code it prints. Never end the turn with one outstanding.

Starting the dev server the visual channel needs is not what this blocks — a
server produces no result anybody collects. \`npm run dev &\` is allowed as it
always was; it is the tool's own \`run_in_background\` flag that is not.
EOF
exit 2
