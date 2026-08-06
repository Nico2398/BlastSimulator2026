// BlastSimulator2026 — Autonomy loop wiring
// A filed issue is eligible for the pipeline, never a start signal for it. A
// run begins in exactly two ways — a human dispatching `agentic-trigger.yml`,
// or a merged pipeline pull request chaining to the next `ready` issue — and
// from there every step to the merge is a workflow reacting to an event.
// Both halves fail in silence. A removed trigger or a swapped token stops the
// queue with nothing raised, and a new assignment path starts sessions nobody
// asked for, which is how filing issue #489 woke a runner. These tests pin the
// entry points shut and pin the chain between them open.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github/workflows', name), 'utf8');

const ASSIGN_ACTION = 'uses: ./.github/actions/agentic-assign';
const AUTO_MERGE_ACTION = 'uses: ./.github/actions/agentic-auto-merge';

/** The only two workflows allowed to put an issue in front of an agent. */
const ASSIGNING_WORKFLOWS = ['auto-assign-next.yml', 'agentic-trigger.yml'];

// Each of these once assigned, and each removal was deliberate. Named
// individually rather than swept up by a glob, so restoring assignment to one
// of them fails here instead of quietly widening the entry points again.
const NON_ASSIGNING_WORKFLOWS = [
  'agentic-intake.yml',
  'agentic-watchdog.yml',
  'claude-runner.yml',
  'opencode-runner.yml',
];

describe('entry points into the assignment queue', () => {
  it('opens exactly two ways in', () => {
    for (const name of ASSIGNING_WORKFLOWS) {
      expect(workflow(name), `${name} no longer assigns`).toContain(ASSIGN_ACTION);
    }
    for (const name of NON_ASSIGNING_WORKFLOWS) {
      expect(workflow(name), `${name} assigns again`).not.toContain(ASSIGN_ACTION);
    }
  });

  // `ready` marks an issue eligible and nothing more: it joins the queue and
  // waits there. Filing one used to reach `agentic-assign` through intake,
  // which is how an issue created with the documented default labels started a
  // session the moment it existed.
  it('starts nothing when an issue is filed or labelled', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).not.toContain(ASSIGN_ACTION);
    expect(intake).not.toContain('labeled');
    expect(intake).not.toMatch(/\n {2}assign:/);
  });

  it('starts a run from a human dispatching the trigger', () => {
    const trigger = workflow('agentic-trigger.yml');
    const triggers = trigger.slice(trigger.indexOf('\non:'), trigger.indexOf('\npermissions:'));
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('issues:');
    expect(trigger).toContain(ASSIGN_ACTION);
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

  // The sweep is the one clock left in the pipeline, and it exists to release
  // issues, never to claim them. It used to restart an idle queue as well,
  // which meant any `ready` issue eventually started a run on a timer.
  it('sweeps stalled runs on a schedule without assigning anything', () => {
    const watchdog = workflow('agentic-watchdog.yml');
    expect(watchdog).toContain('schedule:');
    expect(watchdog).not.toContain(ASSIGN_ACTION);
    expect(watchdog).toContain('in-progress');
  });

  // A run that answers a question or executes a command closes its own issue
  // and opens no PR, so there is no merge to chain from. Starting the next
  // session there would be the pipeline deciding to run again on its own.
  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s releases its issue without starting the next run',
    (name) => {
      const text = workflow(name);
      expect(text).not.toContain(ASSIGN_ACTION);
      expect(text).toContain(AUTO_MERGE_ACTION);
    }
  );
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
      const start = text.indexOf('- name: Arm auto-merge');
      const next = text.indexOf('\n      - name:', start);
      const step = text.slice(start, next > -1 ? next : undefined);
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

// PR #434 was opened by the pipeline, fully verified, marked `READY TO MERGE`,
// went green — and sat open. Both arming paths ran and both reported success:
// the `enablePullRequestAutoMerge` mutation named its variable `$method`, which
// @octokit/graphql rejects before the request leaves the runner, and the catch
// block only recognised two error messages, so the throw became a warning in a
// log nobody reads.
describe('enabling auto-merge actually reaches GitHub', () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );

  // @octokit/graphql merges the variables object into its own request options,
  // so a variable sharing a name with one of them is a hard throw:
  // `[@octokit/graphql] "method" cannot be used as variable name`.
  // From `NON_VARIABLE_OPTIONS` in @octokit/graphql.
  const RESERVED = ['method', 'baseUrl', 'url', 'headers', 'query', 'mediaType', 'request'];

  it('names no GraphQL variable after an @octokit/graphql request option', () => {
    const declarations = source.match(/\$[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z[]/g) ?? [];
    expect(declarations.length, 'no GraphQL variable declarations found').toBeGreaterThan(0);

    for (const declaration of declarations) {
      const name = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(declaration)?.[1] ?? '';
      expect(RESERVED, `$${name} is an @octokit/graphql request option`).not.toContain(name);
    }
  });

  // Same collision seen from the other side: the object handed to
  // `github.graphql` is what octokit inspects, so its keys carry the rule too.
  it('passes no GraphQL variable keyed by a request option', () => {
    const call = source.slice(source.indexOf('await github.graphql('));
    const variables = /\{([^{}]*)\}\s*\n\s*\);/.exec(call)?.[1] ?? '';
    expect(variables, 'no variables object found on the graphql call').not.toBe('');

    for (const key of variables.split(',').map((pair) => pair.split(':')[0].trim())) {
      expect(RESERVED, `\`${key}\` is an @octokit/graphql request option`).not.toContain(key);
    }
  });

  // The bug was survivable; the silence was not. A marked PR that ends neither
  // armed nor merged holds its issue, and every assignment behind it.
  it('fails the step when a marked PR ends neither armed nor merged', () => {
    expect(source).toContain("core.setOutput('unarmed'");
    expect(source).toMatch(/if \(unarmed\.length > 0\) \{\s*\n\s*core\.setFailed\(/);
  });
});

describe('deciding whether to merge a PR auto-merge refused', () => {
  // Lifted out of the composite action's inline script, as above.
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );
  const start = source.indexOf('const mergeVerdict');
  const end = source.indexOf('\n          };', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const mergeVerdict = new Function(
    `${source.slice(start, end + '\n          };'.length)} return mergeVerdict;`
  )() as (state: string) => string;

  it('merges only on `clean`, the state auto-merge would have waited for', () => {
    expect(mergeVerdict('clean')).toBe('merge');
  });

  // The arming step runs seconds after the PR was opened, while GitHub is still
  // computing mergeability and the checks have not reported. Reading that as
  // "not mergeable" is how a PR opened and armed in one job never merges.
  it.each(['unknown', 'unstable', 'blocked', 'has_hooks'])('waits out `%s`', (state) => {
    expect(mergeVerdict(state)).toBe('wait');
  });

  // Neither resolves on its own, so waiting only burns the budget.
  it.each(['dirty', 'behind'])('gives up immediately on `%s`', (state) => {
    expect(mergeVerdict(state)).toBe('stuck');
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
