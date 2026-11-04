// Refuse a direct `gh pr create` in an unattended session.
// Registered as a PreToolUse hook (matcher: "Bash") in `.claude/settings.json`.
//
// A pipeline run opens its pull request with `npm run pipeline -- open-pr`,
// which checks the body (the `Closes` line, `READY TO MERGE` last, no
// placeholder, no stray closing keyword) and posts the plan comment in the same
// step. A PR opened by hand can skip either, and a CI-fix session then works
// without the plan. The command's own `gh` call is a subprocess, not a tool
// call, so it passes. Interactive sessions open PRs as they like.

import { block, parsePayload, readStdin, toolInput } from './lib/hook-io.mjs';

const GH_VALUE_OPTIONS = new Set(['-R', '--repo', '--hostname']);

/** True when one simple command is `gh [global flags] pr create …`. */
export function createsPr(segment) {
  const words = segment.trim().split(/\s+/).filter((word) => !/^[A-Z_][A-Z0-9_]*=/.test(word));
  const at = words.indexOf('gh');
  if (at === -1) return false;
  const rest = [];
  for (let i = at + 1; i < words.length; i++) {
    if (GH_VALUE_OPTIONS.has(words[i])) i++;
    else if (!words[i].startsWith('-')) rest.push(words[i]);
  }
  return rest[0] === 'pr' && rest[1] === 'create';
}

/** True when any simple command of a shell line opens a PR directly. */
export function opensPrDirectly(command) {
  return command.split(/&&|\|\||;|\||\n/).some(createsPr);
}

if (process.argv[1]?.endsWith('require-open-pr-command.mjs')) {
  if (process.env.GITHUB_ACTIONS !== 'true') process.exit(0);
  const payload = parsePayload(readStdin());
  const command = toolInput(payload).command;
  if (typeof command === 'string' && opensPrDirectly(command)) {
    block(
      'Refused: a pipeline run opens its PR with `npm run pipeline -- open-pr --label <label> --title <title> ' +
        '--body-file <file> [--draft | --paused]` — it checks the body and posts the plan comment in the same step ' +
        '(agentic-pipeline-finalization).',
    );
  }
}
