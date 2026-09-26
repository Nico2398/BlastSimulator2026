// BlastSimulator2026 — Context file integrity
// Agent, skill, command, and rule frontmatter fails silently: an unrecognised
// field is ignored, so a tool restriction or a preloaded skill can stop
// applying without any error. This suite turns that into a test failure.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateContextFiles } from '../../../scripts/validate-context.js';
import { hookScript, runHook, type HookRegistry } from '../../helpers/claudeHooks';

const ROOT = join(import.meta.dirname, '../../..');

describe('context files', () => {
  it('pass every frontmatter, tool, skill, hook, and cross-runtime sync check', () => {
    const issues = validateContextFiles();
    const report = issues.map((i) => `${i.file}: ${i.message}`).join('\n');
    expect(report).toBe('');
  });
});

// A question suspends the session waiting for an answer nobody is there to
// give, while the issue holds `in-progress` and every assignment behind it
// waits — the halt `agentic-decision-autonomy` exists to prevent, reached
// through a tool call rather than through a decision. The validator already
// fails without the entry; this states which tool and why, so the failure does
// not arrive as an unexplained context-file error.
describe('tools denied project-wide', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as {
    permissions?: { deny?: string[] };
    hooks?: HookRegistry;
  };

  it('denies AskUserQuestion', () => {
    expect(settings.permissions?.deny ?? []).toContain('AskUserQuestion');
  });

  // Claude Code matches a bare tool name. `AskUserQuestion(...)` would deny one
  // argument shape and leave the tool itself reachable, which reads as denied
  // and is not.
  it('denies the tool itself, not one call shape of it', () => {
    const entries = (settings.permissions?.deny ?? []).filter((rule) =>
      rule.startsWith('AskUserQuestion')
    );
    expect(entries).toEqual(['AskUserQuestion']);
  });

  // The deny rule alone is not enough. It is read by the permission system,
  // and a session running with permissions bypassed never consults it — which
  // is precisely the unattended session, the one whose question can never be
  // answered. A PreToolUse hook runs on the tool call in every mode.
  it('also blocks the call with a hook, which runs in every permission mode', () => {
    const guards = (settings.hooks?.PreToolUse ?? []).filter((entry) =>
      new RegExp(entry.matcher ?? '.*').test('AskUserQuestion')
    );
    const commands = guards.flatMap((entry) =>
      (entry.hooks ?? []).map((hook) => hookScript(hook))
    );
    expect(commands.some((c) => c.endsWith('/no-ask-user-question.mjs'))).toBe(true);
  });

  // Exit 2 is the contract: block the call and show stderr to the agent. Exit 0
  // would let the question through while every other check still passed.
  it('exits 2 and tells the agent what to do instead', () => {
    const { status, stderr } = runHook('no-ask-user-question.mjs', '{"tool_name":"AskUserQuestion"}');
    expect(status).toBe(2);
    expect(stderr).toContain('agentic-decision-autonomy');
  });
});
