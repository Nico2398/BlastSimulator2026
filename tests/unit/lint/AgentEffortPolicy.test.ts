// BlastSimulator2026 — Thinking effort is medium or high, and set where it applies
//
// The project rule: nothing runs at low effort. Most work runs at medium; the
// steps that decide correctness — the tests written from the Contract and the
// one independent review — run at high. An agent's frontmatter `effort`
// overrides the session's `--effort` (only the CLAUDE_CODE_EFFORT_LEVEL
// variable outranks it), so the policy is stated per agent rather than left to
// whatever the CLI passes, and OpenCode's `reasoningEffort` mirrors it.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const ALLOWED = ['medium', 'high'];
const HIGH = new Set(['test-writer', 'reviewer']);

function frontmatterField(path: string, field: string): string | undefined {
  const text = readFileSync(path, 'utf8');
  const end = text.indexOf('\n---\n', 3);
  const match = new RegExp(`^${field}:\\s*(\\S+)`, 'm').exec(text.slice(0, end));
  return match?.[1];
}

const agents = readdirSync(join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));

describe('agent effort', () => {
  it.each(agents)('%s declares its effort, medium or high, in both runtimes', (agent) => {
    const expected = HIGH.has(agent) ? 'high' : 'medium';
    expect(frontmatterField(join(ROOT, '.claude/agents', `${agent}.md`), 'effort')).toBe(expected);
    expect(frontmatterField(join(ROOT, '.opencode/agents', `${agent}.md`), 'reasoningEffort')).toBe(expected);
  });
});

describe('session effort', () => {
  it.each(['claude-runner.yml', 'claude-code-review.yml'])('%s passes --effort medium or high on every Claude invocation', (workflow) => {
    const text = readFileSync(join(ROOT, '.github/workflows', workflow), 'utf8');
    const args = [...text.matchAll(/claude_args:\s*'([^']*)'/g)].map((m) => m[1]!);
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) {
      const effort = /--effort\s+(\S+)/.exec(arg)?.[1];
      expect(ALLOWED, `${workflow}: ${arg}`).toContain(effort);
    }
  });

  it('no skill or command frontmatter lowers effort', () => {
    const files = [
      ...readdirSync(join(ROOT, '.claude/commands')).map((f) => join(ROOT, '.claude/commands', f)),
      ...readdirSync(join(ROOT, '.claude/skills')).map((d) => join(ROOT, '.claude/skills', d, 'SKILL.md')),
    ];
    for (const file of files) {
      const effort = frontmatterField(file, 'effort');
      if (effort !== undefined) expect(ALLOWED, file).toContain(effort);
    }
  });
});
