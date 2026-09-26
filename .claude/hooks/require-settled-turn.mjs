// Refuse to end a turn while a long run is still going.
// Registered as a Stop and a SubagentStop hook in `.claude/settings.json`.
// Claude Code passes the stop payload as JSON on stdin.
//
// The last line of defence, and the only one that acts at the moment the run is
// actually lost. `require-foreground-bash.mjs` decides what may be started;
// this decides whether the turn may end. Both exist because prose did not hold:
// CLAUDE.md, the orchestrator definition and the retry prompt all already said
// every result must arrive inside the turn that asked for it, and three runs in
// four days ended on a sentence promising to wait — #604 ("pausing here until it
// reports back"), #594 ("will be notified automatically"), and their retries.
//
// What it reads is `.agentic/long/`, the handle directory `npm run long` writes.
// A handle with a live pid and no exit file is a command whose result nobody has
// read yet, and ending the turn on it throws that result away along with
// everything the run has not yet pushed.
//
// Liveness is `process.kill(pid, 0)`, which Node implements as a pure existence
// probe on every OS. The Python this replaced used `os.kill(pid, 0)`, which on
// Windows is TerminateProcess — asking whether the long run was alive killed it.
//
// ▶ The brake. Blocking forever is its own outage: a job that cannot end never
// reaches the rescue step, so the branch dies with the VM instead of becoming a
// draft PR somebody can finish. So this is a counter with a bound, not a wall —
// after AGENTIC_STOP_BLOCK_LIMIT consecutive refusals it lets the turn end and
// says so in the log. Reaching the brake means the agent ignored the block four
// times, which is a finding, not a routine outcome.

import * as fs from 'node:fs';
import { join } from 'node:path';
import { block, envFlag, readStdin } from './lib/hook-io.mjs';

readStdin();

if (envFlag('AGENTIC_ALLOW_UNSETTLED_TURN')) process.exit(0);

const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const longDir = join(project, '.agentic', 'long');
const counter = join(longDir, '.stop-blocks');
const limit = Number.parseInt(process.env.AGENTIC_STOP_BLOCK_LIMIT ?? '', 10) || 4;

// Nothing was ever started through the wrapper: nothing to say anything about.
if (!fs.existsSync(longDir)) process.exit(0);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists and belongs to somebody else — alive either way.
    return error?.code === 'EPERM';
  }
}

// A pid file with no exit file beside it, whose process is still alive. The exit
// file is written by the detached shell itself, so it is authoritative and it
// outlives the process — checked first, so a command that finished a moment ago
// reads as finished rather than as gone.
function pendingLabels() {
  let names;
  try {
    names = fs.readdirSync(longDir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    if (!name.endsWith('.pid')) continue;
    const label = name.slice(0, -'.pid'.length);
    if (fs.existsSync(join(longDir, `${label}.exit`))) continue;
    let pid;
    try {
      pid = Number.parseInt(fs.readFileSync(join(longDir, name), 'utf8').trim(), 10);
    } catch {
      continue;
    }
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (isAlive(pid)) live.push(label);
  }
  return live.sort();
}

const pending = pendingLabels();

if (pending.length === 0) {
  fs.rmSync(counter, { force: true });
  process.exit(0);
}

let blocked = 0;
try {
  const stored = fs.readFileSync(counter, 'utf8').trim();
  if (/^[0-9]+$/.test(stored)) blocked = Number(stored);
} catch {
  // No counter yet.
}
blocked += 1;
fs.writeFileSync(counter, String(blocked));

if (blocked > limit) {
  fs.rmSync(counter, { force: true });
  process.stderr.write(
    `::warning::Turn ended with long run(s) still going: ${pending.join(' ')}. The stop guard refused ${limit} times and released on its brake — the result of those commands was never read.\n`
  );
  process.exit(0);
}

block(`Blocked: you are ending this turn while a long run is still going — ${pending.join(' ')}.

There is no later turn. This session is unattended: when the turn ends the
process exits, the notification you are waiting for is never delivered, and
everything this run has not pushed dies with the runner. PR #604 ended exactly
here, on "pausing here until it reports back", after 3h11m of finished work.

Wait for it now, in this turn. Pass an explicit timeout of at least 600000 ms
on the call itself — without one, this harness's own shorter default can
background the \`wait\` call before it reports anything, which reproduces the
same failure one level up:

${pending.map((label) => `    npm run long -- wait ${label}`).join('\n')}

That call blocks for one bounded slice and exits 75 if the command is still
going — which is not a failure. Call it again, as many times as it takes, until
it prints FINISHED, then act on the exit code. Only then is this turn finished.`);
