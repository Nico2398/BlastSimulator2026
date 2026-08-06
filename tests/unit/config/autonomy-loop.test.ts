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

  it('keeps the standalone auto-merge workflow reachable by hand', () => {
    const sweep = workflow('agentic-auto-merge.yml');
    const triggers = sweep.slice(sweep.indexOf('\non:'), sweep.indexOf('\npermissions:'));
    expect(triggers).toContain('workflow_dispatch:');
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

// PR #499 was verified on every channel, marked, and green — and stayed open.
// `main` requires no status check, so GitHub refuses native auto-merge outright
// (`Pull request is in unstable status`) and the action always falls through to
// merging the PR itself. That fallback read `unstable` as "wait", so it polled
// for its whole 10-minute budget while the `full-ci` browser jobs still had 35
// minutes to run, then declared the PR stuck. Nothing swept it again, because
// no `pull_request` event fires when checks finish.
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
  )() as (
    state: string,
    checks: { pending: number; failed: number; total: number }
  ) => string;

  const allReported = { pending: 0, failed: 0, total: 3 };
  const running = { pending: 1, failed: 0, total: 3 };
  const red = { pending: 0, failed: 1, total: 3 };
  const nothingYet = { pending: 0, failed: 0, total: 0 };

  it('merges once every run on the head has reported and none failed', () => {
    expect(mergeVerdict('clean', allReported)).toBe('merge');
  });

  // `unknown` is only "GitHub has not finished computing mergeability". It used
  // to be polled out; the merge call answers it directly instead, so a state
  // that says nothing about CI no longer stops a PR whose runs are all green.
  it.each(['unknown', 'unstable', 'blocked', 'has_hooks'])(
    'lets the merge call settle `%s` rather than polling it out',
    (state) => {
      expect(mergeVerdict(state, allReported)).toBe('merge');
    }
  );

  // The regression #499 died on: a state no amount of waiting resolves inside
  // one job, because what it is waiting for is a browser job with half an hour
  // left. The CI-completion sweep is what comes back for it.
  it.each(['unstable', 'blocked', 'unknown', 'clean'])(
    'defers `%s` to the CI-completion sweep while a run is still going',
    (state) => {
      expect(mergeVerdict(state, running)).toBe('pending');
    }
  );

  // Absence of evidence is not a pass. A PR read in the second before its CI
  // run is created has nothing failing and nothing running, and merging on that
  // ships code no channel ever saw.
  it.each(['clean', 'unknown', 'unstable'])(
    'refuses to read `%s` with no run at all as a green head',
    (state) => {
      expect(mergeVerdict(state, nothingYet)).toBe('pending');
    }
  );

  it.each(['unstable', 'blocked', 'unknown', 'clean'])(
    'gives up immediately on `%s` once a run has failed',
    (state) => {
      expect(mergeVerdict(state, red)).toBe('stuck');
    }
  );

  // Neither resolves on its own, so deferring them only defers a dead end.
  it.each(['dirty', 'behind'])('gives up immediately on `%s`', (state) => {
    expect(mergeVerdict(state, allReported)).toBe('stuck');
    expect(mergeVerdict(state, running)).toBe('stuck');
  });

  // A PR waiting on CI is the normal state of a PR the pipeline just opened.
  // Failing the step for it would cry wolf on every single run.
  it('reports a PR waiting on its runs separately from one that is stuck', () => {
    expect(source).toContain("core.setOutput('pending'");
    expect(source).toMatch(/if \(verdict === 'pending'\) \{/);
    const failure = source.slice(source.indexOf('if (unarmed.length > 0)'));
    expect(failure).not.toContain('pending.length');
  });
});

// #499's head replayed from the three workflow runs GitHub actually recorded
// against `b2483b6`, at the two moments that decided its fate. Ids, paths and
// conclusions are the real ones; only `status` moves between the two cases,
// because that is the only thing that moved between 01:30 and 02:15.
describe("reading #499's head the way the action now reads it", () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );
  const start = source.indexOf('const RUN_FAILURES');
  const end = source.indexOf('\n          };', source.indexOf('const checkState'));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const verdictStart = source.indexOf('const mergeVerdict');
  const mergeVerdict = new Function(
    `${source.slice(verdictStart, source.indexOf('\n          };', verdictStart) + '\n          };'.length)} return mergeVerdict;`
  )() as (state: string, checks: Checks) => string;

  interface Checks { pending: number; failed: number; total: number }
  interface Run { id: number; path: string; workflow_id: number; status: string; conclusion: string | null }

  const buildCheckState = (runId: number, ownWorkflowRef: string) =>
    new Function(
      'context',
      'process',
      `${source.slice(start, end + '\n          };'.length)} return checkState;`
    )(
      { runId },
      { env: { GITHUB_WORKFLOW_REF: ownWorkflowRef } }
    ) as (runs: Run[]) => Checks;

  const CI = { id: 31062936274, path: '.github/workflows/ci.yml', workflow_id: 254203664 };
  const REVIEW = { id: 31062936235, path: '.github/workflows/claude-code-review.yml', workflow_id: 320501354 };
  const CHAIN = { id: 31062936200, path: '.github/workflows/auto-assign-next.yml', workflow_id: 255968026 };

  // 01:30:50 — the sweep runs inside `chain-next-task` itself, seconds after
  // the PR opened. CI has 45 minutes left to run.
  it('defers instead of burning ten minutes and calling the PR stuck', () => {
    const checkState = buildCheckState(
      CHAIN.id,
      `Nico2398/BlastSimulator2026/.github/workflows/auto-assign-next.yml@refs/heads/main`
    );

    const checks = checkState([
      { ...CI, status: 'in_progress', conclusion: null },
      { ...REVIEW, status: 'completed', conclusion: 'skipped' },
      { ...CHAIN, status: 'in_progress', conclusion: null },
    ]);

    // Its own run is not counted — that is the self-wait that would strand
    // every PR — and `skipped` is not a failure.
    expect(checks).toEqual({ pending: 1, failed: 0, total: 2 });
    expect(mergeVerdict('unstable', checks)).toBe('pending');
  });

  // 02:15:20 — CI completes, which is now itself the event that runs the sweep.
  it('merges #499 on the CI-completion sweep', () => {
    const checkState = buildCheckState(
      99999999999,
      `Nico2398/BlastSimulator2026/.github/workflows/agentic-auto-merge.yml@refs/heads/main`
    );

    const checks = checkState([
      { ...CI, status: 'completed', conclusion: 'success' },
      { ...REVIEW, status: 'completed', conclusion: 'skipped' },
      { ...CHAIN, status: 'completed', conclusion: 'success' },
    ]);

    expect(checks).toEqual({ pending: 0, failed: 0, total: 3 });
    expect(mergeVerdict('clean', checks)).toBe('merge');
  });

  // `cancel-in-progress` is on the CI workflow, so a superseded run sits on the
  // same head. Counting it would read a live green PR as permanently failed.
  it('reads a superseded CI run as replaced, not as a failure', () => {
    const checkState = buildCheckState(0, '');

    const checks = checkState([
      { ...CI, id: CI.id - 1, status: 'completed', conclusion: 'cancelled' },
      { ...CI, status: 'completed', conclusion: 'success' },
    ]);

    expect(checks).toEqual({ pending: 0, failed: 0, total: 1 });
    expect(mergeVerdict('clean', checks)).toBe('merge');
  });

  it('still calls a genuinely failed CI run stuck', () => {
    const checkState = buildCheckState(0, '');

    const checks = checkState([
      { ...CI, status: 'completed', conclusion: 'failure' },
      { ...REVIEW, status: 'completed', conclusion: 'skipped' },
    ]);

    expect(checks).toEqual({ pending: 0, failed: 1, total: 2 });
    expect(mergeVerdict('unstable', checks)).toBe('stuck');
  });
});

// Every wait in this action was a guess at something an event already reports.
// A sleeping runner is also the one state that cannot say what it is waiting
// for, which is how #499's ten minutes of identical log lines ended in a wrong
// verdict rather than a useful one.
describe('the auto-merge path holds no timer', () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );

  it('never sleeps, polls, or reads the clock', () => {
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('Date.now');
    expect(source).not.toMatch(/settle/i);
  });

  // A sleep in the workflow around it would be the same mechanism moved one
  // file out.
  it.each(['agentic-auto-merge.yml', 'auto-assign-next.yml'])(
    '%s waits on no clock either',
    (name) => {
      expect(workflow(name)).not.toMatch(/^\s*(run:\s*)?sleep\s/m);
    }
  );

  // The merge request is the authority on whether a PR merges. Asking GitHub
  // is what replaced polling until it looked like the answer was yes.
  it('asks GitHub to merge rather than predicting that it would', () => {
    expect(source).toContain('github.rest.pulls.merge(');
    const attempt = source.slice(source.indexOf("if (verdict === 'stuck')"));
    expect(attempt).toContain('github.rest.pulls.merge(');
  });
});

// The other half of the same failure: knowing that `unstable` means "come back
// later" is worthless without an event that brings the sweep back. CI finishing
// raises no `pull_request` event, so before this trigger existed the last word
// on a PR was always spoken while its checks were still running.
describe('the sweep that runs when the checks come in', () => {
  const sweep = workflow('agentic-auto-merge.yml');
  const triggers = sweep.slice(sweep.indexOf('\non:'), sweep.indexOf('\npermissions:'));

  it('re-evaluates the PR when CI completes', () => {
    expect(triggers).toMatch(/workflow_run:\s*\n\s*workflows:\s*\["CI"\]/);
    expect(triggers).toMatch(/types:\s*\[completed\]/);
  });

  // `workflows:` matches on the workflow's `name:`, not its filename, so a
  // rename in ci.yml silently unhooks the only path that merges anything.
  it('names the CI workflow as CI declares itself', () => {
    const declared = /^name:\s*(.+)$/m.exec(workflow('ci.yml'))?.[1].trim();
    expect(declared).toBe('CI');
  });

  it('sweeps the branch CI reported on, not every open PR', () => {
    expect(sweep).toContain('head: ${{ github.event.workflow_run.head_branch }}');
  });

  // A red CI run has nothing to merge, and sweeping it only restates a red
  // check as a red workflow.
  it('skips the sweep when CI failed', () => {
    expect(sweep).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('stays off a clock', () => {
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('cron:');
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
