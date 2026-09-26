// Block mutating git and gh commands for non-pipeline subagents.
// Registered as a PreToolUse hook (matcher: "Bash") in each read-only agent's
// frontmatter. Claude Code passes tool input as JSON on stdin.
//
// Exit 2 = block the tool call and show stderr to the agent.
// Exit 0 = allow.

import { block, parsePayload, readStdin, toolInput } from './lib/hook-io.mjs';

const raw = readStdin();
const payload = parsePayload(raw);

// Collapse whitespace. Falls back to the raw payload when it is not JSON, which
// fails closed on the patterns below.
const source =
  payload === undefined
    ? raw
    : typeof toolInput(payload).command === 'string'
      ? toolInput(payload).command
      : '';
const cmd = source.split(/\s+/).filter(Boolean).join(' ');

if (cmd === '') process.exit(0);

const GIT_MUTATING = [
  /^git (add|am|apply|bisect|checkout|cherry-pick|clean|clone|commit|fetch|init|merge|mv|pull|push|rebase|reset|restore|revert|rm|sparse-checkout|stash|submodule|switch|worktree)( |$)/,
  /^git blame --edit( |$)/,
  /^git branch (-D|-d|-m|-M|-c|-C|--delete|--move|--copy)( |$)/,
  /^git tag (-a|-d|-f|-s|-m)( |$)/,
];

const GH_MUTATING = [
  /^gh auth( |$)/,
  /^gh pr (checkout|close|comment|create|edit|merge|ready|reopen|review|update-branch)( |$)/,
  /^gh issue (close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)( |$)/,
  /^gh label (clone|create|delete|edit)( |$)/,
  /^gh release (create|delete|edit|upload)( |$)/,
  /^gh repo (archive|clone|create|delete|edit|fork|rename|set-default|sync)( |$)/,
  /^gh secret( |$)/,
  /^gh variable( |$)/,
  /^gh workflow (disable|enable|run)( |$)/,
];

// `git branch` / `git tag` with no mutating flag are read-only listings.
if (/^git( |$)/.test(cmd) && GIT_MUTATING.some((pattern) => pattern.test(cmd))) {
  block('Mutating git commands are not allowed in this agent. Use the pipeline orchestrator for git write operations.');
}

if (/^gh( |$)/.test(cmd)) {
  const mutatingApi =
    /^gh api( |$)/.test(cmd) && /(^| )(--method|-X) ?(POST|PUT|PATCH|DELETE)( |$)/.test(cmd);
  if (mutatingApi || GH_MUTATING.some((pattern) => pattern.test(cmd))) {
    block('Mutating gh commands are not allowed in this agent. Use the pipeline orchestrator for GitHub write operations.');
  }
}
