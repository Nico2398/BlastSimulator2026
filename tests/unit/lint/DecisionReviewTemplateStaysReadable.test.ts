// BlastSimulator2026 — the decision-review issue body stays readable
//
// `.github/ISSUE_BODY_TEMPLATE/decision-review.md` is the body every
// `decision-review` issue is filed from (`agentic-decision-autonomy`). Those
// issues are read by a human deciding at leisure, so the template holds them to
// one opening sentence followed by a section per question a reviewer asks. The
// body is also posted to GitHub, where a closing keyword in front of the
// originating issue's number would close it the moment the issue is filed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const TEMPLATE_PATH = '.github/ISSUE_BODY_TEMPLATE/decision-review.md';
const TEMPLATE = read(TEMPLATE_PATH);

const { findClosingKeywordViolations } = require(
  join(ROOT, '.github/scripts/check-closing-keywords.cjs')
) as { findClosingKeywordViolations: (input: { body: string }) => unknown[] };

describe('decision-review.md — the body a decision-review issue is filed from', () => {
  it('opens on a one-sentence summary, not a heading', () => {
    const first = TEMPLATE.split('\n').find((line) => line.trim() !== '') ?? '';
    expect(first).not.toMatch(/^#/);
    expect(first).toMatch(/^<One sentence/);
  });

  it('gives each reviewer question its own section', () => {
    for (const heading of [
      '### What was open',
      '### What was chosen',
      '### Why',
      '### Alternatives',
      '### To reverse',
    ]) {
      expect(TEMPLATE).toContain(heading);
    }
  });

  it('links the PR and the originating issue without closing either', () => {
    const filled = TEMPLATE.replace(/<N>/g, '4242').replace(/<PR>/g, '4243');
    expect(filled).toContain('#4242');
    expect(filled).toContain('#4243');
    expect(findClosingKeywordViolations({ body: filled })).toEqual([]);
  });

  it('is the body the owning skill files from, in every runtime mirror', () => {
    for (const dir of ['.claude', '.github', '.opencode']) {
      expect(read(`${dir}/skills/agentic-decision-autonomy/SKILL.md`)).toContain(TEMPLATE_PATH);
    }
  });
});
