// BlastSimulator2026 — Context file integrity
// Agent, skill, command, and rule frontmatter fails silently: an unrecognised
// field is ignored, so a tool restriction or a preloaded skill can stop
// applying without any error. This suite turns that into a test failure.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { validateContextFiles } from '../../../scripts/validate-context.js';

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
    hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]>;
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
      (entry.hooks ?? []).map((hook) => hook.command ?? '')
    );
    expect(commands.some((c) => c.endsWith('no-ask-user-question.sh'))).toBe(true);
  });

  const hook = join(ROOT, '.claude/hooks/no-ask-user-question.sh');

  it('ships the hook executable — a hook that cannot run blocks nothing', () => {
    expect(statSync(hook).mode & 0o111).toBeGreaterThan(0);
  });

  // Exit 2 is the contract: block the call and show stderr to the agent. Exit 0
  // would let the question through while every other check still passed.
  it('exits 2 and tells the agent what to do instead', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync(hook, { input: '{"tool_name":"AskUserQuestion"}', encoding: 'utf8' });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status ?? 0;
      stderr = failure.stderr ?? '';
    }
    expect(status).toBe(2);
    expect(stderr).toContain('agentic-decision-autonomy');
  });
});
