// Reject backgrounded delegation.
// Registered as a PreToolUse hook (matcher: "Agent|Task") in
// `.claude/settings.json`. Claude Code passes tool input as JSON on stdin.
//
// The pipeline requires every delegation to return inside the turn that issued
// it — the shared skill bodies state that rule in runtime-neutral terms, and
// this is the runtime that needs enforcing: `run_in_background` defaults to
// `true`, so an orchestrator that simply omits it gets a sub-agent reporting
// through a notification delivered on a later turn. A GitHub Actions runner
// takes exactly one turn, so that notification never arrives: the run ends with
// its branches unpushed and no PR. Issue #404 died this way after 2h08 of
// completed work.
//
// ▶ Where this hook is registered is load-bearing, and it must stay in
// settings.json. It first shipped declared in the orchestrator's own frontmatter,
// and it never fired once. Frontmatter hooks are registered per session by the
// code that starts a sub-agent through the `Agent` tool — which is how every
// specialist in `.claude/agents/` gets `block-git-gh.mjs`, and it works there. The
// orchestrator is not started that way: `/agentic-run` carries `agent:
// orchestrator` plus `context: fork`, so the session forks into the orchestrator
// without any `Agent` call and its frontmatter hook block is never registered.
// Issue #406 then died 58 seconds in — planner launched in the background, turn
// ended, `num_turns: 0`, nothing on the remote.
//
// ▶ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 settles the question at the source.
// With it set, Claude Code runs every sub-agent in the foreground, in every kind
// of session, whatever the call asks for, and `.claude/settings.json` sets it in
// `env`. It matters most in an interactive session: there "fork mode" is on, the
// `Agent` tool offers no `run_in_background` parameter at all, and every sub-agent
// is backgrounded — so without the variable this guard saw "missing" on every
// call and no delegation could ever pass. With it, nothing can be backgrounded
// and the guard allows the call.
//
// Blocking is the default, and that is the safe direction: a runner cannot lose a
// run to an environment variable that failed to arrive. A human who wants a
// backgrounded sub-agent in an interactive session exports
// AGENTIC_ALLOW_BACKGROUND_AGENTS=1. No pipeline workflow sets it.

import { block, envFlag, parsePayload, readStdin, toolInput } from './lib/hook-io.mjs';

const raw = readStdin();

if (envFlag('AGENTIC_ALLOW_BACKGROUND_AGENTS')) process.exit(0);

// The harness forces the foreground itself: nothing can be backgrounded.
if (envFlag('CLAUDE_CODE_DISABLE_BACKGROUND_TASKS')) process.exit(0);

const payload = parsePayload(raw);
// An unreadable payload must not wedge every delegation shut.
if (payload === undefined) process.exit(0);

// Allowed only when run_in_background is explicitly false. Omitted reads as
// "default", which is the trap this hook exists to close.
const value = toolInput(payload).run_in_background;
if (value === false) process.exit(0);

const reason =
  value === undefined || value === null
    ? 'run_in_background was not set, and it defaults to true'
    : 'run_in_background was set to true';

block(`Blocked: this delegation would run in the background — ${reason}.

Delegation in this project is synchronous. A backgrounded sub-agent reports
through a notification delivered on a later turn, and a pipeline run gets
exactly one turn: the result never arrives, and the run ends with its branches
unpushed and no PR.

Re-issue this call with run_in_background: false. To run several agents in
parallel, put all of those calls in a single message — they still execute
concurrently, and you receive every result inside this turn.

If this Agent tool offers no run_in_background parameter (an interactive
session in fork mode), no call can be made foreground from here: the session
is missing CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1, which .claude/settings.json
sets in \`env\`. Restart the session so it is read.`);
