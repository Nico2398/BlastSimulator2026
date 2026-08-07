// BlastSimulator2026 — Context file integrity
// Agent, skill, command, and rule frontmatter fails silently: an unrecognised
// field is ignored, so a tool restriction or a preloaded skill can stop
// applying without any error. This suite turns that into a test failure.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateContextFiles } from '../../../scripts/validate-context.js';

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
  const settings = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../..', '.claude/settings.json'), 'utf8')
  ) as { permissions?: { deny?: string[] } };

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
});
