// Runs and inspects the Claude Code hooks in `.claude/hooks/` the way Claude
// Code does: the payload on stdin, the verdict in the exit code.
//
// Hooks are Node scripts registered in exec form — `command: node`, `args:
// [<script>]` — so no shell sits between Claude Code and the hook on any OS.
// These helpers spawn them the same way, through the running Node binary, which
// is why the suites that use them pass on Windows as well as Linux.

import { spawnSync } from 'child_process';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../..');

export const HOOKS_DIR = join(ROOT, '.claude/hooks');

export interface HookHandler {
  type?: string;
  command?: string;
  args?: string[];
}

export type HookRegistry = Record<string, { matcher?: string; hooks?: HookHandler[] }[]>;

/**
 * Environment variables that change a hook's verdict. A test that means to set
 * one sets it explicitly; the ambient value never leaks in. Without this, a
 * suite run from inside a Claude Code session — which exports
 * CLAUDE_CODE_DISABLE_BACKGROUND_TASKS from `.claude/settings.json` — would see
 * every delegation allowed and read it as the guard being broken.
 */
const VERDICT_ENV = [
  'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
  'AGENTIC_ALLOW_BACKGROUND_AGENTS',
  'AGENTIC_ALLOW_BACKGROUND_BASH',
  'AGENTIC_ALLOW_UNSETTLED_TURN',
  'AGENTIC_LOOP_DEADLINE_EPOCH',
  'AGENTIC_STOP_BLOCK_LIMIT',
  'CLAUDE_PROJECT_DIR',
];

export interface HookRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Feeds `input` to a hook on stdin and returns what it did. */
export function runHook(script: string, input: string, env: NodeJS.ProcessEnv = {}): HookRun {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const name of VERDICT_ENV) delete base[name];
  const result = spawnSync(process.execPath, [join(HOOKS_DIR, script)], {
    input,
    encoding: 'utf8',
    env: { ...base, ...env },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The script a registered handler runs: its first `args` entry, else its command. */
export function hookScript(handler: HookHandler): string {
  return handler.args?.[0] ?? handler.command ?? '';
}

/** Entries registered on `event` whose handler runs a script named `script`. */
export function registeredHooks(registry: HookRegistry | undefined, event: string, script: string) {
  return (registry?.[event] ?? []).filter((entry) =>
    (entry.hooks ?? []).some((handler) => hookScript(handler).endsWith(`/${script}`))
  );
}
