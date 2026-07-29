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
