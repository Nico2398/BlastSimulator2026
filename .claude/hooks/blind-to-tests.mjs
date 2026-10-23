// Keep the implementing session blind to the tests until its implementation is
// committed.
// Registered as a PreToolUse hook in `.claude/settings.json` (matcher on the
// file and shell tools), so it reaches the forked orchestrator, the main
// session and every sub-agent alike. Claude Code passes the payload as JSON on
// stdin; inside a sub-agent the payload carries `agent_type`.
//
// The TDD cycle used to buy this separation with five agents and three
// branches: a test-writer, an implementer that "never sees test commits", and
// prose asking it not to look. `npm run pipeline -- tdd split` now opens a
// blind phase by writing `.agentic/tdd/blind.json` (the tests worktree and the
// tests branch), and `tdd join` closes it. While it is open, any tool call
// whose path, pattern or command reaches the tests worktree or branch is
// refused — for everyone except the test-writer, which owns them. Fails closed:
// a session that does not identify itself as the test-writer is blind.
//
// Exit 2 = block the tool call and show stderr to the agent.
// Exit 0 = allow.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { block, parsePayload, readStdin, toolInput } from './lib/hook-io.mjs';

const OWNER = 'test-writer';

const payload = parsePayload(readStdin());
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const markerPath = join(project, '.agentic', 'tdd', 'blind.json');

if (!existsSync(markerPath)) process.exit(0);
if (payload?.agent_type === OWNER) process.exit(0);

let marker;
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf8'));
} catch {
  block(`Blind phase marker ${markerPath} is unreadable; refusing file and shell tools until \`npm run pipeline -- tdd join\` repairs the cycle.`);
}

const input = toolInput(payload);
const reached = [input.file_path, input.path, input.pattern, input.glob, input.notebook_path, input.command]
  .filter((value) => typeof value === 'string')
  .join('\n');

const needles = [marker.worktree, marker.worktree && basename(marker.worktree), marker.testsBranch].filter(
  (value) => typeof value === 'string' && value !== '',
);

// Ref-wide git reads show the tests branch without naming it.
const refWide = /\bgit\b[^\n]*\s--(all|branches|glob|remotes)\b/.test(String(input.command ?? ''));

if (needles.some((needle) => reached.includes(needle)) || refWide) {
  block(
    `Blind phase for ${marker.label}: the tests in ${marker.worktree} (${marker.testsBranch}) belong to the test-writer ` +
      'until your implementation is committed and `npm run pipeline -- tdd join` has run. ' +
      "Implement from the plan's Contract (agentic-pipeline-tdd).",
  );
}
