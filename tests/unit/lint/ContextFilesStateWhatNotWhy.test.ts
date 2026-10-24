// BlastSimulator2026 — Context files say what to do; history says why
//
// Every context file is paid for each time it loads, and an incident story
// changes no action. `agentic-context-edition` ("What, Not Why") moves the
// history of a rule into `docs/context-history/`, linked by one last line. The
// machine-checkable half of that rule is here: an issue or PR reference is
// history by construction, so no context file carries one, and every history
// link resolves.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '../../..');

const ENTRY_POINTS = ['.claude/CLAUDE.md', '.github/copilot-instructions.md', '.opencode/AGENTS.md'];
const CONTEXT_DIRS = [
  '.claude/agents', '.claude/commands', '.claude/rules', '.claude/skills',
  '.github/agents', '.github/prompts', '.github/instructions', '.github/skills',
  '.opencode/agents', '.opencode/commands', '.opencode/rules', '.opencode/skills',
];

function markdownUnder(dir: string): string[] {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((entry) => {
    const path = join(full, entry);
    if (statSync(path).isDirectory()) return markdownUnder(relative(ROOT, path));
    return entry.endsWith('.md') ? [relative(ROOT, path)] : [];
  });
}

const files = [...ENTRY_POINTS, ...CONTEXT_DIRS.flatMap(markdownUnder)];

/** `#123` as an issue or PR reference — not an HTML entity, not a hex colour with letters. */
const ISSUE_REFERENCE = /(?<![&\w/])#\d{2,}\b(?![a-fA-F])/g;

describe('context files carry no history', () => {
  it('found the context files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no context file cites an issue or a pull request', () => {
    const offenders = files.flatMap((file) =>
      readFileSync(join(ROOT, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (line.match(ISSUE_REFERENCE) ?? []).map((ref) => `${file}:${i + 1} ${ref}`)),
    );
    expect(offenders, `Move the history to docs/context-history/ (agentic-context-edition, "What, Not Why"):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('every history link resolves, and is the file\'s last line', () => {
    const problems: string[] = [];
    for (const file of files) {
      const lines = readFileSync(join(ROOT, file), 'utf8').trimEnd().split('\n');
      lines.forEach((line, i) => {
        const match = /^History: (docs\/context-history\/[a-z0-9-]+\.md)$/.exec(line.trim());
        if (!match) return;
        if (!existsSync(join(ROOT, match[1]!))) problems.push(`${file}: ${match[1]} does not exist`);
        if (i !== lines.length - 1) problems.push(`${file}: the history link is not the last line`);
      });
    }
    expect(problems).toEqual([]);
  });
});
