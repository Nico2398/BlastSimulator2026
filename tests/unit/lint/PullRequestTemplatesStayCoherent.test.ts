// BlastSimulator2026 — pull request templates stay coherent with the machinery that reads PR bodies
//
// Three templates shape every PR body: `.github/pull_request_template.md`
// (hand-opened and interactive-session PRs), and the pipeline's own
// `.github/PULL_REQUEST_TEMPLATE/pipeline.md` and `paused.md`, which the
// `open-pr` step and a pause fill and pass with `--body-file`. Each body is
// then read by machines with strict, line-based rules: the merge gate's
// `READY TO MERGE` line, the merge chain's `Closes #<N>` line, and the
// closing-keyword guard. A template drifting from any of them ships that
// drift into every PR built from it — an unmarked pipeline PR nothing merges,
// or a hand-opened PR the gate merges because a hint line carried the marker.
//
// The marker and close-directive rules are lifted from the shipped workflow
// sources rather than copied, so a change on either side fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const require = createRequire(import.meta.url);

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const DEFAULT_TEMPLATE = read('.github/pull_request_template.md');
const PIPELINE_TEMPLATE = read('.github/PULL_REQUEST_TEMPLATE/pipeline.md');
const PAUSED_TEMPLATE = read('.github/PULL_REQUEST_TEMPLATE/paused.md');

/** The merge gate's marker test, lifted from the composite action's inline script. */
const carriesMergeMarker = ((): ((body: string) => boolean) => {
  const source = read('.github/actions/agentic-auto-merge/action.yml');
  const start = source.indexOf('const carriesMergeMarker');
  const end = source.indexOf('\n          };', start);
  if (start < 0 || end < start) throw new Error('carriesMergeMarker not found in agentic-auto-merge');
  return new Function(
    `${source.slice(start, end + '\n          };'.length)} return carriesMergeMarker;`
  )() as (body: string) => boolean;
})();

/** The merge chain's close-directive pattern, lifted from `auto-assign-next.yml`. */
const closedIssues = ((): ((body: string) => number[]) => {
  const source = read('.github/workflows/auto-assign-next.yml');
  const match = source.match(/prBody\.matchAll\((\/.+?\/[a-z]*)\)/);
  const literal = match?.[1];
  if (!literal) throw new Error('close-directive pattern not found in auto-assign-next');
  const pattern = new RegExp(
    literal.slice(1, literal.lastIndexOf('/')),
    literal.slice(literal.lastIndexOf('/') + 1)
  );
  return (body) => [...body.matchAll(pattern)].map((m) => Number(m[1]));
})();

/* eslint-disable @typescript-eslint/no-explicit-any */
const { findClosingKeywordViolations } = require(
  join(ROOT, '.github/scripts/check-closing-keywords.cjs')
) as { findClosingKeywordViolations: (input: { body: string }) => unknown[] };

/** The verification channels the Claude Code entry point's Verification Gate table names. */
const GATE_CHANNELS = [...read('.claude/CLAUDE.md').matchAll(/^\| `(\w+)` \| `npm run/gm)].map(
  (m) => m[1]
);

/** Fills a pipeline template's placeholders the way a run does. */
const fill = (template: string): string =>
  template
    .replace(/<N>|<your issue>/g, '4242')
    .replace(/<blocker>/g, '4243')
    .replace(/<[^>\n]*>/g, 'filled');

const channelLines = (body: string): string[] => {
  const section = body.split('## Verification')[1]?.split(/\n## /)[0] ?? '';
  return [...section.matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? '');
};

describe('the Verification Gate channel list', () => {
  it('is read from the entry point', () => {
    expect(GATE_CHANNELS).toEqual(['static', 'logic', 'scenario', 'visual']);
  });
});

describe('pipeline.md — the body open-pr fills', () => {
  const filled = fill(PIPELINE_TEMPLATE);

  it('closes exactly its own issue through the merge chain', () => {
    expect(closedIssues(filled)).toEqual([4242]);
  });

  it('hands the PR to the merge gate', () => {
    expect(carriesMergeMarker(filled)).toBe(true);
    expect(filled.trim().split('\n').at(-1)).toBe('READY TO MERGE');
  });

  it('reports every Verification Gate channel', () => {
    expect(channelLines(PIPELINE_TEMPLATE)).toEqual(expect.arrayContaining(GATE_CHANNELS));
  });

  it('reserves the Decisions taken section', () => {
    expect(PIPELINE_TEMPLATE).toMatch(/^## Decisions taken$/m);
  });

  it('passes the closing-keyword guard once filled', () => {
    expect(findClosingKeywordViolations({ body: filled })).toEqual([]);
  });
});

describe('paused.md — the handover body a pause fills', () => {
  const filled = fill(PAUSED_TEMPLATE);

  it('closes its own issue and never the blocker', () => {
    expect(closedIssues(filled)).toEqual([4242]);
  });

  it('stays out of the merge gate', () => {
    expect(carriesMergeMarker(filled)).toBe(false);
  });

  it('carries the handover sections', () => {
    for (const heading of ['## Done', '## Remaining', '## What #<blocker> changes', '## Resuming']) {
      expect(PAUSED_TEMPLATE).toContain(heading);
    }
  });

  it('passes the closing-keyword guard once filled', () => {
    expect(findClosingKeywordViolations({ body: filled })).toEqual([]);
  });
});

describe('pull_request_template.md — the default for hand-opened PRs', () => {
  it('never carries the merge marker, even in a hint', () => {
    expect(DEFAULT_TEMPLATE).not.toContain('READY TO MERGE');
  });

  it('closes no issue as written', () => {
    expect(closedIssues(DEFAULT_TEMPLATE)).toEqual([]);
  });

  it('passes the closing-keyword guard as written', () => {
    expect(findClosingKeywordViolations({ body: DEFAULT_TEMPLATE })).toEqual([]);
  });

  it('reports every Verification Gate channel', () => {
    expect(channelLines(DEFAULT_TEMPLATE)).toEqual(expect.arrayContaining(GATE_CHANNELS));
  });
});
