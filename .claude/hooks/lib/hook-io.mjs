// Shared plumbing for the Claude Code hooks in `.claude/hooks/`.
//
// Hooks are Node, not shell. Node is the one runtime every environment this
// project runs in is guaranteed to have — it is the toolchain — while a hook
// written in bash needed Git Bash on Windows, and one that parsed its payload
// with python3 needed a Python install and silently failed open without it.
// Worse, Python's `os.kill(pid, 0)` is not a liveness probe on Windows: it calls
// TerminateProcess, so the stop guard would have killed the very long run it was
// protecting. Every hook is registered in exec form (`command: node`, `args:
// [path]`), so no shell sits between Claude Code and the script on any OS.
//
// Exit-code contract, identical for every hook:
//   0 = allow (stdout may carry JSON Claude Code reads)
//   2 = block; stderr is shown to the agent as the reason

import { readFileSync } from 'node:fs';

/** The raw hook payload. Claude Code writes JSON to stdin and closes it. */
export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** The parsed payload, or `undefined` when it is not JSON. */
export function parsePayload(raw) {
  try {
    const data = JSON.parse(raw);
    return data !== null && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

/** The payload's `tool_input`, or an empty object. */
export function toolInput(payload) {
  const input = payload?.tool_input;
  return input !== null && typeof input === 'object' ? input : {};
}

/** True when an opt-in environment variable is set to a truthy spelling. */
export function envFlag(name) {
  return ['1', 'true', 'TRUE', 'yes'].includes(process.env[name] ?? '');
}

/** Refuse the tool call (or the stop) and tell the agent why. Never returns. */
export function block(message) {
  process.stderr.write(message.endsWith('\n') ? message : `${message}\n`);
  process.exit(2);
}
