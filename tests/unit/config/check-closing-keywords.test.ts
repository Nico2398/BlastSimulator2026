// BlastSimulator2026 — Closing-keyword guard
//
// Issue #755: three incidents on issue #707 in one day, each a docs-only
// attempt to correct the previous, each retriggering GitHub's substring-match
// closing-keyword parser. These tests drive the same detection logic the CI
// guard workflow runs (`.github/workflows/agentic-closing-keyword-guard.yml`),
// against the exact shapes those incidents took plus the issue's own test
// criteria.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
const guard = require(join(ROOT, '.github/scripts/check-closing-keywords.cjs'));
const { findClosingKeywordViolations, stripCodeSpans } = guard;

describe('findClosingKeywordViolations', () => {
  it('flags a closing keyword in plain prose referencing another issue', () => {
    const violations = findClosingKeywordViolations({
      title: 'docs: note the incident',
      body: 'This PR is unrelated, but it closed #42 the same way as before.',
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe('body');
    expect(violations[0].text.toLowerCase()).toContain('closed #42');
  });

  it('does not flag `Closes #<N>` inside backticks', () => {
    const violations = findClosingKeywordViolations({
      body: 'Earlier PRs wrote `Closes #707` and it caused problems.',
    });
    expect(violations).toHaveLength(0);
  });

  it('does not flag the intentional standalone closing line', () => {
    const violations = findClosingKeywordViolations({
      body: 'Some summary of the change.\n\nCloses #755\n\nREADY TO MERGE',
    });
    expect(violations).toHaveLength(0);
  });

  it('does not flag a fenced code block quoting the pattern', () => {
    const violations = findClosingKeywordViolations({
      body: 'Example of the bug:\n\n```\nclosed #707\n```\n\nThat is what to avoid.',
    });
    expect(violations).toHaveLength(0);
  });

  it('flags a negated sentence — negation does not protect the phrase', () => {
    const violations = findClosingKeywordViolations({
      body: 'To be clear, this PR does not close #707.',
    });
    expect(violations).toHaveLength(1);
  });

  it('flags a quoted disclaiming sentence quoted in plain prose (exhibit 2)', () => {
    const violations = findClosingKeywordViolations({
      body: 'The previous PR said: "this PR does not close #707" — and it closed anyway.',
    });
    // Two adjacent matches: the quoted "close #707" and the narrated "closed anyway"
    // has no number so only the quoted one counts, plus "it closed anyway" has no #.
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('flags a past-tense commit message narrating a prior incident (exhibit 4)', () => {
    const violations = findClosingKeywordViolations({
      commitMessages: [
        'fix: correct the postmortem\n\nThat squash-merge closed #707 on merge despite its body saying otherwise.',
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe('commit 1');
  });

  it('does not flag a commit message with no closing-keyword shape', () => {
    const violations = findClosingKeywordViolations({
      commitMessages: ['fix: tighten the regex used elsewhere', 'chore: bump a dependency'],
    });
    expect(violations).toHaveLength(0);
  });

  it('allows a standalone closing line even with trailing punctuation', () => {
    const violations = findClosingKeywordViolations({ body: 'Closes #755.' });
    expect(violations).toHaveLength(0);
  });

  // Through PR #980 the pipeline's `open-pr` step mandated the title
  // `<type>: Resolve #<N>`. The guard (#765) landed against that convention, so
  // PR #773 — the first pipeline PR opened after it merged — failed on its own
  // mandated title, and every pipeline PR after it would have too. Both shapes
  // are deliberate directives, not the prose the postmortem is about. The
  // exemption stays for the pull requests already opened under that title and
  // for a hand-written directive title.
  it.each([
    'fix: Resolve #769',
    'feat: Closes #12',
    'refactor(renderer): Resolves #300',
    'fix(core)!: Fixes #1',
  ])('does not flag the typed directive title shape %s', (title) => {
    expect(findClosingKeywordViolations({ title })).toHaveLength(0);
  });

  // The title `open-pr` writes now: `<type>: <summary> (#<N>)`. It carries no
  // closing directive — the body's `Closes #<N>` line does that — so it passes
  // on the parser's own terms, with no exemption involved. The parenthesis
  // between a summary's last word and the number is what keeps a summary that
  // happens to end in a keyword clean.
  it.each([
    'feat: charging is real work, a blaster loads holes one at a time (#554)',
    'fix: tutorial deadlock at Train Driller/Train Digger (#903)',
    'fix: armed placement tool survives a right-drag camera orbit (#544)',
    'fix: dispatcher no longer hangs on close (#554)',
    'refactor(renderer): extract the terrain skirt builder (#560)',
  ])('does not flag the descriptive PR title shape %s', (title) => {
    expect(findClosingKeywordViolations({ title })).toHaveLength(0);
  });

  // A descriptive title is not a licence to narrate: the summary itself is
  // read the same way as any prose.
  it('flags a descriptive title whose summary puts a keyword before a number', () => {
    const violations = findClosingKeywordViolations({
      title: 'fix: dispatcher no longer hangs, which also fixes #560 (#554)',
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].source).toBe('title');
  });

  // The prefix is a closed list of conventional-commit types, which is what
  // keeps the exemption a recognised shape rather than "any word before a
  // colon".
  it('still flags a closing directive behind an unrecognised prefix word', () => {
    const violations = findClosingKeywordViolations({ body: 'note: fixes #99' });
    expect(violations).toHaveLength(1);
  });

  // The exemption is about the whole line, never about the number: a typed
  // prefix does not license prose after the directive.
  it('still flags a typed line that carries prose past the directive', () => {
    const violations = findClosingKeywordViolations({
      title: 'fix: Resolve #769 and also resolve #770 while we are here',
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags the same keyword+number embedded mid-sentence even for the right issue', () => {
    const violations = findClosingKeywordViolations({
      body: 'This change finally resolves #755 after three tries.',
    });
    expect(violations).toHaveLength(1);
  });

  it('is case-insensitive and matches every keyword in the documented set', () => {
    const keywords = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
    for (const kw of keywords) {
      const violations = findClosingKeywordViolations({ body: `prose text ${kw} #99 more text` });
      expect(violations, `expected "${kw}" to be flagged`).toHaveLength(1);
    }
  });

  it('does not match a keyword that is part of a longer word', () => {
    const violations = findClosingKeywordViolations({
      body: 'The dialog auto-closed #99 is not a real closing reference in disclosed #99 text.',
    });
    // "auto-closed #99" still contains a boundary before "closed", so it *is* a
    // real match; "disclosed #99" must not double count as a second one from
    // the same non-boundary word.
    expect(violations.length).toBe(1);
  });
});

describe('stripCodeSpans', () => {
  it('blanks fenced code blocks while preserving length', () => {
    const input = '```\nclosed #1\n```';
    const out = stripCodeSpans(input);
    expect(out).not.toContain('closed #1');
    expect(out.length).toBe(input.length);
  });

  it('blanks inline code spans while preserving length', () => {
    const input = 'see `closed #1` here';
    const out = stripCodeSpans(input);
    expect(out).not.toContain('closed #1');
    expect(out.length).toBe(input.length);
  });

  it('leaves plain text untouched', () => {
    expect(stripCodeSpans('plain text, no code')).toBe('plain text, no code');
  });
});
