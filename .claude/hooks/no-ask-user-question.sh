#!/usr/bin/env bash
# Reject AskUserQuestion.
# Registered as a PreToolUse hook (matcher: "AskUserQuestion") in
# `.claude/settings.json`, alongside the `permissions.deny` entry for the same
# tool.
#
# Two layers for one tool, because they fail in different places. The deny rule
# is the clean statement of intent and it is what `validate:context` checks —
# but a permission rule is consulted by the permission system, and a session
# running with permissions bypassed does not consult it. Claude Code on the web
# is exactly that session: it runs unattended, which is both why it bypasses
# prompts and why a question asked there can never be answered. A hook runs on
# the tool call itself, whatever mode the session is in, so this is the layer
# that actually holds where it matters most.
#
# The cost of the question is not the pause. A pipeline run holds its issue
# `in-progress` for as long as it waits, and every assignment queued behind it
# waits too — the halt `agentic-decision-autonomy` exists to prevent, arriving
# through a tool call instead of through a decision. An open choice is
# defaulted and recorded; a genuine blocker is written to the issue, where a
# human finds it after the session has ended.
#
# No payload parsing: the matcher has already decided this call is the one to
# block, so there is nothing to read and nothing that can fail to be read.
#
# Exit 2 = block the tool call and show stderr to the agent.

set -uo pipefail

cat >&2 <<'EOF'
Blocked: AskUserQuestion is disabled in this project.

Nobody is reading. This runs unattended — on a GitHub Actions runner, or in
Claude Code on the web — so a question suspends the turn until it times out
while the issue holds `in-progress` and every assignment behind it waits.

What to do instead:

- An open choice is not a question. Derive the default from the skill that owns
  the mechanic, implement it, and record it in the PR body under
  `## Decisions taken` — `agentic-decision-autonomy` has the rule and the
  format.
- A genuine blocker (that skill lists all five) goes on the issue: label it
  `blocked`, comment what is missing and what would unblock it, and stop.

Both leave the answer somewhere a human will actually find it.
EOF
exit 2
