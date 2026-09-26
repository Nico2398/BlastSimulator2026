// Reject a backgrounded shell command.
// Registered as a PreToolUse hook (matcher: "Bash") in `.claude/settings.json`.
// Claude Code passes tool input as JSON on stdin.
//
// The sibling of `require-foreground-agents.mjs`, closing the same hole one layer
// down. That hook stopped a run from losing its work to a backgrounded sub-agent
// (#404, #406). The identical failure then came back through the shell instead:
//
//   PR #604  `npm run scenarios` backgrounded, then "pausing here until it
//            reports back". Turn over. 3h11m of finished TDD work discarded with
//            the runner VM, and the retry repeated it inside three minutes.
//   PR #594  "Waiting for the background vitest run (task `bip2e4izv`) to
//            complete — will be notified automatically." Both attempts.
//
// A backgrounded command reports through a notification delivered on a later
// turn. An unattended run gets exactly one turn, so that notification never
// arrives: the run ends with its branches unpushed and no PR, and the job's own
// rescue step opens a draft nobody asked for.
//
// The answer is not "never detach" — `npm run scenarios` and `npm run ci:await`
// can both outrun the Bash tool's 600s ceiling on a 2-core runner. It is "detach
// through the one wrapper that can be waited on inside this turn": `npm run
// long`. That wrapper is also what `require-settled-turn.mjs` reads, so a run
// started through it cannot be abandoned by ending the turn either. Detaching
// any other way is invisible to both guards, which is what this hook is for.
//
// Blocking is the default, and that is the safe direction: a runner cannot lose a
// run to an environment variable that failed to arrive. A human at an interactive
// CLI, where a later turn genuinely exists, exports
// AGENTIC_ALLOW_BACKGROUND_BASH=1. No pipeline workflow sets it.

import { block, envFlag, parsePayload, readStdin, toolInput } from './lib/hook-io.mjs';

/**
 * What a Bash call does with its result: `foreground`, `allowed` (detaches on
 * purpose and loses nothing), `flag` (the tool's own background flag) or
 * `detach` (the command backgrounds itself).
 */
function classify(input) {
  const command = typeof input.command === 'string' ? input.command : '';

  // The two allowances are checked before anything else, because both describe
  // a command that is *meant* to outlive the call and neither can lose a result.

  // The sanctioned wrapper detaches on purpose and is waitable.
  if (/\bnpm run long\b/.test(command)) return 'allowed';

  // A server is not a result. What this hook exists to stop is a turn ending to
  // collect an answer that will never be delivered; a dev server is started so
  // the browser has something to talk to, it produces no verdict, and nothing
  // ever waits on its exit code. The visual channel cannot run without one, and
  // `npm run dev &` is the incantation this project already documents in
  // `dev-visual-testing`, `rendering.md`, `visual-tester` and `verify-env`.
  //
  // Narrow on purpose, and it has to stay that way or naming `npm run dev`
  // launders anything typed after it:
  //   - anchored at the start, so `setsid npm run dev` is not a dev-server start
  //   - no `;`, `|` or further `&` past the one that backgrounds it, so
  //     `npm run dev & npx vitest run &` is not one either
  // Redirections are blanked first, otherwise the `&` in the entirely ordinary
  // `npm run dev > /tmp/dev.log 2>&1 &` would read as a second command.
  const redirectless = command.trim().replace(/(\d?>&\d?|&>|>>|[<>])/g, ' ');
  if (/^(npm run dev|npx vite|vite)\b[^;|&]*&?$/.test(redirectless)) return 'allowed';

  // Unlike the Agent tool this flag defaults to false, so only an explicit true
  // is a backgrounding request.
  if (input.run_in_background === true) return 'flag';

  if (/(^|[;&|(]|\s)(nohup|setsid)\s/.test(command)) return 'detach';
  if (/(^|[;&|(]|\s)disown(\s|$)/.test(command)) return 'detach';

  // `&&` and `2>&1` are not backgrounding and must keep working, so the
  // trailing-& test is anchored per line and refuses a preceding `&` or `>`.
  for (const line of command.split('\n')) {
    if (/(?<![&>])&[ \t]*$/.test(line.trimEnd())) return 'detach';
  }

  return 'foreground';
}

const raw = readStdin();

if (envFlag('AGENTIC_ALLOW_BACKGROUND_BASH')) process.exit(0);

const payload = parsePayload(raw);
// An unreadable payload must not wedge every shell command shut: CLAUDE.md
// still carries the rule, and `require-settled-turn.mjs` still catches the turn
// that tries to end on it.
if (payload === undefined) process.exit(0);

const verdict = classify(toolInput(payload));
if (verdict === 'foreground' || verdict === 'allowed') process.exit(0);

const reason =
  verdict === 'flag'
    ? 'run_in_background was set to true'
    : 'the command detaches itself (nohup, setsid, disown, or a trailing `&`)';

block(`Blocked: this command would run in the background — ${reason}.

A backgrounded command reports on a later turn, and an unattended run gets
exactly one turn. Ending your turn to wait for it discards everything this run
has done: PR #604 lost 3h11m of finished work that way, and PR #594 lost two
attempts to it.

A short command fits in one Bash call — run it in the foreground with an
explicit timeout (the ceiling is 600000 ms):

    npm run typecheck

\`npm run test\` no longer belongs in that list: it has grown to ~500s on a
2-core runner (was ~186s when this project started), and a foreground call
that does not pass an explicit timeout at least that long gets silently moved
to the background by this harness's own shorter default — with no error, no
warning, just a result you now have to wait a whole extra turn for. That is
exactly how issue #842's rescue (PR #872) lost two attempts. \`npm run
scenarios\` can outrun the ceiling on a runner, and \`npm run ci:await\` waits
on CI for as long as CI takes. All three use the wrapper that can be waited
on inside this turn:

    npm run long -- start test -- npm run test
    npm run long -- wait test               # repeat while it exits 75

\`wait\` blocks for one bounded slice and returns 75 meaning "still going, ask
again". Keep calling it in this same turn until it reports FINISHED, then act on
the exit code it prints. Never end the turn with one outstanding.

Starting the dev server the visual channel needs is not what this blocks — a
server produces no result anybody collects. \`npm run dev &\` is allowed as it
always was; it is the tool's own \`run_in_background\` flag that is not.`);
