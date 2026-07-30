// BlastSimulator2026 — Autonomy loop wiring
// The pipeline takes one human input, a filed issue, and every step from there
// to a merged pull request is a workflow reacting to an event. A removed
// trigger or a swapped token breaks the chain in silence: nothing errors, the
// queue simply stops moving and no run is there to notice. These tests pin the
// wiring that keeps it moving.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github/workflows', name), 'utf8');

const ASSIGN_ACTION = 'uses: ./.github/actions/agentic-assign';

/** Every workflow that can put an issue in front of an agent. */
const ASSIGNING_WORKFLOWS = [
  'agentic-intake.yml',
  'auto-assign-next.yml',
  'agentic-watchdog.yml',
  'agentic-trigger.yml',
  'claude-runner.yml',
  'opencode-runner.yml',
];

describe('entry points into the assignment queue', () => {
  it('starts a run from a filed issue', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).toMatch(/issues:\s*\n\s*types:\s*\[opened, reopened, labeled\]/);
    expect(intake).toContain(ASSIGN_ACTION);
  });

  it('re-enters intake on `ready` alone, so pipeline labels cannot retrigger it', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).toContain("github.event.label.name == 'ready'");
  });

  // Parallel intakes each read the `in-progress` label before any of them
  // writes it, so without this every issue of a filed batch gets assigned.
  it('serialises assignment while leaving labelling unserialised', () => {
    const intake = workflow('agentic-intake.yml');
    const assignJob = intake.slice(intake.indexOf('\n  assign:'));
    expect(assignJob).toMatch(/concurrency:\s*\n\s*group: agentic-assignment/);
    expect(intake.slice(0, intake.indexOf('\n  assign:'))).not.toContain('concurrency:');
  });

  it('chains from a merged pull request to the next issue', () => {
    const chain = workflow('auto-assign-next.yml');
    expect(chain).toMatch(/pull_request:\s*\n\s*types:.*closed/);
    expect(chain).toContain(ASSIGN_ACTION);
  });

  // Auto-merge is enabled from the PR body, and `READY TO MERGE` does not always
  // arrive with the PR. Every event that can add it has to re-evaluate, or the PR
  // never merges — and an unmerged PR holds the queue indefinitely, because the
  // watchdog skips an issue that has one linked.
  it('re-evaluates auto-merge on every event that can add the marker', () => {
    const chain = workflow('auto-assign-next.yml');
    const types = /pull_request:\s*\n\s*types:\s*\[([^\]]+)\]/.exec(chain)?.[1] ?? '';
    for (const type of ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review']) {
      expect(types, `pull_request trigger is missing \`${type}\``).toContain(type);
    }
  });

  it('restarts an idle queue from the hourly sweep', () => {
    const watchdog = workflow('agentic-watchdog.yml');
    expect(watchdog).toContain('schedule:');
    expect(watchdog).toContain(ASSIGN_ACTION);
  });
});

describe('assignment tokens', () => {
  // A comment posted with GITHUB_TOKEN triggers no workflow, so the assignment
  // comment reaches the agent's mention and starts nothing at all.
  it.each(ASSIGNING_WORKFLOWS)('%s assigns with the PAT', (name) => {
    const text = workflow(name);
    const index = text.indexOf(ASSIGN_ACTION);
    expect(index, `${name} no longer assigns`).toBeGreaterThan(-1);

    const block = text.slice(index, index + 500);
    const token = /token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/.exec(block);
    expect(token?.[1]).toBe('PAT_TOKEN_COPILOT_AUTOMATION');
  });
});

describe('dependency gating', () => {
  // The parser lives inside the composite action's inline script, where it
  // cannot be imported. Lifting the function out of the YAML tests the actual
  // shipped source rather than a copy that drifts from it.
  const source = readFileSync(join(ROOT, '.github/actions/agentic-assign/action.yml'), 'utf8');
  const start = source.indexOf('const dependenciesOf');
  const end = source.indexOf('\n          };', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const dependenciesOf = new Function(
    `${source.slice(start, end + '\n          };'.length)} return dependenciesOf;`
  )() as (body: string) => number[];

  it('reads the `Blocked by` section the issue form and issue skill produce', () => {
    expect(dependenciesOf('### Blocked by\n\n- #302 — level definition must exist first\n')).toEqual([302]);
  });

  it('reads the inline `Depends on` spelling older issues carry', () => {
    expect(dependenciesOf('Depends on: #12\n')).toEqual([12]);
  });

  it('collects every dependency in the section, not only the first', () => {
    expect(dependenciesOf('## Blocked by\n- #7\n- #9\n')).toEqual([7, 9]);
  });

  it('stops at the next section', () => {
    const body = '## Blocked by\n\n- #7\n\n## Conventions\n\n- matches the pattern in #999\n';
    expect(dependenciesOf(body)).toEqual([7]);
  });

  it('treats a section with no issue reference as unblocked', () => {
    expect(dependenciesOf('## Blocked by\n\nNone\n')).toEqual([]);
    expect(dependenciesOf('## Context\n\nSee #55 for background.\n')).toEqual([]);
  });
});

// PR #430 was opened by the pipeline, fully verified, marked `READY TO MERGE`,
// and then sat open with zero checks. Its author was `github-actions[bot]`, and
// every `pull_request` workflow run a bot-authored PR raises is created and
// immediately parked as `action_required`: CI never started and the auto-merge
// step never ran. So the run that opens the PR arms auto-merge itself, in the
// same job, on the branch it was told to build — the one moment that exists
// whoever the PR ends up attributed to.
describe('auto-merge does not depend on the PR author', () => {
  const AUTO_MERGE_ACTION = 'uses: ./.github/actions/agentic-auto-merge';

  /** Every workflow that can put a PR into auto-merge. */
  const MERGING_WORKFLOWS = [
    'claude-runner.yml',
    'opencode-runner.yml',
    'auto-assign-next.yml',
    'agentic-auto-merge.yml',
  ];

  it.each(MERGING_WORKFLOWS)('%s arms auto-merge through the shared action', (name) => {
    expect(workflow(name)).toContain(AUTO_MERGE_ACTION);
  });

  // Releasing a parked run needs `actions: write`, and the merge itself has to
  // raise a `pull_request: closed` event that the chain step reacts to — a merge
  // performed with GITHUB_TOKEN raises none, so the queue stops at the merge.
  it.each(MERGING_WORKFLOWS)('%s arms auto-merge with the PAT', (name) => {
    const text = workflow(name);
    const block = text.slice(text.indexOf(AUTO_MERGE_ACTION));
    const token = /token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/.exec(block);
    expect(token?.[1]).toBe('PAT_TOKEN_COPILOT_AUTOMATION');
  });

  // The whole point of arming inside the runner: it is reached by the run that
  // created the PR, not by an event the PR's author can suppress. Without
  // `always()` an agent step that crashed after opening its PR leaves it unarmed.
  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s arms the branch it was told to build, even when the agent step failed',
    (name) => {
      const text = workflow(name);
      const step = text.slice(text.indexOf('- name: Arm auto-merge'), text.indexOf(ASSIGN_ACTION, text.indexOf('- name: Arm auto-merge')));
      expect(step).toContain(AUTO_MERGE_ACTION);
      expect(step).toContain('head: pipeline/feature-${{ steps.context.outputs.issue }}');
      expect(step).toMatch(/if:\s*always\(\)/);
    }
  );

  // No clock anywhere in the path. Auto-merge is armed by the run that opens the
  // PR and re-armed by `pull_request`; a PR that reaches neither is a manual
  // dispatch, not a polled one.
  it.each(MERGING_WORKFLOWS)('%s arms auto-merge on an event, never on a schedule', (name) => {
    const text = workflow(name);
    const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('cron:');
  });

  it('keeps the standalone auto-merge workflow manual-only', () => {
    const sweep = workflow('agentic-auto-merge.yml');
    const triggers = sweep.slice(sweep.indexOf('\non:'), sweep.indexOf('\npermissions:'));
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers.replace('workflow_dispatch:', '')).not.toMatch(/^\s{2}\w+.*:$/m);
  });

  // The author may appear in a log line or a comment — it is worth reporting.
  // What must never appear is a branch taken on it.
  it('never selects a PR by the account that opened it', () => {
    const code = readFileSync(
      join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
    )
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && !line.trim().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/login\s*[=!]==/);
    expect(code).not.toMatch(/['"`]github-actions/);
  });
});

describe('the READY TO MERGE marker', () => {
  // Lifted out of the composite action's inline script rather than copied, so
  // the test exercises the shipped source instead of a drifting duplicate.
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );
  const start = source.indexOf('const carriesMergeMarker');
  const end = source.indexOf('\n          };', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const carriesMergeMarker = new Function(
    `${source.slice(start, end + '\n          };'.length)} return carriesMergeMarker;`
  )() as (body: string | null | undefined) => boolean;

  it('accepts the marker on a line of its own', () => {
    expect(carriesMergeMarker('Closes #404\n\nREADY TO MERGE\n')).toBe(true);
  });

  it('accepts the whitespace an API round trip leaves on the line', () => {
    expect(carriesMergeMarker('Closes #404\n\n  READY TO MERGE  \r\n')).toBe(true);
  });

  it('rejects the phrase inside a sentence, which is how a run says it is not', () => {
    expect(carriesMergeMarker('READY TO MERGE skipped — visual: BLOCKED')).toBe(false);
    expect(carriesMergeMarker('This is not READY TO MERGE yet.')).toBe(false);
  });

  it('treats an empty body as unmarked', () => {
    expect(carriesMergeMarker('')).toBe(false);
    expect(carriesMergeMarker(null)).toBe(false);
    expect(carriesMergeMarker(undefined)).toBe(false);
  });
});
