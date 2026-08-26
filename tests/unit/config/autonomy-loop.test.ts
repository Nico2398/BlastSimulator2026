// BlastSimulator2026 — Autonomy loop wiring
// A filed issue is eligible for the pipeline, never a start signal for it. A
// run begins in exactly three ways — a human dispatching `agentic-trigger.yml`,
// a merged pipeline pull request chaining to the next `ready` issue, or a run
// that ended `blocked` chaining past itself — and from there every step to the
// merge is a workflow reacting to an event.
// Both halves fail in silence. A removed trigger or a swapped token stops the
// queue with nothing raised, and a new assignment path starts sessions nobody
// asked for, which is how filing issue #489 woke a runner. These tests pin the
// entry points shut and pin the chain between them open.
//
// What each of those paths is allowed to assign is a separate question, decided
// in `.github/scripts/assignability.cjs` and tested in `assignability.test.ts`.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(import.meta.url);

const ROOT = join(import.meta.dirname, '../../..');
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github/workflows', name), 'utf8');

const ASSIGN_ACTION = 'uses: ./.github/actions/agentic-assign';
const AUTO_MERGE_ACTION = 'uses: ./.github/actions/agentic-auto-merge';

/** The only three workflows allowed to put an issue in front of an agent. */
const ASSIGNING_WORKFLOWS = [
  'auto-assign-next.yml',
  'agentic-trigger.yml',
  'handle-failure.yml',
];

// Each of these once assigned, and each removal was deliberate. Named
// individually rather than swept up by a glob, so restoring assignment to one
// of them fails here instead of quietly widening the entry points again.
const NON_ASSIGNING_WORKFLOWS = [
  'agentic-intake.yml',
  'agentic-watchdog.yml',
  'agentic-ci-failure.yml',
  'claude-runner.yml',
  'opencode-runner.yml',
];

describe('entry points into the assignment queue', () => {
  it('opens exactly three ways in', () => {
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

  // Every lifecycle label a run reaches for has to exist before it reaches for
  // it. `paused` is the one that also goes on pull requests, where
  // `assignability.cjs` reads it as a handover rather than a collision — an
  // undefined label there means a paused run's issue is unassignable to
  // everyone until somebody notices.
  it('keeps every lifecycle label a run applies defined', () => {
    const intake = workflow('agentic-intake.yml');
    const defined = [...intake.matchAll(/ensureLabel\(\s*'([a-z-]+)'/g)].map((m) => m[1]);
    expect(defined).toEqual(expect.arrayContaining(['agent-task', 'ready', 'paused']));
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

// A blocked run is terminal exactly as a merge is, and a pipeline with no human
// in it has to keep moving through both. Before this, `blocked` released the
// issue and started nothing: the queue went idle until somebody dispatched the
// trigger, which on a fully autonomous repository means until somebody noticed.
describe('chaining past a run that ended blocked', () => {
  const failure = workflow('handle-failure.yml');

  it('assigns the next issue when a run ends blocked', () => {
    expect(failure).toMatch(/issues:\s*\n\s*types:\s*\[labeled\]/);
    expect(failure).toContain("github.event.label.name == 'blocked'");
    expect(failure).toContain(ASSIGN_ACTION);
  });

  // Without the guard, a human labelling a backlog issue `blocked` — filing a
  // note, not ending a run — would start a session.
  it('chains only from an issue a run actually held', () => {
    expect(failure).toContain('after_blocked_run');
    expect(failure).toContain('completed_issue: ${{ github.event.issue.number }}');
  });

  // `paused` is the other terminal-without-merging outcome: the run stopped on a
  // dependency it filed, put the issue back at `ready` behind that dependency,
  // and ended. It releases the queue exactly as `blocked` does, and if this
  // workflow did not fire on it the queue would simply stop — nothing else
  // starts the next session.
  it('chains past a paused run too, under its own guard', () => {
    expect(failure).toContain("github.event.label.name == 'paused'");
    expect(failure).toContain('after_paused_run');
  });

  // The reason this path did not exist before. A systemic failure — expired
  // token, broken `main` — would otherwise march through the whole backlog
  // labelling every issue `blocked` in minutes.
  it('bounds the cascade a failure chain could cause', () => {
    expect(failure).toContain('blocked_chain_limit:');
    const rules = readFileSync(join(ROOT, '.github/scripts/assignability.cjs'), 'utf8');
    expect(rules).toContain('consecutiveHaltedRuns');
    expect(rules).toContain('latestPipelineMergeAt');
  });

  it('still reports the failure to a human', () => {
    expect(failure).toContain('createComment');
    expect(failure).toContain('@Nico2398');
  });

  // The notification must survive a chain step that threw, or a failure whose
  // assignment could not run becomes a failure nobody is told about.
  it('reports even when the chain step failed', () => {
    expect(failure).toMatch(/if:\s*always\(\) &&.*github\.event\.label\.name == 'blocked'/);
  });

  // A pause asks nothing of a human — the issue is already requeued behind its
  // dependency and comes back on its own. Printing the `blocked` notice's
  // "add the clarification this issue is missing" would send someone looking
  // for a question that was never asked.
  it('does not ask a human for a clarification when the run only paused', () => {
    const notify = failure.slice(failure.indexOf('  notify:'));
    expect(notify).toContain("HALT_LABEL: ${{ github.event.label.name }}");
    expect(notify).toContain('paused');
    // The two notices are chosen from, not concatenated.
    expect(notify).toMatch(/paused\s*\n?\s*\?/);
  });

  // Under the PAT every pipeline comment is authored by a real user, and the
  // runners' trigger guard only filters bots — so a mention here would wake a
  // second run on an issue that just failed.
  it('carries no agent mention in the notification', () => {
    const notify = failure.slice(failure.indexOf('  notify:'));
    expect(notify).not.toContain('@claude');
    expect(notify).not.toContain('@opencode');
  });
});

// A timeline cross-reference is raised by any PR that merely writes "#N" in
// prose, and reading one as "this issue has its PR" is how docs PR #561's
// passing mention of #547 disarmed run #133's retry (#568). The deliverable
// predicate — a PR from `pipeline/feature-<N>`, or one GitHub records as
// closing the issue — is deliberately inlined in the two sites that run
// without a checkout and shared from `issue-api.cjs` everywhere else. Four
// copies that must agree is exactly the shape that drifts silently, so each
// copy's two arms are pinned here, and the mention predicate is pinned out.
describe('a mention is never a deliverable', () => {
  const SITES = [
    ['.github/workflows/agentic-watchdog.yml', 'inline'],
    ['.github/actions/agentic-run-state/action.yml', 'inline'],
    ['.github/scripts/issue-api.cjs', 'shared'],
  ] as const;

  it.each(SITES)('%s carries both arms of the deliverable predicate', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).toContain('closedByPullRequestsReferences');
    expect(text).toContain('includeClosedPrs: false');
    expect(text).toMatch(/pipeline\/feature-\$\{/);
  });

  // The predicate the copies replaced. Code reading `cross-referenced` events
  // as pull requests is the regression; comments may still tell the story.
  it.each([
    '.github/workflows/agentic-watchdog.yml',
    '.github/actions/agentic-run-state/action.yml',
    '.github/actions/agentic-assign/action.yml',
    '.github/actions/agentic-recover-blocked/action.yml',
    '.github/scripts/assignability.cjs',
  ])('%s never reads a cross-reference as a pull request', (file) => {
    const code = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('#') && !trimmed.startsWith('//') && !trimmed.startsWith('*');
      })
      .join('\n');
    expect(code).not.toContain("'cross-referenced'");
  });

  // `issue-api.cjs` is the one file that may touch a cross-reference at all, and
  // only inside the fallback that stands in for `closedByPullRequestsReferences`
  // when that field is down (the 503 of 17 Aug 2026, which skipped every ready
  // issue on three dispatches). The fallback is safe for exactly one reason: it
  // demands a closing keyword, so a PR that merely cites the issue — #561's
  // mention of #547, the case #568 was opened for — still counts for nothing.
  // Drop the keyword filter and the fallback becomes the mention predicate again.
  it('reads a cross-reference only behind a closing keyword', () => {
    const source = readFileSync(join(ROOT, '.github/scripts/issue-api.cjs'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*');
      })
      .join('\n');

    expect(code.match(/'cross-referenced'/g) ?? []).toHaveLength(1);
    const fallback = code.slice(code.indexOf('const closersFromTimeline'));
    expect(fallback.indexOf("'cross-referenced'")).toBeGreaterThan(-1);
    expect(fallback).toContain('keyword.test');

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const { closingKeyword } = require(join(ROOT, '.github/scripts/issue-api.cjs')) as any;
    expect(closingKeyword(547).test('Closes #547')).toBe(true);
    expect(closingKeyword(547).test('resolves #547')).toBe(true);
    expect(closingKeyword(547).test('follow-up to #547, see the thread')).toBe(false);
    expect(closingKeyword(547).test('Closes #5470')).toBe(false);
  });
});

// Three entry points cannot be argued safe by construction the way two could:
// a merge and a blocked label can land in the same second. The repo-wide group
// is what keeps two of them from reading `in-progress` before either writes it.
describe('the entry points cannot race', () => {
  it.each(ASSIGNING_WORKFLOWS)('%s serialises its assigning job', (name) => {
    const text = workflow(name);
    const assign = text.indexOf(ASSIGN_ACTION);
    expect(assign, `${name} no longer assigns`).toBeGreaterThan(-1);
    expect(text.slice(0, assign)).toMatch(/concurrency:\s*\n\s*group: agentic-assignment/);
  });

  // Arming auto-merge must stay outside that group. GitHub keeps one pending run
  // per group and drops the rest, and a dropped arming run is a PR that never
  // merges — which holds its issue and the whole queue behind it.
  it('leaves auto-merge arming out of the group', () => {
    const chain = workflow('auto-assign-next.yml');
    const arm = chain.indexOf(AUTO_MERGE_ACTION);
    const armJob = chain.slice(chain.indexOf('  arm-auto-merge:'), arm);
    expect(arm).toBeGreaterThan(-1);
    expect(armJob).not.toContain('agentic-assignment');
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
      expect(step).toContain('head: ${{ steps.context.outputs.feature_branch }}');
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

// #572 and #610: `agentic-runner`'s workflow-level triggers carry no content
// filter — every comment anywhere in the repository creates a run, whether or
// not the job's own `if:` below will act on it. GitHub Actions keeps only one
// *pending* run per concurrency group, so a burst of such no-op runs (a
// session's own trailing wrap-up comment among them) could silently cancel an
// already-queued real assignment before its job ever started: zero job steps,
// nothing to retry from, and the issue stuck `in-progress` deferring every
// later assignment behind it (`selectNextAssignable`'s single-flight guard
// treats any `in-progress` issue as a live run).
describe('the runner concurrency group only admits a run the job will act on', () => {
  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    "%s's group mirrors its own job `if:`, and isolates everything else",
    (name) => {
      const text = workflow(name);
      const concurrency = text.slice(text.indexOf('\nconcurrency:'), text.indexOf('\npermissions:'));
      const jobIf = text.slice(text.indexOf('\n    if: >'), text.indexOf('\n    runs-on:'));
      expect(jobIf).toContain('if: >');

      // Every clause the job's `if:` branches on must also appear in the
      // group expression, so a run the job will skip cannot still queue.
      for (const clause of ["github.event_name == 'workflow_dispatch'", "github.event.comment.user.type != 'Bot'"]) {
        expect(concurrency, `${name}: group is missing \`${clause}\``).toContain(clause);
        expect(jobIf, `${name}: job \`if:\` is missing \`${clause}\``).toContain(clause);
      }

      // A matching trigger still resolves to the one shared, serialising
      // name; anything else gets its own group keyed by this run, so it can
      // never contend for — or evict — a real queued run.
      expect(concurrency).toContain("&& 'agentic-runner' ||");
      expect(concurrency).toMatch(/format\('agentic-runner-noop-\{0\}',\s*github\.run_id\)/);
      expect(concurrency).toContain('cancel-in-progress: false');
    }
  );
});

// The recovery step is the runner's own last chance to notice its group still
// dropped something — two genuine mentions racing past `agentic-assignment`'s
// own lock, a webhook truly lost. It must never become a second assigning
// path of its own: it only ever labels `blocked`, exactly as the watchdog
// does, and `handle-failure.yml`'s existing reaction does the rest.
describe('a session recovers a run its own slot blocked, on its way out', () => {
  const RECOVER_ACTION = 'uses: ./.github/actions/agentic-recover-blocked';

  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s runs the recovery step last, unconditionally',
    (name) => {
      const text = workflow(name);
      const idx = text.indexOf(RECOVER_ACTION);
      expect(idx, `${name}: recovery step missing`).toBeGreaterThan(-1);
      expect(text.indexOf('uses: ./.github/actions/agentic-auto-merge')).toBeLessThan(idx);

      // No further step after it — the whole tail end of the job is covered
      // by the time it runs, right as its hold on the concurrency slot ends.
      expect(text.indexOf('- name:', idx)).toBe(-1);

      const start = text.lastIndexOf('- name:', idx);
      const step = text.slice(start, text.indexOf('\n\n', idx));
      expect(step).toMatch(/if:\s*always\(\)/);
    }
  );

  it.each(['claude-runner.yml', 'opencode-runner.yml'])('%s hands the recovery step the PAT', (name) => {
    const text = workflow(name);
    const start = text.indexOf(RECOVER_ACTION);
    const block = text.slice(start, start + 300);
    const token = /token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/.exec(block);
    expect(token?.[1]).toBe('PAT_TOKEN_COPILOT_AUTOMATION');
  });

  const action = readFileSync(join(ROOT, '.github/actions/agentic-recover-blocked/action.yml'), 'utf8');

  it('never assigns — only ever labels the issue it recovers `blocked`', () => {
    expect(action).not.toContain(ASSIGN_ACTION);
    expect(action).toContain('rules.BLOCKED');
    expect(action).not.toContain('rules.READY');
  });

  it('reuses the shared deliverable check rather than a fifth inline copy', () => {
    expect(action).toContain('.github/scripts/issue-api.cjs');
    expect(action).toContain('.github/scripts/assignability.cjs');
    expect(action).toContain('api.deliverableFor');
  });

  // #614: a concurrency-blocked run can be reported by the Actions API as
  // `pending`, not only `queued` — the narrower two-status check missed it
  // live and blocked a run that went on to open its PR. Full set mirrors
  // agentic-ci-failure.yml's own LIVE array for the identical check.
  it('only recovers when nothing is queued or live behind this run', () => {
    expect(action).toContain("['queued', 'in_progress', 'waiting', 'requested', 'pending']");
    expect(action).toContain('run.id !== context.runId');
  });

  it('excludes its own issue from the sweep', () => {
    expect(action).toContain('self_issue');
    expect(action).toContain('issue.number === mine');
  });
});

// #614: the "is a runner session live" predicate is deliberately inlined
// twice — here and in agentic-ci-failure.yml's guard — because the latter
// runs with no checkout and cannot `require()` a shared .cjs module. Pinning
// each copy on its own was not enough: agentic-ci-failure.yml has carried
// the full non-terminal status set since #507 (13 Aug), agentic-recover-blocked
// shipped with only `['queued', 'in_progress']` three weeks later in #641,
// and nothing compared the two, so #614's `pending` run was invisible to one
// check and would have been caught by the other. Assert the copies equal
// each other, not just that each individually contains what it should.
describe('the runner-liveness predicate cannot drift between its two copies', () => {
  const recover = readFileSync(
    join(ROOT, '.github/actions/agentic-recover-blocked/action.yml'), 'utf8'
  );
  const failsafe = workflow('agentic-ci-failure.yml');

  const extract = (source, name) => {
    const match = new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(source);
    expect(match, `${name} array not found`).not.toBeNull();
    return match[1];
  };

  it('polls the same runner workflows in both copies', () => {
    expect(extract(recover, 'RUNNERS')).toBe(extract(failsafe, 'RUNNERS'));
  });

  it('polls the same set of non-terminal run statuses in both copies', () => {
    const recoverLive = extract(recover, 'LIVE');
    const failsafeLive = extract(failsafe, 'LIVE');
    expect(recoverLive).toBe(failsafeLive);
    // Pin the content too, not only the agreement — two copies that agree on
    // a narrowed set would pass the line above and still reproduce #614.
    expect(recoverLive).toBe("['queued', 'in_progress', 'waiting', 'requested', 'pending']");
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

// PR #615's actual failure mode: a workflow run's own `conclusion` is
// `success` the instant every job in it either passed or was skipped, so
// `checkState`/`mergeVerdict` alone cannot tell a genuinely green `full-ci`
// PR from one whose interaction shards silently never ran. This is the
// third, independent line of defence (alongside ci.yml's `labeled` trigger
// type and open-pr setting the label at creation) — it asks the CI run's
// own jobs directly.
describe("asking the CI run's own jobs before trusting its conclusion", () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );
  const start = source.indexOf('const LABEL_GATED_JOBS');
  const end = source.indexOf('const method = ');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const buildMissingGatedJobs = (jobsByRunId) =>
    new Function(
      'github',
      'owner',
      'repo',
      `${source.slice(start, end)} return missingGatedJobs;`
    )(
      {
        paginate: async (_fn, { run_id }) => jobsByRunId[run_id] ?? [],
        rest: { actions: { listJobsForWorkflowRun: () => {} } },
      },
      'Nico2398',
      'BlastSimulator2026'
    ) as (labels: { name: string }[], runs: unknown[]) => Promise<string[]>;

  const CI_RUN = { id: 555, path: '.github/workflows/ci.yml' };
  const interactionJob = (n, conclusion) => ({ name: `Scenarios (interaction mode) — shard ${n}/4`, conclusion });
  const buildJob = (conclusion) => ({ name: 'Production build', conclusion });

  it('is a no-op when the PR carries no gated label', async () => {
    const missingGatedJobs = buildMissingGatedJobs({});
    await expect(missingGatedJobs([], [CI_RUN])).resolves.toEqual([]);
  });

  it('clears full-ci once every interaction shard reports success', async () => {
    const missingGatedJobs = buildMissingGatedJobs({
      [CI_RUN.id]: [1, 2, 3, 4].map((n) => interactionJob(n, 'success')),
    });
    await expect(
      missingGatedJobs([{ name: 'full-ci' }], [CI_RUN])
    ).resolves.toEqual([]);
  });

  // The exact #615 shape: the run reports `success`, but the label's job
  // never appears in its own job list at all.
  it('flags full-ci when the interaction job never ran', async () => {
    const missingGatedJobs = buildMissingGatedJobs({ [CI_RUN.id]: [] });
    await expect(
      missingGatedJobs([{ name: 'full-ci' }], [CI_RUN])
    ).resolves.toEqual(['full-ci']);
  });

  it('flags full-ci when a shard is present but did not succeed', async () => {
    const missingGatedJobs = buildMissingGatedJobs({
      [CI_RUN.id]: [interactionJob(1, 'success'), interactionJob(2, 'failure')],
    });
    await expect(
      missingGatedJobs([{ name: 'full-ci' }], [CI_RUN])
    ).resolves.toEqual(['full-ci']);
  });

  it('checks build-check against the Production build job independently of full-ci', async () => {
    const missingGatedJobs = buildMissingGatedJobs({ [CI_RUN.id]: [buildJob('success')] });
    await expect(
      missingGatedJobs([{ name: 'build-check' }], [CI_RUN])
    ).resolves.toEqual([]);
    const missingGatedJobs2 = buildMissingGatedJobs({ [CI_RUN.id]: [] });
    await expect(
      missingGatedJobs2([{ name: 'build-check' }], [CI_RUN])
    ).resolves.toEqual(['build-check']);
  });

  it('looks up the CI run by path, not by display name', async () => {
    const missingGatedJobs = buildMissingGatedJobs({
      [CI_RUN.id]: [1, 2].map((n) => interactionJob(n, 'success')),
    });
    const renamedButSamePath = { id: CI_RUN.id, path: CI_RUN.path };
    await expect(
      missingGatedJobs([{ name: 'full-ci' }], [renamedButSamePath])
    ).resolves.toEqual([]);
  });

  it('reads the newest CI run on the head when more than one is present', async () => {
    const missingGatedJobs = buildMissingGatedJobs({
      [CI_RUN.id]: [],
      [CI_RUN.id + 1]: [1, 2].map((n) => interactionJob(n, 'success')),
    });
    await expect(
      missingGatedJobs(
        [{ name: 'full-ci' }],
        [CI_RUN, { ...CI_RUN, id: CI_RUN.id + 1 }]
      )
    ).resolves.toEqual([]);
  });
});

// The two LABEL_GATED_JOBS array literals -- one real TS
// (scripts/lib/label-gated-jobs.ts, exported and unit-tested directly), one inline
// github-script JS (this same action.yml, extracted above for its own tests)
// -- can drift with nothing in either test suite noticing, since each only
// proves its own copy's behavior. That drift already produced a real
// disagreement once (a PR review round found await-pr-ci.ts's no-ci.yml-run
// case reading GREEN where this action's own equivalent reads every gated
// label missing) before this test existed. Comparing the two literals
// directly is what would have caught it before the behavior ever diverged.
describe('LABEL_GATED_JOBS stays identical between await-pr-ci.ts and this action', () => {
  it('the two array literals are the same value, not just similarly shaped', () => {
    const actionSource = readFileSync(
      join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
    );
    const actionStart = actionSource.indexOf('const LABEL_GATED_JOBS');
    const actionEnd = actionSource.indexOf('];', actionStart) + 2;
    const actionArray = new Function(`${actionSource.slice(actionStart, actionEnd)} return LABEL_GATED_JOBS;`)();

    const tsSource = readFileSync(join(ROOT, 'scripts/lib/label-gated-jobs.ts'), 'utf8');
    const tsStart = tsSource.indexOf('const LABEL_GATED_JOBS');
    const tsEnd = tsSource.indexOf('];', tsStart) + 2;
    // Strip the TS-only type annotation the YAML copy has no equivalent for.
    const tsDecl = tsSource.slice(tsStart, tsEnd).replace(': { label: string; jobNamePrefix: string }[]', '');
    const tsArray = new Function(`${tsDecl} return LABEL_GATED_JOBS;`)();

    expect(actionArray).toEqual(tsArray);
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
  // check as a red workflow. What it must not do is stay the last word:
  // `agentic-ci-failure.yml` reacts to the same event with the opposite
  // conclusion — see the block below.
  it('skips the sweep when CI failed', () => {
    expect(sweep).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('stays off a clock', () => {
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('cron:');
  });
});

// PR #615 merged with its `full-ci` interaction-mode job silently skipped:
// the label was applied via a separate API call after `pull_request: opened`
// had already fired, and default `pull_request` types are
// [opened, synchronize, reopened] -- not `labeled`. Both `shard-config` and
// `scenario-interaction` evaluated their `if: contains(...'full-ci')` guard
// against a PR that had no labels yet, reported `skipped` rather than
// `failure`, and the run still concluded `success`. PR #616 only got its
// shards from 30 unrelated follow-up pushes after the label landed --
// `synchronize` was already in the list, `labeled` was not. Mirrors the same
// fix already proven for `auto-assign-next.yml`'s READY TO MERGE marker
// above. `labeled` fires the same on a draft PR and its check run attaches
// to the head SHA, so no separate `ready_for_review` type is needed to cover
// a label applied before a PR goes ready.
describe('ci.yml re-evaluates full-ci/build-check when the label lands', () => {
  it('includes labeled alongside the defaults', () => {
    const ci = workflow('ci.yml');
    const types = /pull_request:[\s\S]*?types:\s*\[([^\]]+)\]/.exec(ci)?.[1] ?? '';
    for (const type of ['opened', 'synchronize', 'reopened', 'labeled']) {
      expect(types, `ci.yml's pull_request trigger is missing \`${type}\``).toContain(type);
    }
  });
});

// The third ending nothing owned: the PR opened, marked, and its CI came back
// red. `agentic-auto-merge.yml` declines a failed CI run, no merge fires so
// `auto-assign-next.yml` never chains, the watchdog skips any issue with a
// linked PR, and the session that could have read the verdict exited minutes
// before it arrived. PR #581 held issue #552 and the whole queue that way.
describe('a red CI on a pipeline PR is handed back to the agent', () => {
  const failsafe = workflow('agentic-ci-failure.yml');
  const triggers = failsafe.slice(failsafe.indexOf('\non:'), failsafe.indexOf('\npermissions:'));

  it('reacts to the same CI-completion event auto-merge reacts to', () => {
    expect(triggers).toMatch(/workflow_run:\s*\n\s*workflows:\s*\["CI"\]/);
    expect(triggers).toMatch(/types:\s*\[completed\]/);
  });

  it('fires on the failure auto-merge declines, and on nothing else', () => {
    expect(failsafe).toContain("github.event.workflow_run.conclusion == 'failure'");
  });

  it('stays off a clock of its own', () => {
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('cron:');
  });

  // CI failing on `main`, on a human's branch, or on a harness branch summons
  // nobody. The pipeline's own branch is the entire scope.
  it('acts only on the pipeline\'s own feature branch', () => {
    const pattern = /const PIPELINE_HEAD = (\/\^pipeline.*?\/);/.exec(failsafe);
    expect(pattern, 'PIPELINE_HEAD not found in the fail-safe').toBeTruthy();
    const head = new RegExp(pattern[1].slice(1, -1));
    expect(head.test('main')).toBe(false);
    expect(head.test('pipeline/tests-769-32908623869')).toBe(false);
    expect(head.test('feature/something')).toBe(false);
  });

  // The bug that made the whole fail-safe dead code: anchored `-(\d+)$`, it
  // matched `pipeline/feature-769` and nothing a run actually pushes. Every
  // branch has carried `<issue>-<runId>` since #554, so no red pipeline PR was
  // ever handed back — PR #773's reached a human instead.
  it('matches the run-id-suffixed heads real runs produce, and reads the issue from both', () => {
    const pattern = /const PIPELINE_HEAD = (\/\^pipeline.*?\/);/.exec(failsafe);
    const head = new RegExp(pattern[1].slice(1, -1));
    expect(head.exec('pipeline/feature-769-32908623869')?.[1]).toBe('769');
    expect(head.exec('pipeline/feature-769')?.[1]).toBe('769');
  });

  // PR #773 again, from the other side: `ci.yml` green, the head red on a
  // workflow this lookup did not name. A failing run blocks the merge whichever
  // file emitted it, so the fail-safe reads channels, not one path.
  it('evaluates every channel on the head rather than ci.yml alone', () => {
    expect(failsafe).not.toContain("run.path === '.github/workflows/ci.yml'");
    expect(failsafe).toContain('MACHINERY.has(run.path)');
    expect(failsafe).toContain('latestPerWorkflow');
  });

  // Under GITHUB_TOKEN the comment is authored by `github-actions[bot]` and both
  // runners filter `comment.user.type != 'Bot'` — the trigger would be written
  // and never read.
  it('comments with the PAT, so a runner actually answers', () => {
    expect(failsafe).toContain('github-token: ${{ secrets.PAT_TOKEN_COPILOT_AUTOMATION }}');
    expect(failsafe).not.toContain('github-token: ${{ secrets.GITHUB_TOKEN }}');
  });

  // The one comment besides the assignment comment that is allowed a mention,
  // and it is useless without one.
  it('carries the configured agent mention', () => {
    expect(failsafe).toContain('AGENTIC_AGENT: ${{ vars.AGENTIC_AGENT }}');
    expect(failsafe).toContain('const mention = `@${configured}`');
    expect(failsafe).toContain('${mention} — CI is red');
  });

  // The guard that keeps the fail-safe from fighting `[await-ci]`: a live
  // session is already waiting on this verdict, and a second comment would queue
  // a second runner onto one branch.
  it('declines while any agent session is live', () => {
    expect(failsafe).toContain("const RUNNERS = ['claude-runner.yml', 'opencode-runner.yml']");
    for (const status of ['queued', 'in_progress']) {
      expect(failsafe).toContain(`'${status}'`);
    }
    expect(failsafe).toContain('listWorkflowRuns');
  });

  it('leaves a draft alone — its channel was already reported red', () => {
    expect(failsafe).toContain('if (pr.draft)');
  });

  // The live-session guard below can only see the two runner workflows, so a
  // session driven from the web app, the desktop app, or a human terminal is
  // invisible to it and would get a second worker pushed onto its branch.
  // "Is a human working on this" is not observable from the Actions API, so it
  // is declared rather than detected.
  it('honours a hands-off label for work no guard can detect', () => {
    expect(failsafe).toContain("const HOLD_LABEL = 'ci-fix-hold'");
    expect(failsafe).toContain('labels.includes(HOLD_LABEL)');
    // Checked before the handback is composed, not after.
    const hold = failsafe.indexOf('HOLD_LABEL');
    expect(hold).toBeLessThan(failsafe.indexOf('const MARKER'));
  });

  // A run reporting on a commit that is no longer the head has already been
  // answered by whatever pushed the fix.
  it('ignores a verdict superseded by a newer push', () => {
    expect(failsafe).toContain('pr.head.sha !== reported');
  });

  // Repeated question versus new one is decided on *event identity*, never on a
  // duration. A workflow run has an id and a redelivered webhook carries the same
  // one, so the `workflow_run` path answers each CI run exactly once.
  it('answers each CI run once, identified by its run id', () => {
    expect(failsafe).toContain("const MARKER = '<!-- agentic-ci-failure -->'");
    expect(failsafe).toContain('`run:${ciRunId}`');
    expect(failsafe).toContain('if (askedAboutThisRun && !dispatchedLookup)');
    expect(failsafe).toContain('run:${ciRunId}`');
  });

  // The clock-free retry. A session that took the handback and died before
  // pushing leaves the head — and therefore the run id — unchanged, so a
  // permanent per-run skip would strand the PR with attempts still unspent. A
  // dispatch bypasses the dedup and counts against the limit, so the retry is
  // bounded by the brake instead of by a guessed interval.
  it('lets a re-raise ask again about a run whose session produced nothing', () => {
    const retry = failsafe.slice(failsafe.indexOf('if (askedAboutThisRun && !dispatchedLookup)'));
    expect(retry).toContain('that attempt produced nothing. Asking again.');
    expect(retry).toContain('nudges.length >= limit');
  });

  // A cooldown long enough for today's CI is a stall tomorrow, and one short
  // enough for tomorrow double-asks today. There is no interval to get wrong.
  it('holds no clock at all', () => {
    expect(failsafe).not.toContain('Date.now');
    expect(failsafe).not.toContain('Date.parse');
    expect(failsafe).not.toContain('setTimeout');
    expect(failsafe).not.toMatch(/COOLDOWN|_MINUTES|ageMinutes/);
    expect(failsafe).not.toMatch(/^\s*(run:\s*)?sleep\s/m);
  });

  // Naming the jobs and their log URLs is the difference between a fix and a
  // re-diagnosis paid for out of the next session's budget.
  it('names the failing jobs in the handback', () => {
    expect(failsafe).toContain('listJobsForWorkflowRun');
    expect(failsafe).toContain('job.html_url');
  });

  // A CI failure that is not converging must not become a new way to stall the
  // queue: the brake ends in the same terminal shape as every other failure.
  it('bounds the attempts and parks the PR when the limit is spent', () => {
    expect(failsafe).toContain('ATTEMPT_LIMIT: ${{ vars.AGENTIC_CI_FIX_ATTEMPT_LIMIT }}');
    expect(failsafe).toContain('nudges.length >= limit');
    expect(failsafe).toContain('convertPullRequestToDraft');
    expect(failsafe).toMatch(/labels: \['blocked'\]/);
    expect(failsafe).toContain("name: 'in-progress'");
  });

  it('falls back to a default limit rather than disabling the brake', () => {
    expect(failsafe).toContain('Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 3');
  });
});

// "Nothing assigned" is written by two opposite states: a queue that was read
// and holds nothing eligible, and a queue that could not be read at all. On
// 17 Aug 2026 the second one was reported as the first — three dispatches of
// `agentic-trigger.yml`, every ready issue skipped on a 503 from the closing-PR
// read, three green runs, and issue #554 waiting on a success that never
// happened. A green Actions row is the only thing a human sees of this step.
describe('an unread queue is reported as a failure', () => {
  const assign = readFileSync(join(ROOT, '.github/actions/agentic-assign/action.yml'), 'utf8');

  it('fails the step when every candidate was skipped on an unreadable fact', () => {
    expect(assign).toMatch(/if \(unreadable && unreadable\.length > 0\) \{\s*\n\s*core\.setFailed\(/);
  });

  // The rules have to hand the step that distinction, or it has nothing to fail
  // on: a refusal carries whether the fact behind it was read or missing.
  it('distinguishes an unreadable refusal from an ineligible one', () => {
    const rules = readFileSync(join(ROOT, '.github/scripts/assignability.cjs'), 'utf8');
    expect(rules).toContain('const no = (reason, unreadable = false)');
    expect(rules).toContain('if (verdict.unreadable) unreadable.push(');
  });

  // The other half: one degraded API surface must not be able to park the queue
  // in the first place. The closing-PR read retries, then falls back to REST.
  it('retries a transient read and falls back rather than parking the queue', () => {
    const api = readFileSync(join(ROOT, '.github/scripts/issue-api.cjs'), 'utf8');
    expect(api).toContain('TRANSIENT_STATUSES');
    expect(api).toContain('closing pull requests could not be read from GraphQL');
    expect(api).toContain('closing = await closersFromTimeline(number)');
  });
});

// Two runs on one issue used to build the same three branch names. #554 spent
// two six-hour budgets on that: run 160 timed out and its `pipeline/feature-554`
// was rescued into PR #603, closed unmerged, branch left behind; run 166 built
// `pipeline/feature-554` again from `main`, and its rescue push was refused
// `non-fast-forward` with 94 files of finished work on it. A branch that carries
// the run that built it cannot be contended for at all.
describe('a work branch belongs to exactly one run', () => {
  const prompt = readFileSync(join(ROOT, '.github/actions/agentic-prompt/action.yml'), 'utf8');

  it('names this run\'s branches in the prompt the runner hands the agent', () => {
    expect(prompt).toContain("const suffix = (issue ? issue + '-' : '') + context.runId;");
    expect(prompt).toContain("'- `pipeline/tests-' + suffix");
    expect(prompt).toContain("'- `pipeline/impl-' + suffix");
    expect(prompt).toContain("const featureBranch = 'pipeline/feature-' + suffix;");
    expect(prompt).toContain('Never reuse a branch from a previous run');
  });

  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s hands that exact branch to rescue and to auto-merge',
    (name) => {
      const text = workflow(name);
      expect(text).toContain('branch: ${{ steps.context.outputs.feature_branch }}');
      expect(text).toContain('head: ${{ steps.context.outputs.feature_branch }}');
    }
  );

  // The rescue is the step that pays for a collision, so it resolves the branch
  // rather than assuming one: the name the runner passed, else whatever of that
  // family this VM actually built.
  it('rescues the branch this run built, by name or by discovery', () => {
    const rescue = readFileSync(join(ROOT, '.github/actions/agentic-rescue/action.yml'), 'utf8');
    expect(rescue).toContain('EXPECTED_BRANCH');
    expect(rescue).toContain('refs/heads/pipeline/feature-${ISSUE}-*');
    // Never force: with a unique name there is nothing to overwrite, and a
    // force-push is how a rescue could destroy the branch it came to save.
    expect(rescue).not.toMatch(/git push[^\n]*--force/);
  });

  // Everything that matches a branch has to see the family, or an in-flight run
  // becomes invisible to the queue the moment its branch carries a run id.
  it.each([
    '.github/workflows/agentic-watchdog.yml',
    '.github/actions/agentic-run-state/action.yml',
  ])('%s matches the whole family', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).toContain('listMatchingRefs');
    expect(text).toContain('pipeline/feature-${issueNumber}(?:-[A-Za-z0-9._-]+)?$');
  });

  it('shares one family predicate with the assignment rules', () => {
    const api = readFileSync(join(ROOT, '.github/scripts/issue-api.cjs'), 'utf8');
    expect(api).toContain('pipelineHeadPattern');
    expect(api).toContain('listMatchingRefs');
  });
});

// Only two comments in the system may carry a mention, and both are written by
// a workflow rather than by a session. Anything else that comments would wake a
// run nobody asked for.
describe('what may carry an agent mention', () => {
  it.each(['agentic-watchdog.yml', 'agentic-auto-merge.yml', 'agentic-intake.yml', 'auto-assign-next.yml'])(
    '%s carries none',
    (name) => {
      const text = workflow(name);
      expect(text).not.toContain('@claude');
      expect(text).not.toContain('@opencode');
    }
  );

  it.each([
    ['.github/actions/agentic-assign/action.yml', 'the assignment comment'],
    ['.github/workflows/agentic-ci-failure.yml', 'the CI handback'],
  ])('%s carries one, and it is %s', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    expect(text).toMatch(/@\$\{configured\}|mention/);
  });
});

// The watchdog's linked-PR skip is what made #581 invisible: a PR means the run
// produced something, so the issue is left alone — including when the PR's CI is
// red and no session is left to read it. The fail-safe covers that on the CI
// event; this sweep covers the case where the fail-safe declined because a
// session was live, and the case of a dropped webhook.
// PR #773's ending, made impossible. The sweep already refused to merge it —
// it reads every run on the head and a failing `closing-keyword-guard` made the
// verdict `stuck` — and then said so only by failing its own job, which is
// announced to nobody. `agentic-ci-failure.yml` is the thing that hands a red PR
// back to an agent, and nothing was calling it for a red that was not `ci.yml`'s.
describe('auto-merge hands back what it refuses to merge', () => {
  const autoMerge = workflow('agentic-auto-merge.yml');
  const handback = autoMerge.slice(autoMerge.indexOf('- name: Hand an unmergeable marked PR back'));

  it('dispatches the fail-safe for every marked PR it could not arm', () => {
    expect(handback).toContain('createWorkflowDispatch');
    expect(handback).toContain("workflow_id: 'agentic-ci-failure.yml'");
    expect(handback).toContain('steps.merge.outputs.unarmed');
  });

  // The sweep calls `core.setFailed` on exactly these PRs, so a step without
  // `always()` would never run on the case it exists for.
  it('runs even though the sweep step failed', () => {
    expect(handback).toMatch(/if: always\(\) && steps\.merge\.outputs\.unarmed != ''/);
  });

  // A dispatch that raises no event wakes nobody — the same reason every other
  // event-raising step in this tree carries the PAT.
  it('dispatches with the PAT', () => {
    expect(handback).toContain('github-token: ${{ secrets.PAT_TOKEN_COPILOT_AUTOMATION }}');
  });

  // It decides nothing: the fail-safe re-applies its own guards, so a failed
  // dispatch is a lost fast path, not a lost report — the watchdog re-raises.
  it('never fails the job on the dispatch itself', () => {
    expect(handback).toContain('core.warning');
    expect(handback).not.toContain('core.setFailed');
  });
});

// The one list that decides, in three places, whether a workflow run on a PR
// head is a channel or the merge machinery. `scripts/await-pr-ci.ts` decides
// whether a run may end on it, the fail-safe whether to hand it back, the
// watchdog whether to re-raise it — and a copy that drifts reintroduces #773
// in whichever reader drifted. Inline in the two workflows because neither job
// checks out the repository.
describe('the machinery list is one list, in three copies', () => {
  const MACHINERY = [
    'agentic-auto-merge.yml',
    'agentic-ci-failure.yml',
    'agentic-intake.yml',
    'agentic-trigger.yml',
    'agentic-watchdog.yml',
    'auto-assign-next.yml',
    'claude-runner.yml',
    'handle-failure.yml',
    'opencode-runner.yml',
  ];

  // The guard is the workflow that proved a prefix rule fails open: it named
  // itself `agentic-` and exempted itself from every reader at once.
  it.each([
    ['scripts/lib/workflow-verdict.ts', 'const MACHINERY_WORKFLOWS'],
    ['.github/workflows/agentic-ci-failure.yml', 'const MACHINERY = new Set(['],
    ['.github/workflows/agentic-watchdog.yml', 'const MACHINERY = new Set(['],
  ])('%s lists the same set, and never the closing-keyword guard', (path, marker) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    const start = text.indexOf(marker);
    expect(start, `${marker} not found in ${path}`).toBeGreaterThan(-1);
    const block = text.slice(start, text.indexOf(']', start));
    const listed = [...block.matchAll(/'(?:\.github\/workflows\/)?([\w.-]+\.yml)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...MACHINERY].sort());
  });
});

describe('the watchdog re-raises a red CI it would otherwise skip', () => {
  const watchdog = workflow('agentic-watchdog.yml');

  // Every guard — is a session live, was this commit already asked about, is the
  // attempt limit spent — stays in the fail-safe, decided once on current state.
  // A sweep that commented itself would be a second opinion drifting from the
  // first, and it would carry a mention on a schedule.
  const reRaise = watchdog.slice(watchdog.indexOf('- name: Re-raise a red CI'));

  it('dispatches the fail-safe instead of deciding anything itself', () => {
    expect(reRaise).toContain('createWorkflowDispatch');
    expect(reRaise).toContain("workflow_id: 'agentic-ci-failure.yml'");
    expect(reRaise).not.toContain('createComment');
    expect(reRaise).not.toContain('addLabels');
  });

  it('still assigns nothing', () => {
    expect(watchdog).not.toContain(ASSIGN_ACTION);
  });

  it('needs the scope a dispatch requires', () => {
    expect(watchdog.slice(0, watchdog.indexOf('jobs:'))).toMatch(/actions: write/);
  });

  it('scopes the sweep to non-draft pipeline PRs with a red channel on the head', () => {
    expect(watchdog).toMatch(/PIPELINE_HEAD\.test\(pr\.head\?\.ref \|\| ''\) \|\| pr\.draft/);
    expect(watchdog).toContain("run.status === 'completed' && RUN_FAILURES.includes(run.conclusion)");
  });

  // PR #773: `ci.yml` was green and the head still carried a failing
  // `closing-keyword-guard` run, so a sweep that looked up one workflow by path
  // saw nothing to re-raise. What blocks a merge is a failing run, whichever
  // workflow emitted it.
  it('reads every channel on the head, not just ci.yml', () => {
    expect(reRaise).not.toContain("'.github/workflows/ci.yml'");
    expect(reRaise).toContain('MACHINERY.has(run.path)');
  });

  // Since #554 every branch a run creates carries its own run id, so a pattern
  // anchored without the suffix matched no real pipeline head and swept nothing.
  it('matches the run-id-suffixed heads real runs produce', () => {
    const pattern = /const PIPELINE_HEAD = (\/\^pipeline.*?\/);/.exec(watchdog);
    expect(pattern, 'PIPELINE_HEAD not found in the watchdog').toBeTruthy();
    const head = new RegExp(pattern[1].slice(1, -1));
    expect(head.test('pipeline/feature-769-32908623869')).toBe(true);
    expect(head.test('pipeline/feature-769')).toBe(true);
    expect(head.test('main')).toBe(false);
    expect(head.test('pipeline/tests-769-32908623869')).toBe(false);
  });
});

// Rule 1 of `agentic-workflow-edition`, made executable. Every interval this
// layer ever held was tuned to the CI of that week and broke when a shard count
// moved: auto-merge's 10-minute settle poll called PR #499 stuck with 35 minutes
// of `full-ci` left to run, and a 45-minute wait budget in `await-pr-ci` would
// have reported "still running" as an outcome — #581's ending exactly.
//
// So a clock in this layer is allowlisted, one entry per file, with the reason it
// is not a verdict. A sixth kind fails here and has to argue for itself in the
// skill before it can be added.
describe('no verdict in the Actions layer is decided on a duration', () => {
  // Written to match the shapes a duration takes, not every mention of time: a
  // comment explaining why something is *not* timed must stay writable.
  const CLOCKS = /(Date\.now|Date\.parse|setTimeout|setInterval|^\s*(run:\s*)?sleep\s|_MINUTES|_MS\b|cooldown|COOLDOWN)/;

  /**
   * Files that legitimately read a clock, and the category that makes each one a
   * cadence, a bound or a comparison rather than an answer about the work.
   * `agentic-workflow-edition` holds the full argument for every entry.
   */
  const ALLOWED: Record<string, string> = {
    // Poll cadence (cron) + the clamped last-resort floor that only fires on a
    // run which left no other trace, and cannot reach a live one.
    '.github/workflows/agentic-watchdog.yml': 'cadence + clamped stall floor',
    // The runner's own hard clock: is there job budget left for another attempt.
    '.github/actions/agentic-run-state/action.yml': 'job budget for a retry',
    // Backoff between retries of a failed push. The verdict is the push result.
    '.github/actions/agentic-rescue/action.yml': 'network backoff',
    // Ordering of two events, plus the backoff between retries of a failed
    // read — the verdict is the read's own result, never how long it took.
    '.github/scripts/issue-api.cjs': 'event ordering + network backoff',
    '.github/scripts/assignability.cjs': 'event ordering + brake anchor',
  };

  const AGENTIC_FILES = [
    ...readdirSync(join(ROOT, '.github/workflows'))
      .filter((name) => /^(agentic-|auto-assign-next|handle-failure)/.test(name))
      .map((name) => `.github/workflows/${name}`),
    ...readdirSync(join(ROOT, '.github/actions'))
      .map((name) => `.github/actions/${name}/action.yml`),
    ...readdirSync(join(ROOT, '.github/scripts'))
      .filter((name) => name.endsWith('.cjs'))
      .map((name) => `.github/scripts/${name}`),
  ];

  it('covers every workflow, action and decision module in the layer', () => {
    expect(AGENTIC_FILES).toContain('.github/workflows/agentic-ci-failure.yml');
    expect(AGENTIC_FILES).toContain('.github/actions/agentic-auto-merge/action.yml');
    expect(AGENTIC_FILES).toContain('.github/scripts/assignability.cjs');
  });

  it.each(AGENTIC_FILES)('%s holds no clock outside the allowlist', (file) => {
    // Comments carry the reasoning about why something is not timed, and that
    // prose must not be what fails the test — only executable lines count.
    const code = readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('//') && !trimmed.startsWith('*');
      })
      .filter((line) => CLOCKS.test(line));

    if (ALLOWED[file]) {
      expect(code.length, `${file} is allowlisted for ${ALLOWED[file]} but now reads no clock — drop the entry`)
        .toBeGreaterThan(0);
      return;
    }

    expect(
      code,
      `${file} decides on a duration. Reach for an event, an identity, readable state, or a counter ` +
      'with a brake — see the `agentic-workflow-edition` skill. If it genuinely is a cadence, a ' +
      'backoff, an ordering comparison or the job budget, add it to ALLOWED with that reason.'
    ).toEqual([]);
  });

  // The fail-safe is the newest member of the layer and the one whose first cut
  // held a cooldown. Pinned by name so a revert cannot slip past the sweep above.
  it('keeps the CI fail-safe clock-free by name', () => {
    expect(ALLOWED).not.toHaveProperty('.github/workflows/agentic-ci-failure.yml');
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

// PRs #507 and #508 were opened non-draft, verified on every channel this
// session could run, and left unmarked — each body promising `READY TO MERGE`
// "once the full-ci jobs report". No step anywhere writes it later. Selection
// here needs the marker, `auto-assign-next` chains from a merge that never
// happens, and the watchdog leaves alone any issue that has a linked PR, so
// issue #504 held `in-progress` with every assignment behind it waiting on a
// human noticing. A pipeline PR ships marked or is a draft naming what stopped
// it; the third state is the one nothing in the loop can resolve.
describe('a pipeline PR that is neither marked nor draft', () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );

  const pattern = /const PIPELINE_HEAD = (\/.+\/);/.exec(source)?.[1] ?? '';
  const pipelineHead = new Function(`return ${pattern};`)() as RegExp;

  // A work branch carries the run that built it — `pipeline/feature-<N>-<runId>`
  // — so no two runs on one issue contend for a name (#554 lost six hours to
  // exactly that collision). Both forms are the pipeline's own branch here: the
  // bare one for everything opened before the convention, the suffixed one for
  // everything after.
  it('recognises the branch the assignment told the run to build', () => {
    expect(pattern, 'PIPELINE_HEAD is gone').not.toBe('');
    expect(pipelineHead.test('pipeline/feature-504')).toBe(true);
    expect(pipelineHead.test('pipeline/feature-1')).toBe(true);
    expect(pipelineHead.test('pipeline/feature-504-18273645')).toBe(true);
    expect(pipelineHead.test('pipeline/feature-504-local-9f2c1ab8')).toBe(true);
  });

  // The guard says "the pipeline opened this and did not finish the sentence".
  // Anything else non-draft and unmarked is somebody's work in progress, which
  // is a normal thing for a PR to be and not this action's business.
  it.each([
    'main',
    'pipeline/tests-504',
    'pipeline/impl-504',
    'pipeline/scratch-504-abc',
    'claude/agentic-github-action-issues-4dtero',
    'pipeline/feature-504x',
  ])('leaves `%s` alone', (ref) => {
    expect(pipelineHead.test(ref)).toBe(false);
  });

  it('collects such a PR instead of skipping it silently', () => {
    const skip = source.slice(
      source.indexOf('if (!carriesMergeMarker(summary.body))'),
      source.indexOf('core.info(`#${n}: marked READY TO MERGE')
    );
    expect(skip).toContain('PIPELINE_HEAD.test(');
    expect(skip).toContain('unmarked.push(n)');
  });

  // Same reasoning as `unarmed`: nothing else is watching, so a warning in a
  // log nobody reads is the same as saying nothing at all.
  it('fails the step rather than passing with a warning', () => {
    expect(source).toContain("core.setOutput('unmarked'");
    expect(source).toMatch(/if \(unmarked\.length > 0\) \{\s*\n\s*core\.setFailed\(/);
  });

  // A PR the run deliberately opened as a draft already says what stopped it,
  // and the draft check must stay ahead of this one or every draft trips it.
  it('checks draft before it checks the marker', () => {
    expect(source.indexOf('if (summary.draft)')).toBeLessThan(
      source.indexOf('if (!carriesMergeMarker(summary.body))')
    );
  });
});

// An unattended session gets one turn. When it ends the process exits, so any
// result the run arranged to collect "later" — a backgrounded sub-agent, a
// backgrounded shell command, a task notification — is never collected, and
// everything not yet pushed dies with the runner VM.
//
// `require-foreground-agents.sh` closed this for delegation after #404 and #406.
// It came back through the shell and cost three runs in four days, all rescued
// as draft PRs nobody asked for:
//
//   #604  "Scenario verification is running in the background — pausing here
//         until it reports back."  3h11m and $30.55 of finished TDD work gone,
//         and the retry repeated it inside 2m51s.
//   #594  "Waiting for the background vitest run — will be notified
//         automatically."  Both attempts.
//   #603  Polled `ps -p` in 280s slices 40+ times instead, spending the whole
//         360-minute job budget without finishing, then died on the job clock.
//
// Three layers hold it now and each fails differently: a hook on what may be
// started, a hook on whether the turn may end, and the runner prompt that tells
// the session the rule before it has to be enforced. These pin all three.
describe('a run cannot end waiting on work that reports after the turn', () => {
  const settings = JSON.parse(
    readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')
  ) as {
    hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]>;
  };

  const registered = (event: string, script: string) =>
    (settings.hooks?.[event] ?? []).filter((entry) =>
      (entry.hooks ?? []).some((hook) => (hook.command ?? '').endsWith(script))
    );

  // In settings.json, never in agent frontmatter: a frontmatter hook registers
  // only for an agent started through the `Agent` tool, and `/agentic-run`
  // forks into the orchestrator without one. That is how the delegation guard
  // sat inert while #406 died 58 seconds in.
  it('blocks a backgrounded Bash call, from settings.json', () => {
    const entries = registered('PreToolUse', 'require-foreground-bash.sh');
    expect(
      entries.length,
      'require-foreground-bash.sh is not a PreToolUse hook — a backgrounded command ' +
      'reports on a turn that never comes'
    ).toBeGreaterThan(0);
    expect(entries.some((entry) => /(^|\|)Bash(\||$)/.test(entry.matcher ?? ''))).toBe(true);
  });

  // Stop is the only guard that acts at the moment the work is actually lost,
  // and SubagentStop matters just as much: a specialist is what runs
  // `npm run scenarios`, so its own turn can end on an unfinished handle.
  it.each(['Stop', 'SubagentStop'])('refuses to end a %s with a long run unfinished', (event) => {
    expect(
      registered(event, 'require-settled-turn.sh').length,
      `require-settled-turn.sh is not registered on ${event}`
    ).toBeGreaterThan(0);
  });

  it('keeps the delegation guard that closed #404 and #406', () => {
    expect(registered('PreToolUse', 'require-foreground-agents.sh').length).toBeGreaterThan(0);
  });

  // The warning used to be the retry's alone. The first attempt is the one
  // holding the whole 360-minute budget — by the time #604's retry read it,
  // there were three minutes left, and it made the same move again.
  it('warns the first attempt, not only the retry', () => {
    const runner = workflow('claude-runner.yml');
    const first = runner.slice(
      runner.indexOf('- name: Run Claude Code'),
      runner.indexOf('- name: Did the run settle its issue?')
    );
    expect(first).toContain('THIS SESSION GETS ONE TURN');
    expect(first).toContain('npm run long -- wait');
  });

  it('tells the retry the same rule', () => {
    const runner = workflow('claude-runner.yml');
    const retry = runner.slice(runner.indexOf('- name: Retry the run when the first attempt'));
    expect(retry).toContain('there is no later turn');
    expect(retry).toContain('npm run long -- wait');
  });
});
