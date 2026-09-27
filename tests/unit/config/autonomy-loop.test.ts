// BlastSimulator2026 — Autonomy loop wiring
// A filed issue is eligible for the pipeline, never a start signal for it. A
// run begins in exactly four ways — a human dispatching `agentic-trigger.yml`,
// a merged pipeline pull request chaining to the next `ready` issue, a run that
// ended `blocked` or `paused` chaining past itself, or a run that closed its own
// issue `done` because its deliverable was never a diff — and from there every
// step to the merge is a workflow reacting to an event.
//
// The fourth was missing for the whole life of the pipeline, and the count in
// this comment is why it stayed missing: three of the four terminal states had a
// workflow subscribed to them, the fourth had none, and every document in the
// tree agreed there were only three ways in. See
// `agentic-chain-on-close.yml`'s own header for the run it cost.
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
import { registeredHooks, runHook, type HookRegistry } from '../../helpers/claudeHooks';
import { evaluateExpression, evaluateTemplate } from '../../helpers/actionsExpression';

const require = createRequire(import.meta.url);

/** The github-script body that follows the step named `step`, de-indented, and nothing after it. */
function scriptAfter(text: string, step: string): string {
  const from = text.indexOf('script: |\n', text.indexOf(step)) + 'script: |\n'.length;
  const lines: string[] = [];
  for (const line of text.slice(from).split('\n')) {
    if (line.trim() !== '' && !line.startsWith(' '.repeat(12))) break;
    lines.push(line.replace(/^ {12}/, ''));
  }
  return lines.join('\n');
}

const ROOT = join(import.meta.dirname, '../../..');
const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github/workflows', name), 'utf8');

const ASSIGN_ACTION = 'uses: ./.github/actions/agentic-assign';
const AUTO_MERGE_ACTION = 'uses: ./.github/actions/agentic-auto-merge';

/** The only four workflows allowed to put an issue in front of an agent. */
const ASSIGNING_WORKFLOWS = [
  'auto-assign-next.yml',
  'agentic-trigger.yml',
  'handle-failure.yml',
  'agentic-chain-on-close.yml',
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
  it('opens exactly four ways in', () => {
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
  //
  // Intake does react to labels now — to keep `ready` honest — so what is
  // pinned is that nothing it does can start anything: it never assigns, it
  // writes only with GITHUB_TOKEN (which raises no event), and it never puts
  // `ready` on an issue, only takes it off.
  it('starts nothing when an issue is filed or labelled', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).not.toContain(ASSIGN_ACTION);
    expect(intake).not.toMatch(/\n {2}assign:/);
    expect(intake).not.toContain('PAT_TOKEN_COPILOT_AUTOMATION');
    expect(intake).toContain('github-token: ${{ secrets.GITHUB_TOKEN }}');
    expect(intake).not.toMatch(/addLabels\([^)]*rules\.READY/);
    expect(intake).not.toContain('@claude');
    expect(intake).not.toContain('@opencode');
  });

  // Every lifecycle label a run reaches for has to exist before it reaches for
  // it. `paused` is the one that also goes on pull requests, where
  // `assignability.cjs` reads it as a handover rather than a collision — an
  // undefined label there means a paused run's issue is unassignable to
  // everyone until somebody notices.
  it('keeps every lifecycle label a run applies defined', () => {
    const intake = workflow('agentic-intake.yml');
    for (const name of ['AGENT_TASK', 'READY', 'IN_PROGRESS', 'BLOCKED', 'PAUSED', 'DONE']) {
      expect(intake, name).toContain(`{ name: rules.${name},`);
    }
  });

  // The two labels that make a promise say which definition they promise.
  it('describes `ready` and `done` by the definitions they stand for', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).toMatch(/name: rules\.READY,[^}]*Definition of Ready/);
    expect(intake).toMatch(/name: rules\.DONE,[^}]*Definition of Done/);
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
  // session from inside the runner would be the pipeline deciding to run again
  // on its own, and a runner has no view of the queue it would be restarting —
  // so the runner still assigns nothing. `agentic-chain-on-close.yml` reacts to
  // the close instead, which is where the queue and the cascade brake are
  // visible. Both halves of that have to hold: the runner must not assign, and
  // something must.
  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s releases its issue without starting the next run',
    (name) => {
      const text = workflow(name);
      expect(text).not.toContain(ASSIGN_ACTION);
    }
  );
});

// Every path into the queue fills the free slots under the same limit. An entry
// point that forgot the variable would still be safe — it falls back to one —
// but it would quietly assign less than the others, and a chain that sometimes
// fills two slots and sometimes one is a limit nobody configured.
describe('every entry point assigns under the configured parallel limit', () => {
  it.each(ASSIGNING_WORKFLOWS)('%s passes AGENTIC_MAX_PARALLEL_RUNS to the assigner', (name) => {
    const text = workflow(name);
    const block = text.slice(text.indexOf(ASSIGN_ACTION), text.indexOf(ASSIGN_ACTION) + 900);
    expect(block).toContain('max_parallel: ${{ vars.AGENTIC_MAX_PARALLEL_RUNS }}');
  });

  it.each(ASSIGNING_WORKFLOWS)('%s reads every issue the assigner picked', (name) => {
    const text = workflow(name);
    expect(text).not.toMatch(/steps\.assign\.outputs\.issue\b(?!s)/);
    expect(text).toContain('outputs.issues');
  });

  // The assignment comment is the one text every session reads first, so it
  // carries the two definitions a run is held to when it files or finishes.
  it('tells every session what ready and done promise', () => {
    const assign = readFileSync(join(ROOT, '.github/actions/agentic-assign/action.yml'), 'utf8');
    const body = assign.slice(assign.indexOf('const body = ['));
    expect(body).toContain('Definition of Ready in \\`agentic-issue-creation\\`');
    expect(body).toContain('Definition of Done in \\`agentic-autonomous-pipeline\\`');
    expect(body).toContain('\\`scope:*\\`');
  });

  // The skill that tells a run which scope labels to put on an issue it files
  // lists them for the reader; the assigner's taxonomy is the authority. A
  // label the skill names that the assigner does not know runs alone forever.
  it('documents exactly the scopes the assigner knows', () => {
    const rules = require(join(ROOT, '.github/scripts/assignability.cjs'));
    const skill = readFileSync(join(ROOT, '.claude/skills/agentic-issue-creation/SKILL.md'), 'utf8');
    const documented = [...skill.matchAll(/^\| `scope:([a-z]+)` \|/gm)].map((m) => m[1]);
    expect(documented).toEqual(Object.keys(rules.SCOPES));
  });

  // A scope label a human picks from the UI has to exist, and has to name a
  // scope the assigner knows — so intake reads the one taxonomy rather than
  // carrying its own list of names.
  it('keeps every scope label defined, from the taxonomy the assigner reads', () => {
    const intake = workflow('agentic-intake.yml');
    expect(intake).toContain('.github/scripts/assignability.cjs');
    expect(intake).toContain('for (const [scope, description] of Object.entries(rules.SCOPES))');
    expect(intake).toContain('const name = `${rules.SCOPE_PREFIX}${scope}`;');
    expect(intake.slice(0, intake.indexOf('Keep the labels honest'))).toContain('actions/checkout@v4');
    expect(intake).toMatch(/permissions:\s*\n\s*issues: write\s*\n\s*contents: read/);
  });

  // The form's Scope field is how a human filing through the UI meets the
  // Definition of Ready. Its options are the taxonomy, exactly.
  it('offers exactly the known scopes in the issue form', () => {
    const rules = require(join(ROOT, '.github/scripts/assignability.cjs'));
    const form = readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE/agent-task.yml'), 'utf8');
    const field = form.slice(form.indexOf('id: scope'), form.indexOf('id: blocked_by'));
    const options = [...field.matchAll(/^\s+- scope:([a-z]+)$/gm)].map((m) => m[1]);
    expect(options).toEqual(Object.keys(rules.SCOPES));
    expect(field).toMatch(/multiple: true/);
    expect(field).toMatch(/validations:\s*\n\s*required: true/);
  });
});

// The Definition of Ready's checkable half, kept true on the labels themselves.
// Run against a fake GitHub: the shipped intake script, every branch it has.
describe('intake keeps `ready` honest', () => {
  const intakeText = workflow('agentic-intake.yml');
  const script = scriptAfter(intakeText, 'Keep the labels honest');
  const jobIf = (() => {
    const start = intakeText.indexOf('if: >-') + 'if: >-'.length;
    return intakeText.slice(start, intakeText.indexOf('\n    runs-on:'));
  })();

  interface Run {
    labels: string[];
    comments: string[];
    created: string[];
    updated: string[];
  }

  async function intake(
    action: string,
    issue: { labels: string[]; body?: string; state?: string },
    existingLabels: { name: string; color: string; description: string | null }[] = []
  ): Promise<Run> {
    const run: Run = { labels: [...issue.labels], comments: [], created: [], updated: [] };
    const github: any = {
      rest: {
        issues: {
          listLabelsForRepo: async () => ({ data: [] }),
          createLabel: async ({ name }: { name: string }) => { run.created.push(name); },
          updateLabel: async ({ name }: { name: string }) => { run.updated.push(name); },
          addLabels: async ({ labels }: { labels: string[] }) => { run.labels.push(...labels); },
          removeLabel: async ({ name }: { name: string }) => { run.labels = run.labels.filter((l) => l !== name); },
          createComment: async ({ body }: { body: string }) => { run.comments.push(body); },
        },
      },
      paginate: async () => existingLabels,
    };
    const core = { info: () => {}, warning: () => {} };
    const context = {
      repo: { owner: 'Nico2398', repo: 'BlastSimulator2026' },
      payload: {
        action,
        issue: { number: 42, state: issue.state ?? 'open', body: issue.body ?? '', labels: issue.labels.map((name) => ({ name })) },
      },
    };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('github', 'context', 'core', 'require', 'process', script)(
      github, context, core, require, { env: { GITHUB_WORKSPACE: ROOT } }
    );
    return run;
  }

  it('reacts only to the label events that can change whether `ready` is honest', () => {
    const wakes = (action: string, label?: string) =>
      Boolean(evaluateExpression(jobIf, { github: { event: { action, label: label ? { name: label } : null } } } as never));
    expect(wakes('opened')).toBe(true);
    expect(wakes('reopened')).toBe(true);
    expect(wakes('labeled', 'ready')).toBe(true);
    expect(wakes('labeled', 'scope:ui')).toBe(true);
    expect(wakes('unlabeled', 'scope:ui')).toBe(true);
    expect(wakes('unlabeled', 'agent-task')).toBe(true);
    // The pipeline's own bookkeeping, which happens on every assignment.
    expect(wakes('labeled', 'in-progress')).toBe(false);
    expect(wakes('unlabeled', 'ready')).toBe(false);
    expect(wakes('labeled', 'blocked')).toBe(false);
    expect(wakes('labeled', 'paused')).toBe(false);
  });

  it('turns the form\'s Scope field into scope labels, and leaves the issue ready', async () => {
    const run = await intake('opened', {
      labels: ['agent-task', 'ready'],
      body: '### Context\n\nwhy\n\n### Scope\n\nscope:ui, scope:console\n\n### Blocked by\n\n_No response_\n',
    });
    expect(run.labels).toEqual(['agent-task', 'ready', 'scope:ui', 'scope:console']);
    expect(run.comments).toEqual([]);
  });

  it('reads nothing but the Scope field — a scope named in prose is not a declaration', async () => {
    const run = await intake('opened', {
      labels: ['agent-task', 'ready'],
      body: '## Context\n\nThis touches scope:ui and scope:nav code.\n',
    });
    expect(run.labels).toEqual(['agent-task']);
    expect(run.comments).toHaveLength(1);
  });

  it('takes `ready` off an issue that does not meet the Definition of Ready, and says what is missing', async () => {
    const run = await intake('labeled', { labels: ['ready', 'scope:ui'] });
    expect(run.labels).toEqual(['scope:ui']);
    expect(run.comments).toHaveLength(1);
    expect(run.comments[0]).toContain('<!-- agentic-definition-of-ready -->');
    expect(run.comments[0]).toContain('`agent-task`');
    expect(run.comments[0]).toContain('`scope:global`');
  });

  it('takes `ready` off when the last scope label comes off', async () => {
    const run = await intake('unlabeled', { labels: ['agent-task', 'ready'] });
    expect(run.labels).toEqual(['agent-task']);
  });

  it('takes `ready` off for a scope nobody knows', async () => {
    const run = await intake('labeled', { labels: ['agent-task', 'ready', 'scope:naavmesh'] });
    expect(run.labels).not.toContain('ready');
    expect(run.comments[0]).toContain('scope:naavmesh');
  });

  it('leaves an issue that meets it alone', async () => {
    const run = await intake('labeled', { labels: ['agent-task', 'ready', 'scope:nav'] });
    expect(run.labels).toEqual(['agent-task', 'ready', 'scope:nav']);
    expect(run.comments).toEqual([]);
  });

  it('never checks an issue that is not waiting in the queue', async () => {
    const run = await intake('labeled', { labels: ['agent-task', 'scope:nav'] });
    expect(run.comments).toEqual([]);
    const closed = await intake('labeled', { labels: ['ready'], state: 'closed' });
    expect(closed.labels).toEqual(['ready']);
  });

  it('drops a stale `done` from a reopened issue', async () => {
    const run = await intake('reopened', { labels: ['agent-task', 'done', 'scope:ui'] });
    expect(run.labels).toEqual(['agent-task', 'scope:ui']);
  });

  it('creates the labels that are missing and rewrites a description that drifted, nothing else', async () => {
    const rules = require(join(ROOT, '.github/scripts/assignability.cjs'));
    const run = await intake('opened', { labels: [] }, [
      { name: 'agent-task', color: '1D76DB', description: 'A task for the autonomous pipeline' },
      { name: 'ready', color: '0e8a16', description: 'Eligible for pipeline assignment' },
    ]);
    expect(run.updated).toEqual(['ready']);
    expect(run.created).toEqual(expect.arrayContaining(['in-progress', 'done']));
    expect(run.created).not.toContain('agent-task');
    // Scope labels belong to the `scope-colors` job, which paints them.
    for (const scope of Object.keys(rules.SCOPES)) expect(run.created).not.toContain(`scope:${scope}`);
  });
});

// A scope label's colour says whether a live run holds it, so the label list
// shows which areas a new issue could start in. Display only: nothing reads it.
describe('scope labels show which scopes a live run holds', () => {
  const intakeText = workflow('agentic-intake.yml');
  const job = intakeText.slice(intakeText.indexOf('\n  scope-colors:'));
  const jobIf = job.slice(job.indexOf('if: >-') + 'if: >-'.length, job.indexOf('\n    runs-on:'));
  const script = scriptAfter(job, 'Paint each scope label');
  const rules = require(join(ROOT, '.github/scripts/assignability.cjs'));

  async function paint(live: { number: number; labels: string[] }[], existing: { name: string; color: string; description: string }[] = []) {
    const writes: { name: string; color: string; created: boolean }[] = [];
    const github: any = {
      rest: {
        issues: {
          listForRepo: 'listForRepo',
          listLabelsForRepo: 'listLabelsForRepo',
          createLabel: async ({ name, color }: any) => { writes.push({ name, color, created: true }); },
          updateLabel: async ({ name, color }: any) => { writes.push({ name, color, created: false }); },
        },
      },
      paginate: async (method: string, params: any) => {
        if (method === 'listLabelsForRepo') return existing;
        expect(params).toMatchObject({ labels: 'in-progress', state: 'open' });
        return [
          ...live.map((issue) => ({ number: issue.number, labels: issue.labels.map((name) => ({ name })) })),
          { number: 999, pull_request: {}, labels: [{ name: 'in-progress' }] },
        ];
      },
    };
    const core = { info: () => {} };
    const context = { repo: { owner: 'Nico2398', repo: 'BlastSimulator2026' } };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('github', 'context', 'core', 'require', 'process', script)(
      github, context, core, require, { env: { GITHUB_WORKSPACE: ROOT } }
    );
    return Object.fromEntries(writes.map((w) => [w.name.slice('scope:'.length), w.color]));
  }

  it('repaints only on what changes what a live run holds', () => {
    const wakes = (action: string, label?: string) =>
      Boolean(evaluateExpression(jobIf, { github: { event: { action, label: label ? { name: label } : null } } } as never));
    expect(wakes('labeled', 'in-progress')).toBe(true);
    expect(wakes('unlabeled', 'in-progress')).toBe(true);
    expect(wakes('labeled', 'scope:ui')).toBe(true);
    expect(wakes('unlabeled', 'scope:ui')).toBe(true);
    expect(wakes('closed')).toBe(true);
    expect(wakes('opened')).toBe(false);
    expect(wakes('labeled', 'ready')).toBe(false);
    expect(wakes('labeled', 'blocked')).toBe(false);
  });

  it('paints a held scope and every scope clashing with it, the rest free', async () => {
    const colors = await paint([{ number: 1283, labels: ['agent-task', 'in-progress', 'scope:nav', 'scope:engine'] }]);
    expect(colors.nav).toBe('fbca04');
    expect(colors.engine).toBe('fbca04');
    // Runs alone, so it cannot start beside anything live.
    expect(colors.pipeline).toBe('fbca04');
    expect(colors.global).toBe('fbca04');
    expect(colors.ui).toBe('c5def5');
    expect(colors.scenarios).toBe('c5def5');
  });

  it('paints every scope held while an exclusive run is live', async () => {
    const colors = await paint([{ number: 1230, labels: ['in-progress', 'scope:pipeline'] }]);
    expect(Object.values(colors)).toEqual(Object.keys(rules.SCOPES).map(() => 'fbca04'));
  });

  it('frees every scope when nothing is live, and ignores pull requests', async () => {
    const colors = await paint([]);
    expect(Object.values(colors)).toEqual(Object.keys(rules.SCOPES).map(() => 'c5def5'));
  });

  it('writes nothing for a label already the right colour and description', async () => {
    const existing = Object.entries(rules.SCOPES).map(([scope, description]) => ({
      name: `scope:${scope}`, color: 'C5DEF5', description: description as string,
    }));
    expect(await paint([], existing)).toEqual({});
  });
});

// The Definition of Done's checkable half, on the path that applies `done` to a
// merged pull request's issue.
describe('the merge chain leaves a closed issue meeting the Definition of Done', () => {
  const chain = workflow('auto-assign-next.yml');
  const close = chain.slice(chain.indexOf('- name: Close the completed issue'), chain.indexOf('- name: Checkout repository'));

  const script = (() => {
    const marker = 'script: |\n';
    return close
      .slice(close.indexOf(marker) + marker.length)
      .split('\n')
      .map((line) => line.replace(/^ {12}/, ''))
      .join('\n');
  })();

  async function mergeChain(body: string, labels: Record<number, string[]>) {
    const issues = new Map(
      Object.entries(labels).map(([n, l]) => [Number(n), { state: 'open', stateReason: null as string | null, labels: [...l] }])
    );
    const outputs: Record<string, string> = {};
    const github: any = {
      rest: {
        issues: {
          update: async ({ issue_number, state, state_reason }: any) => {
            Object.assign(issues.get(issue_number)!, { state, stateReason: state_reason });
          },
          addLabels: async ({ issue_number, labels: added }: any) => {
            issues.get(issue_number)!.labels.push(...added);
          },
          removeLabel: async ({ issue_number, name }: any) => {
            const found = issues.get(issue_number)!;
            if (!found.labels.includes(name)) throw Object.assign(new Error('Label does not exist'), { status: 404 });
            found.labels = found.labels.filter((l) => l !== name);
          },
        },
      },
    };
    const core = { info: () => {}, setOutput: (key: string, value: string) => { outputs[key] = value; } };
    const context = { repo: { owner: 'Nico2398', repo: 'BlastSimulator2026' }, payload: { pull_request: { body } } };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('github', 'context', 'core', 'require', 'process', script)(
      github, context, core, require, { env: {} }
    );
    return { issues, outputs };
  }

  // 27 Sep 2026: PR #1251 closed #1200 and #1252, and only the first was
  // settled — #1252 stayed closed claiming `in-progress`.
  it('closes every issue the PR names on a line of its own, each meeting the Definition of Done', async () => {
    const { issues, outputs } = await mergeChain('Closes #1200\nCloses #1252\n\nREADY TO MERGE\n', {
      1200: ['agent-task', 'scope:nav', 'ready', 'paused'],
      1252: ['agent-task', 'scope:scenarios', 'in-progress'],
    });
    for (const n of [1200, 1252]) {
      const found = issues.get(n)!;
      expect(found).toMatchObject({ state: 'closed', stateReason: 'completed' });
      expect(found.labels).toContain('done');
      expect(found.labels).toContain('agent-task');
      for (const stale of ['in-progress', 'ready', 'blocked', 'paused']) expect(found.labels).not.toContain(stale);
    }
    expect(issues.get(1200)!.labels).toContain('scope:nav');
    expect(issues.get(1252)!.labels).toContain('scope:scenarios');
    expect(outputs.issue).toBe('1200');
  });

  it('reads a prose mention as nothing', async () => {
    const { issues } = await mergeChain('Closes #10\n\nThis also fixes #11 partially.\n', {
      10: ['agent-task', 'in-progress'],
      11: ['agent-task', 'ready'],
    });
    expect(issues.get(10)!.state).toBe('closed');
    expect(issues.get(11)).toMatchObject({ state: 'open', labels: ['agent-task', 'ready'] });
  });

  it('closes nothing, and names no finished issue, when no line names one', async () => {
    const { issues, outputs } = await mergeChain('A pull request that closes nothing.\n', { 10: ['agent-task', 'ready'] });
    expect(issues.get(10)!.state).toBe('open');
    expect(outputs.issue).toBe('');
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

// A blocked run is terminal exactly as a merge is, and a pipeline with no human
// in it has to keep moving through both. Before this, `blocked` released the
// issue and started nothing: the queue went idle until somebody dispatched the
// trigger, which on a fully autonomous repository means until somebody noticed.
describe('chaining past a run that ended blocked', () => {
  const failure = workflow('handle-failure.yml');

  it('assigns the next issue when a run ends blocked', () => {
    expect(failure).toMatch(/issues:\s*\n\s*types:\s*\[labeled, edited\]/);
    expect(failure).toContain("github.event.label.name == 'blocked'");
    expect(failure).toContain(ASSIGN_ACTION);
  });

  // Without the guard, a human labelling a backlog issue `blocked` — filing a
  // note, not ending a run — would start a session.
  it('chains only from an issue a run actually held', () => {
    expect(failure).toContain('after_blocked_run');
    expect(failure).toContain('completed_issue: ${{ github.event.issue.number }}');
  });

  // A pause declares its dependency twice — the body's `## Blocked by` section
  // and the `blocked_by` relationship — and `blockedByFor` reads the union, so
  // writing only the section holds the queue correctly and leaves the
  // authoritative source empty with nothing going red. #1090 paused that way on
  // 16 Sep 2026. The relationship is derived from the section here rather than
  // remembered alongside it, which is only true while this job stays wired.
  it('records every declared dependency as a relationship on either halt label', () => {
    expect(failure).toContain('reconcile-dependencies:');
    expect(failure).toContain('reconcile-dependencies.cjs');
    expect(failure).toContain("github.event.label.name == 'blocked'");
    expect(failure).toContain("github.event.label.name == 'paused'");
  });

  // The label and the body edit that declares a dependency are two separate API
  // calls that can land in either order. A job gated on the `labeled` webhook
  // alone can run before the body edit lands, read the section as empty, and
  // never run again — no event fires for the later edit. The job must also
  // react to the issue being edited while already carrying the halt label.
  it('also reconciles on an edit to an issue already carrying the halt label', () => {
    const job = failure.slice(failure.indexOf('reconcile-dependencies:'));
    const jobIf = job.slice(0, job.indexOf('runs-on:'));

    expect(jobIf).toContain("github.event.action == 'labeled'");
    expect(jobIf).toContain("github.event.action == 'edited'");
    expect(jobIf).toContain('github.event.changes.body');
    expect(jobIf).toContain("contains(github.event.issue.labels.*.name, 'blocked')");
    expect(jobIf).toContain("contains(github.event.issue.labels.*.name, 'paused')");
  });

  // The old single-condition shape gated the job on the label event alone,
  // which is exactly the race this job exists to close. Its replacement must
  // not still be a single `github.event.label.name == ...` condition.
  it('does not gate reconcile-dependencies on the label event alone any more', () => {
    const job = failure.slice(failure.indexOf('reconcile-dependencies:'));
    const jobIf = job.slice(0, job.indexOf('runs-on:'));

    expect(jobIf).not.toMatch(
      /^\s*if: github\.event\.label\.name == 'blocked' \|\| github\.event\.label\.name == 'paused'\s*$/m
    );
  });

  // GITHUB_TOKEN deliberately: a relationship raises no workflow event and
  // nothing listens for one, so this write must not carry the PAT that exists
  // to raise them. Pinned because "fixing" it to the PAT would look like a
  // correction.
  it('reconciles with GITHUB_TOKEN, raising nothing', () => {
    const job = failure.slice(failure.indexOf('reconcile-dependencies:'));
    expect(job).toContain('github-token: ${{ secrets.GITHUB_TOKEN }}');
    expect(job).not.toContain('PAT_TOKEN_COPILOT_AUTOMATION');
  });

  // A dependency the queue is meant to honour that exists in prose only is the
  // state this job was added to stop, so it goes red rather than logging.
  it('fails loud when a declared dependency cannot be recorded', () => {
    const job = failure.slice(failure.indexOf('reconcile-dependencies:'));
    expect(job).toContain('core.setFailed');
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

// The fourth terminal state. A run whose deliverable is an answer, a command or
// a set of filed issues rather than a diff closes its own issue and labels it
// `done` — raising no `pull_request` event for `auto-assign-next.yml`, no halt
// label for `handle-failure.yml`, and leaving no `in-progress` for the watchdog
// to sweep. Nothing was subscribed to it, so the queue simply stopped: on
// 28 Aug 2026 #807 closed `done` at 19:41:07 with 23 `ready` issues behind it
// and the pipeline ran nothing further. `agentic-assign` had carried the
// `closed_without_pr` guard for exactly this the whole time, with no caller.
describe('chaining past a run whose deliverable was not a pull request', () => {
  // Read inside each test, not at describe level: deleting the workflow should
  // fail these assertions by name, not throw during collection and report the
  // whole file as "no tests" — which reads like the suite was never written.
  const onClose = () => workflow('agentic-chain-on-close.yml');
  const action = () =>
    readFileSync(join(ROOT, '.github/actions/agentic-assign/action.yml'), 'utf8');

  /** The `closed_without_pr` guard body, sliced out of the shipped action. */
  const closedGuard = (): string => {
    const text = action();
    return text.slice(
      text.indexOf("if (guard === 'closed_without_pr')"),
      text.indexOf('// --- Guard: chain past a run that halted without merging ---')
    );
  };

  it('reacts to the issue closing, which is the only event that state raises', () => {
    const text = onClose();
    const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\nconcurrency:'));
    expect(triggers).toMatch(/issues:\s*\n\s*types:\s*\[closed\]/);
    expect(triggers).not.toContain('schedule:');
    expect(text).toContain(ASSIGN_ACTION);
  });

  it('chains under the guard written for this case', () => {
    expect(onClose()).toContain('guard: closed_without_pr');
    expect(onClose()).toContain('completed_issue: ${{ github.event.issue.number }}');
  });

  // Without the brake this path would quietly un-park a queue the brake had
  // parked: a `done` close is a success but it is not a merge, so it resets
  // nothing that `consecutiveHaltedRuns` counts.
  it('is bounded by the same cascade brake as the halt chains', () => {
    expect(onClose()).toContain('blocked_chain_limit: ${{ vars.AGENTIC_BLOCKED_CHAIN_LIMIT }}');
    const text = action();
    const brake = text.slice(text.indexOf('// --- Cascade brake ---'));
    expect(brake).toContain("if (guard !== 'none') {");
    expect(brake).toContain('rules.consecutiveHaltedRuns(api)');
  });

  // `issues: closed` fires for every issue closed in the repository. The action
  // is what keeps a human tidying up the backlog from starting a session, and it
  // uses the same test both halt guards apply.
  it('chains only from an issue a run actually held', () => {
    const guard = closedGuard();
    expect(guard).toContain('await api.everCarriedInProgress(completed)');
    expect(guard).toContain('never carried');
  });

  // The merge path already chains from a merged PR. Both would otherwise fire on
  // the same close, and the issue would be assigned twice.
  it('stands down when a pull request is carrying the chain', () => {
    const guard = closedGuard();
    expect(guard).toContain('await api.deliverableFor(completed)');
    expect(guard).toContain('the merge event carries the chain');
    // A read that failed is not an absent PR.
    expect(guard).toContain('finishedPrs.unknown');
  });

  // Same reasoning as the runners' own group: GitHub keeps one pending run per
  // concurrency group and a second arrival cancels it, so a close this job will
  // skip must never claim the shared slot on its way to finding that out.
  it('contends for the shared assignment slot only when it will act', () => {
    const text = onClose();
    const concurrency = text.slice(text.indexOf('\nconcurrency:'), text.indexOf('\npermissions:'));
    const jobIf = text.slice(text.indexOf('\n    if: >'), text.indexOf('\n    runs-on:'));
    expect(jobIf).toContain('if: >');

    // Both clauses, in both places. `agent-task` is what queued issues carry;
    // `in-progress` is what assignment applies regardless, and dropping it would
    // leave an issue assigned without `agent-task` unable to chain — this
    // workflow's own bug, reproduced on the issues it does not recognise.
    for (const clause of [
      "contains(github.event.issue.labels.*.name, 'agent-task')",
      "contains(github.event.issue.labels.*.name, 'in-progress')",
    ]) {
      expect(concurrency, `group is missing \`${clause}\``).toContain(clause);
      expect(jobIf, `job \`if:\` is missing \`${clause}\``).toContain(clause);
    }

    expect(concurrency).toContain("&& 'agentic-assignment'");
    expect(concurrency).toMatch(/format\('agentic-chain-on-close-noop-\{0\}',\s*github\.run_id\)/);
    expect(concurrency).toContain('cancel-in-progress: false');
  });

  // The group is workflow-level, so the run claims it whatever its jobs decide —
  // and it must therefore resolve from contexts that are certainly in scope
  // there. `vars` is not one this repository has ever exercised in a
  // `concurrency:` expression, and if it silently read as empty the whole
  // expression would collapse to the no-op arm on every run: this entry point
  // would stop serialising against the other three, and would report success
  // while doing it. So the enable flag gates the steps, the way
  // `handle-failure.yml` gates its own, and never the group.
  it('resolves its concurrency group without reading `vars`', () => {
    const text = onClose();
    const concurrency = text.slice(text.indexOf('\nconcurrency:'), text.indexOf('\npermissions:'));
    const group = concurrency.slice(concurrency.indexOf('group:'));
    expect(group).not.toContain('vars.');

    // The flag still has to gate the work, just further in.
    const assign = text.slice(text.indexOf(ASSIGN_ACTION) - 400, text.indexOf(ASSIGN_ACTION));
    expect(assign).toContain("if: vars.AGENTIC_AUTO_ASSIGN_ENABLED == 'true'");
  });
});

// YAML opens a comment at an unquoted ` #`, so `reason: auto-assigned after
// issue #${{ ... }} ended ${{ ... }}` parsed as `auto-assigned after issue` —
// the issue number and the outcome were gone before the action ever ran, and
// the assignment comment that quotes the reason said neither. Two workflows
// shipped that way, and nothing failed: the chain still worked, it just stopped
// explaining itself. Confirmed in run 33204199229's own log, which recorded
// `ASSIGN_REASON: auto-assigned after issue`.
describe('the assignment reason survives the YAML parser', () => {
  const WORKFLOW_DIR = join(ROOT, '.github/workflows');

  it.each(readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml')))(
    '%s quotes every reason: that interpolates an issue or PR number',
    (name) => {
      for (const [line] of workflow(name).matchAll(/^\s*reason:.*$/gm)) {
        if (!line.includes('#')) continue;
        expect(
          line.trim(),
          `${name}: \`#\` outside quotes truncates this line at the parser`
        ).toMatch(/^reason:\s*"/);
      }
    }
  );
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

    // Two shapes are allowed, and both put a run that assigns into the one
    // shared group. A workflow whose trigger only ever means "assign" names it
    // outright. One whose trigger also fires on events it will skip —
    // `issues: closed` fires for every issue in the repository — resolves to
    // that same name when it will act and to a per-run name when it will not,
    // so a no-op cannot evict a real queued assignment on its way to finding
    // out it is a no-op. What is never allowed is a third group name.
    const concurrency = text.slice(0, assign);
    expect(concurrency, `${name}: assigning job is not in the shared group`).toMatch(
      /concurrency:\s*\n(?:.*\n)*?\s*group: (?:agentic-assignment|>-)/
    );
    if (!/group: agentic-assignment/.test(concurrency)) {
      expect(concurrency, `${name}: conditional group never resolves to the shared name`).toMatch(
        /&&\s*'agentic-assignment'\s*\|\|/
      );
      expect(concurrency, `${name}: the skip arm must be unique per run`).toMatch(
        /\|\|\s*format\('[a-z-]+-noop-\{0\}',\s*github\.run_id\)/
      );
    }
    expect(concurrency).toContain('cancel-in-progress: false');
  });

  // Waking the merge gate must stay outside that group. GitHub keeps one
  // pending run per group and drops the rest, and a dropped wake-up is a PR
  // nobody looks at again.
  it('leaves the merge-gate wake-up out of the group', () => {
    const chain = workflow('auto-assign-next.yml');
    const wake = chain.slice(chain.indexOf('  wake-merge-gate:'), chain.indexOf('  chain-next-task:'));
    expect(wake).toContain('createWorkflowDispatch');
    expect(wake).not.toContain('agentic-assignment');
  });
});

// The merge gate is the one thing that merges. Before parallel runs, three
// places could merge a pipeline PR — the runner that opened it, the chain
// workflow on the PR's own events, and the CI-completion sweep — each deciding
// on one PR's head alone. That is exactly the merge that lands two
// separately-green pull requests onto a `main` no channel has run: harmless
// while one session ran at a time and nothing else moved `main`, and the
// defining hazard once several do.
describe('the merge gate is the only thing that merges', () => {
  const GATE = 'agentic-auto-merge.yml';
  const actionSource = readFileSync(join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8');

  const everyFile = [
    ...readdirSync(join(ROOT, '.github/workflows')).map((name) => `.github/workflows/${name}`),
    ...readdirSync(join(ROOT, '.github/actions')).map((name) => `.github/actions/${name}/action.yml`),
    ...readdirSync(join(ROOT, '.github/scripts')).map((name) => `.github/scripts/${name}`),
  ];

  it('calls the merge endpoint from the gate action alone', () => {
    const merging = everyFile.filter((file) =>
      /pulls\.merge\(|gh pr merge|PUT \/repos\/\{owner\}\/\{repo\}\/pulls\/\{pull_number\}\/merge/.test(
        readFileSync(join(ROOT, file), 'utf8')
      )
    );
    expect(merging).toEqual(['.github/actions/agentic-auto-merge/action.yml']);
  });

  // Native auto-merge lets GitHub merge whenever *its* requirements hold, which
  // on this repository — no required checks — would be a merge the gate never
  // judged, onto a `main` it never compared against.
  it('never switches on GitHub native auto-merge anywhere', () => {
    for (const file of everyFile) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(text, file).not.toContain('enablePullRequestAutoMerge');
      expect(text, file).not.toMatch(/gh pr merge[^\n]*--auto/);
    }
  });

  it('is reached from the gate workflow alone', () => {
    const callers = readdirSync(join(ROOT, '.github/workflows')).filter((name) =>
      workflow(name).includes(AUTO_MERGE_ACTION)
    );
    expect(callers).toEqual([GATE]);
  });

  // The lock. Job-level, because a workflow-level group is claimed before the
  // job's `if:` resolves, so a skipped run (a red CI, a noop runner run) would
  // evict a pending sweep that was going to merge — #572/#610 in another group.
  it('holds the one `agentic-merge` lock at job level, queueing rather than cancelling', () => {
    const text = workflow(GATE);
    const beforeJobs = text.slice(0, text.indexOf('\njobs:'));
    expect(beforeJobs).not.toMatch(/^concurrency:/m);
    const job = text.slice(text.indexOf('\n  gate:'));
    expect(job).toMatch(/concurrency:\s*\n\s*group: agentic-merge\s*\n\s*cancel-in-progress: false/);
  });

  it('merges with the PAT', () => {
    const text = workflow(GATE);
    const block = text.slice(text.indexOf(AUTO_MERGE_ACTION));
    const token = /token:\s*\$\{\{\s*secrets\.(\w+)\s*\}\}/.exec(block);
    expect(token?.[1]).toBe('PAT_TOKEN_COPILOT_AUTOMATION');
  });

  // Every sweep reads every open PR, so the one pending sweep GitHub keeps is
  // enough whichever one survives. A sweep scoped to one PR or one head would
  // make a dropped sweep a PR nobody looks at again.
  it('sweeps every open pull request, oldest first, and takes no scope from its caller', () => {
    expect(actionSource).toMatch(/github\.rest\.pulls\.list, \{\s*\n\s*owner, repo, state: 'open', sort: 'created', direction: 'asc', per_page: 100/);
    const inputs = actionSource.slice(actionSource.indexOf('\ninputs:'), actionSource.indexOf('\noutputs:'));
    expect(inputs).toContain('token:');
    expect(inputs).not.toMatch(/\n {2}(pr|head|merge_method):/);
  });

  // It may name the account in a log line; it must never branch on it.
  it('never selects a PR by the account that opened it', () => {
    const code = actionSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/login\s*[=!]==/);
    expect(code).not.toMatch(/['"`]github-actions/);
  });

  it.each(['claude-runner.yml', 'opencode-runner.yml'])('%s leaves merging to the gate', (name) => {
    const text = workflow(name);
    expect(text).not.toContain(AUTO_MERGE_ACTION);
    expect(text).not.toContain('Arm auto-merge');
  });

  // A marker added after CI finished raises no CI event, so the PR's own events
  // are what bring the gate back — as a dispatch, never as a merge decided on
  // one head.
  describe('auto-assign-next.yml wakes the gate on a pull request\'s own events', () => {
    const chain = workflow('auto-assign-next.yml');
    const wake = chain.slice(chain.indexOf('  wake-merge-gate:'), chain.indexOf('  chain-next-task:'));

    it('dispatches the gate, and merges nothing itself', () => {
      expect(wake).toContain('createWorkflowDispatch');
      expect(wake).toContain(`workflow_id: '${GATE}'`);
      expect(wake).not.toContain(AUTO_MERGE_ACTION);
      expect(wake).toContain('github-token: ${{ secrets.PAT_TOKEN_COPILOT_AUTOMATION }}');
    });

    it('stays out of the assignment group, and never goes red on the PR head', () => {
      expect(wake).not.toContain('agentic-assignment');
      expect(wake).toContain('continue-on-error: true');
    });

    it('only asks about a marked or pipeline pull request that is not a draft', () => {
      expect(wake).toContain("github.event.action != 'closed'");
      expect(wake).toContain('!github.event.pull_request.draft');
      expect(wake).toContain("contains(github.event.pull_request.body, 'READY TO MERGE')");
      expect(wake).toContain("startsWith(github.event.pull_request.head.ref, 'pipeline/feature-')");
    });
  });
});

// #572 and #610: `agentic-runner`'s workflow-level triggers carry no content
// filter — every comment anywhere in the repository creates a run, whether or
// not the job's own `if:` below will act on it. GitHub Actions keeps only one
// *pending* run per concurrency group, so a burst of such no-op runs (a
// session's own trailing wrap-up comment among them) could silently cancel an
// already-queued real assignment before its job ever started: zero job steps,
// nothing to retry from, and the issue stuck `in-progress` deferring every
// later assignment behind it (`selectNextAssignable` counts any `in-progress`
// issue as a live run holding a parallel-run slot).
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

      // A matching trigger resolves to its entity's serialising name;
      // anything else gets its own group keyed by this run, so it can never
      // contend for — or evict — a real queued run.
      expect(concurrency).toContain("'agentic-runner-{0}'");
      expect(concurrency).toMatch(/format\('agentic-runner-noop-\{0\}',\s*github\.run_id\)/);
      expect(concurrency).toContain('cancel-in-progress: false');
    }
  );
});

/** The `${{ }}` block that follows `key` in a workflow, as written. */
const expressionAfter = (text: string, key: string): string => {
  const at = text.indexOf(key);
  expect(at, `${key} not found`).toBeGreaterThan(-1);
  const open = text.indexOf('${{', at);
  const close = text.indexOf('}}', open);
  return text.slice(open, close + 2);
};

// Several agent sessions can be live at once (`AGENTIC_MAX_PARALLEL_RUNS`), so
// "a runner run is live" stopped meaning "this issue's run is live". Every
// liveness check — the CI fail-safe's guard, the end-of-session recovery — now
// reads *which* entity a run is working on off its `run-name`, and the runner's
// concurrency group serialises per entity rather than repo-wide. Both are
// expressions that fail in silence, so they are evaluated here against the
// event payloads GitHub actually sends, not matched as text.
describe('a runner run names the entity it works on', () => {
  const liveness = require(join(ROOT, '.github/scripts/run-liveness.cjs'));

  const cases = (mention: string) => [
    {
      what: 'an assignment comment on an issue',
      event: { event_name: 'issue_comment', run_id: 1, event: { issue: { number: 1203 }, comment: { body: `${mention} — autonomous pipeline assignment for issue #1203`, user: { type: 'User' } } } },
      entity: 'issue-1203',
    },
    {
      what: 'a CI handback on a pull request',
      event: { event_name: 'issue_comment', run_id: 2, event: { issue: { number: 1251, pull_request: { url: 'x' } }, comment: { body: `${mention} — CI is red on this pull request`, user: { type: 'User' } } } },
      entity: 'pr-1251',
    },
    {
      what: 'a review comment',
      event: { event_name: 'pull_request_review_comment', run_id: 3, event: { pull_request: { number: 1251 }, comment: { body: `please look ${mention}`, user: { type: 'User' } } } },
      entity: 'pr-1251',
    },
    {
      what: 'a dispatch naming an issue',
      event: { event_name: 'workflow_dispatch', run_id: 4, event: {} },
      inputs: { issue_number: '1200' },
      entity: 'issue-1200',
    },
    {
      what: 'a dispatch naming nothing',
      event: { event_name: 'workflow_dispatch', run_id: 5, event: {} },
      inputs: { issue_number: '' },
      entity: 'manual',
    },
  ];

  const noops = [
    { what: 'a comment with no mention', event: { event_name: 'issue_comment', run_id: 6, event: { issue: { number: 1203 }, comment: { body: 'Thanks, merged.', user: { type: 'User' } } } } },
    { what: 'a bot quoting the mention', event: { event_name: 'issue_comment', run_id: 7, event: { issue: { number: 1203 }, comment: { body: '@claude @opencode', user: { type: 'Bot' } } } } },
  ];

  it.each([
    ['claude-runner.yml', '@claude'],
    ['opencode-runner.yml', '@opencode'],
  ])('%s names each real trigger after its entity, and its group after the same one', (name, mention) => {
    const text = workflow(name);
    const runName = expressionAfter(text, '\nrun-name:');
    const group = expressionAfter(text, '\n  group:');
    for (const c of cases(mention)) {
      const contexts = { github: c.event, inputs: c.inputs ?? {} };
      const title = evaluateTemplate(runName, contexts);
      expect(title, `${name}: ${c.what}`).toBe(`agentic-run ${c.entity}`);
      expect(evaluateTemplate(group, contexts), `${name}: ${c.what}`).toBe(`agentic-runner-${c.entity}`);
      // And the one reader of that name agrees on what it says.
      const parsed = liveness.parseRunEntity(title);
      expect(parsed, `${name}: ${c.what}`).not.toBeNull();
      expect(parsed.kind === 'manual' ? 'manual' : `${parsed.kind}-${parsed.number}`).toBe(c.entity);
    }
  });

  it.each(['claude-runner.yml', 'opencode-runner.yml'])(
    '%s names a trigger its job will skip `agentic-noop`, in a group of its own',
    (name) => {
      const text = workflow(name);
      const runName = expressionAfter(text, '\nrun-name:');
      const group = expressionAfter(text, '\n  group:');
      for (const c of noops) {
        const contexts = { github: c.event, inputs: {} };
        expect(evaluateTemplate(runName, contexts), c.what).toBe('agentic-noop');
        expect(evaluateTemplate(group, contexts), c.what).toBe(`agentic-runner-noop-${c.event.run_id}`);
      }
    }
  );

  // The run-name and the group decide "is this a real trigger" and "which
  // entity" with the same two expressions. Written twice, so pinned equal: a
  // run named after one entity and serialised under another would slip past
  // every liveness check that trusts the name.
  it.each(['claude-runner.yml', 'opencode-runner.yml'])('%s decides both from identical expressions', (name) => {
    const text = workflow(name);
    const normalise = (expr: string) => expr.replace(/\s+/g, ' ');
    const runName = normalise(expressionAfter(text, '\nrun-name:'));
    const group = normalise(expressionAfter(text, '\n  group:'));
    const trigger = (expr: string) => expr.slice(expr.indexOf('('), expr.indexOf('&& format('));
    const entity = (expr: string) => expr.slice(expr.indexOf("{0}', ") + 6, expr.lastIndexOf(') ||'));
    expect(trigger(runName)).toBe(trigger(group));
    expect(entity(runName)).toBe(entity(group));
  });
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
  // `pending`, not only `queued`. #1136 moved the status set and the
  // liveness verdict itself out of this file and into `run-liveness.cjs`
  // (checked below, under "cannot drift between its two copies") — this
  // action now only has to prove it delegates, excluding its own run.
  it('only recovers when nothing is queued or live behind this run', () => {
    expect(action).toContain('run-liveness.cjs');
    expect(action).toContain('runLiveness.decideRunLiveness');
    expect(action).toContain('excludeRunId: context.runId');
  });

  it('excludes its own issue from the sweep', () => {
    expect(action).toContain('self_issue');
    expect(action).toContain('issue.number === mine');
  });
});

// #614: the "is a runner session live" predicate used to be inlined twice —
// here and in agentic-ci-failure.yml's guard. Pinning each copy on its own was
// not enough: agentic-ci-failure.yml has carried the full non-terminal status
// set since #507 (13 Aug), agentic-recover-blocked shipped with only
// `['queued', 'in_progress']` three weeks later in #641, and nothing compared
// the two, so #614's `pending` run was invisible to one check and would have
// been caught by the other.
//
// #1136 moved agentic-recover-blocked onto `run-liveness.cjs`. Parallel runs
// finished the job: "live" now has to mean "live *on this entity*", which is a
// parse of the run's `run-name`, and a third place to get that wrong is one too
// many. Both guards read runner runs through `issue-api.cjs`'s `runnerRuns` and
// decide with `run-liveness.cjs`, and neither carries a list of its own.
describe('the runner-liveness predicate lives in one place', () => {
  const recover = readFileSync(
    join(ROOT, '.github/actions/agentic-recover-blocked/action.yml'), 'utf8'
  );
  const failsafe = workflow('agentic-ci-failure.yml');
  const runLiveness = require(join(ROOT, '.github/scripts/run-liveness.cjs'));

  it.each([
    ['agentic-recover-blocked', recover],
    ['agentic-ci-failure.yml', failsafe],
  ])('%s reads runner runs through the shared reader, carrying no list of its own', (_, source) => {
    expect(source).toContain('.github/scripts/run-liveness.cjs');
    expect(source).toContain('.github/scripts/issue-api.cjs');
    expect(source).toContain('api.runnerRuns()');
    expect(source).not.toMatch(/const RUNNERS = \[/);
    expect(source).not.toMatch(/const LIVE = \[/);
  });

  it('polls the full set of non-terminal run statuses', () => {
    // Pin the content, not only the agreement — a narrowed set in the one
    // shared place would reproduce #614 everywhere at once.
    expect(runLiveness.LIVE_RUN_STATUSES).toEqual(['queued', 'in_progress', 'waiting', 'requested', 'pending']);
    const api = readFileSync(join(ROOT, '.github/scripts/issue-api.cjs'), 'utf8');
    expect(api).toContain("require('./run-liveness.cjs')");
    expect(api).toContain('for (const status of [null, ...LIVE_RUN_STATUSES])');
    expect(api).toContain('for (const workflow_id of RUNNER_WORKFLOWS)');
  });

  it('weighs only the runs that name the work in question', () => {
    expect(recover).toContain('runLiveness.decideRunLiveness');
    expect(failsafe).toContain('liveness.liveRunFor(runner.runs, [');
    expect(failsafe).toContain("{ kind: 'issue', number: issueNumber }");
    expect(failsafe).toContain("{ kind: 'pr', number: pr.number }");
  });

  // A read that failed is not an empty list: declining is the safe polarity,
  // and the step goes red so the failure is seen.
  it('fails the fail-safe loud when runner runs cannot be read', () => {
    expect(failsafe).toMatch(/if \(runner\.unknown\) \{\s*\n\s*core\.setFailed\(/);
  });
});

// The gate's verdict, lifted out of the shipped action rather than copied.
//
// Its history is three failures in one function. PR #499 was green and marked
// and sat open because a 10-minute settle poll called it stuck while its browser
// shards still had 35 minutes to run — so nothing here waits on a clock, and a
// head still reporting is `pending` until CI completing brings the sweep back.
// A head with no runs at all is `pending` too, never a pass. And, since parallel
// runs, green is not enough: a head that does not contain `main`'s tip is
// brought up to date and tested again rather than merged.
describe('the merge gate\'s verdict', () => {
  const source = readFileSync(join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8');
  const lift = (name: string) => {
    const start = source.indexOf(`const ${name}`);
    const end = source.indexOf('\n          };', start);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    return source.slice(start, end + '\n          };'.length);
  };

  type Checks = { pending: number; failed: number; total: number };
  const gateVerdict = new Function(`${lift('gateVerdict')} return gateVerdict;`)() as (
    state: string,
    checks: Checks,
    behindBy: number | null
  ) => string;

  const green = { pending: 0, failed: 0, total: 3 };
  const running = { pending: 1, failed: 0, total: 3 };
  const red = { pending: 0, failed: 1, total: 3 };
  const nothingYet = { pending: 0, failed: 0, total: 0 };

  it('merges a green head that contains the base tip', () => {
    expect(gateVerdict('clean', green, 0)).toBe('merge');
  });

  // The rule parallel runs need: two PRs green alone can be red together.
  it('brings a green head that is behind up to date instead of merging it', () => {
    expect(gateVerdict('clean', green, 1)).toBe('update');
    expect(gateVerdict('clean', green, 12)).toBe('update');
  });

  it('asks how far behind a green head is before deciding anything else', () => {
    expect(gateVerdict('clean', green, null)).toBe('compare');
  });

  // `unknown` is only "GitHub has not finished computing mergeability" — the
  // merge or update call itself answers that, so it stops nothing.
  it.each(['unknown', 'unstable', 'blocked', 'has_hooks', 'clean'])(
    'does not wait on `%s` once the channels are green',
    (state) => {
      expect(gateVerdict(state, green, 0)).toBe('merge');
    }
  );

  it.each(['unstable', 'unknown', 'clean'])('waits on `%s` while a channel is still running', (state) => {
    expect(gateVerdict(state, running, 0)).toBe('pending');
  });

  it.each(['clean', 'unknown'])('reads `%s` with no run at all as pending, never green', (state) => {
    expect(gateVerdict(state, nothingYet, 0)).toBe('pending');
  });

  it('hands a failed channel to the fail-safe', () => {
    expect(gateVerdict('unstable', red, 0)).toBe('red');
  });

  // A conflict is decided first: nothing else about the head matters until the
  // base merges into it, and the agent is the only one who can make it.
  it.each([
    ['green', green],
    ['running', running],
    ['red', red],
  ] as const)('reads a conflict as a conflict whatever the channels say (%s)', (_, checks) => {
    expect(gateVerdict('dirty', checks, 3)).toBe('conflict');
  });

  describe("reading #499's head the way the gate reads it", () => {
    // `checkState`, run on the shared module it requires in production.
    const ciHandback = require(join(ROOT, '.github/scripts/ci-handback.cjs'));
    const checkState = new Function(
      'RUN_FAILURES',
      'latestPerWorkflow',
      `${lift('checkState')} return checkState;`
    )(ciHandback.RUN_FAILURES, ciHandback.latestPerWorkflow) as (runs: object[]) => Checks;

    const CI = { id: 31062936274, path: '.github/workflows/ci.yml', workflow_id: 254203664 };
    const REVIEW = { id: 31062936235, path: '.github/workflows/claude-code-review.yml', workflow_id: 320501354 };
    const CHAIN = { id: 31062936200, path: '.github/workflows/auto-assign-next.yml', workflow_id: 255968026 };

    // 01:30:50 — seconds after #499 opened, CI with 45 minutes left to run.
    // `auto-assign-next.yml` is on the head too, and it is the run that asks
    // the gate to look: counting it would make the gate wait on its own caller.
    it('waits on CI and never on the machinery that woke it', () => {
      const checks = checkState([
        { ...CI, status: 'in_progress', conclusion: null },
        { ...REVIEW, status: 'completed', conclusion: 'skipped' },
        { ...CHAIN, status: 'in_progress', conclusion: null },
      ]);
      expect(checks).toEqual({ pending: 1, failed: 0, total: 2 });
      expect(gateVerdict('unstable', checks, 0)).toBe('pending');
    });

    // 02:15:20 — CI completes, which is itself the event that runs the gate.
    it('merges #499 once CI completes on a head containing main', () => {
      const checks = checkState([
        { ...CI, status: 'completed', conclusion: 'success' },
        { ...REVIEW, status: 'completed', conclusion: 'skipped' },
        { ...CHAIN, status: 'completed', conclusion: 'success' },
      ]);
      expect(checks).toEqual({ pending: 0, failed: 0, total: 2 });
      expect(gateVerdict('clean', checks, 0)).toBe('merge');
    });

    it('reads a superseded CI run as replaced, not as a failure', () => {
      const checks = checkState([
        { ...CI, id: CI.id - 1, status: 'completed', conclusion: 'cancelled' },
        { ...CI, status: 'completed', conclusion: 'success' },
      ]);
      expect(checks).toEqual({ pending: 0, failed: 0, total: 1 });
    });

    it('still reads a genuinely failed CI run as red', () => {
      const checks = checkState([
        { ...CI, status: 'completed', conclusion: 'failure' },
        { ...REVIEW, status: 'completed', conclusion: 'skipped' },
      ]);
      expect(gateVerdict('unstable', checks, 0)).toBe('red');
    });
  });
});

// PR #615's actual failure mode: a workflow run's own `conclusion` is
// `success` the instant every job in it either passed or was skipped, so
// `checkState`/`mergeVerdict` alone cannot tell a genuinely green PR from one
// whose interaction shards silently never ran. The jobs are unconditional
// now; this is the independent line of defence that asks the CI run's own
// jobs directly, so a job that somehow never runs is a red verdict.
describe("asking the CI run's own jobs before trusting its conclusion", () => {
  const source = readFileSync(
    join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
  );
  const start = source.indexOf('const REQUIRED_JOBS');
  const end = source.indexOf('// How many of the base');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  interface RunJob { name: string; conclusion: string }

  const buildMissingRequiredJobs = (jobsByRunId: Record<number, RunJob[]>) =>
    new Function(
      'github',
      'owner',
      'repo',
      `${source.slice(start, end)} return missingRequiredJobs;`
    )(
      {
        paginate: async (_fn: unknown, { run_id }: { run_id: number }) => jobsByRunId[run_id] ?? [],
        rest: { actions: { listJobsForWorkflowRun: () => {} } },
      },
      'Nico2398',
      'BlastSimulator2026'
    ) as (runs: unknown[]) => Promise<string[]>;

  const CI_RUN = { id: 555, path: '.github/workflows/ci.yml' };
  const INTERACTION = 'Scenarios (interaction mode)';
  const BUILD = 'Production build';
  const interactionJob = (n: number, conclusion: string): RunJob => ({ name: `${INTERACTION} — shard ${n}/4`, conclusion });
  const buildJob = (conclusion: string): RunJob => ({ name: BUILD, conclusion });
  const allGreen = [...[1, 2, 3, 4].map((n) => interactionJob(n, 'success')), buildJob('success')];

  it('clears once every interaction shard and the build report success', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({ [CI_RUN.id]: allGreen });
    await expect(missingRequiredJobs([CI_RUN])).resolves.toEqual([]);
  });

  // The exact #615 shape: the run reports `success`, but the job never
  // appears in its own job list at all.
  it('flags the interaction job when it never ran', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({ [CI_RUN.id]: [buildJob('success')] });
    await expect(missingRequiredJobs([CI_RUN])).resolves.toEqual([INTERACTION]);
  });

  it('flags the interaction job when a shard is present but did not succeed', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({
      [CI_RUN.id]: [interactionJob(1, 'success'), interactionJob(2, 'failure'), buildJob('success')],
    });
    await expect(missingRequiredJobs([CI_RUN])).resolves.toEqual([INTERACTION]);
  });

  it('checks the build independently of the shards', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({
      [CI_RUN.id]: [1, 2, 3, 4].map((n) => interactionJob(n, 'success')),
    });
    await expect(missingRequiredJobs([CI_RUN])).resolves.toEqual([BUILD]);
  });

  it('fails closed when no ci.yml run exists on the head at all', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({});
    await expect(missingRequiredJobs([])).resolves.toEqual([INTERACTION, BUILD]);
  });

  it('looks up the CI run by path, not by display name', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({ [CI_RUN.id]: allGreen });
    const renamedButSamePath = { id: CI_RUN.id, path: CI_RUN.path };
    await expect(missingRequiredJobs([renamedButSamePath])).resolves.toEqual([]);
  });

  it('reads the newest CI run on the head when more than one is present', async () => {
    const missingRequiredJobs = buildMissingRequiredJobs({
      [CI_RUN.id]: [],
      [CI_RUN.id + 1]: allGreen,
    });
    await expect(
      missingRequiredJobs([CI_RUN, { ...CI_RUN, id: CI_RUN.id + 1 }])
    ).resolves.toEqual([]);
  });
});

// The two REQUIRED_JOBS array literals -- one real TS
// (scripts/lib/required-jobs.ts, exported and unit-tested directly), one inline
// github-script JS (this same action.yml, extracted above for its own tests)
// -- can drift with nothing in either test suite noticing, since each only
// proves its own copy's behavior. That drift already produced a real
// disagreement once (a PR review round found await-pr-ci.ts's no-ci.yml-run
// case reading GREEN where this action's own equivalent reads every required
// job missing) before this test existed. Comparing the two literals
// directly is what would have caught it before the behavior ever diverged.
describe('REQUIRED_JOBS stays identical between scripts/lib/required-jobs.ts and this action', () => {
  it('the two array literals are the same value, not just similarly shaped', () => {
    const actionSource = readFileSync(
      join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8'
    );
    const actionStart = actionSource.indexOf('const REQUIRED_JOBS');
    const actionEnd = actionSource.indexOf('];', actionStart) + 2;
    const actionArray = new Function(`${actionSource.slice(actionStart, actionEnd)} return REQUIRED_JOBS;`)();

    const tsSource = readFileSync(join(ROOT, 'scripts/lib/required-jobs.ts'), 'utf8');
    const tsStart = tsSource.indexOf('const REQUIRED_JOBS');
    const tsEnd = tsSource.indexOf('];', tsStart) + 2;
    // Strip the TS-only type annotation the YAML copy has no equivalent for.
    const tsDecl = tsSource.slice(tsStart, tsEnd).replace(': { jobNamePrefix: string }[]', '');
    const tsArray = new Function(`${tsDecl} return REQUIRED_JOBS;`)();

    expect(actionArray).toEqual(tsArray);
  });
});

// Every wait in this path was once a guess at something an event reports. A
// sleeping runner is also the one state that cannot say what it is waiting for,
// which is how #499's ten minutes of identical log lines ended in a wrong
// verdict rather than a useful one.
describe('the merge gate holds no timer', () => {
  const source = readFileSync(join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8');

  it('never sleeps, polls, or reads the clock', () => {
    expect(source).not.toContain('setTimeout');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('Date.now');
    expect(source).not.toMatch(/settle(?!Refusal)/i);
  });

  it.each(['agentic-auto-merge.yml', 'auto-assign-next.yml'])('%s waits on no clock either', (name) => {
    expect(workflow(name)).not.toMatch(/^\s*(run:\s*)?sleep\s/m);
  });

  // The merge and update requests are the authority on whether they succeed,
  // and a refusal is settled on the PR's state afterwards — never on the words
  // of the error (PR #434's refusal string fell through to a green step).
  it('settles a refusal on the pull request\'s state, never on the error text', () => {
    const settle = source.slice(source.indexOf('const settleRefusal'), source.indexOf('const candidates'));
    expect(settle).toContain("now.mergeable_state === 'dirty'");
    expect(settle).toContain('now.head.sha !== before.head.sha');
    expect(settle).not.toMatch(/\.message\s*\.|test\(\s*error|\.includes\(\s*['"]/);
  });

  it('pins both writes to the head it judged', () => {
    expect(source).toContain("github.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch'");
    expect(source).toContain('expected_head_sha: pr.head.sha');
    expect(source).toMatch(/github\.rest\.pulls\.merge\(\{\s*\n\s*owner, repo, pull_number: n, merge_method: 'squash', sha: pr\.head\.sha/);
  });
});

// The gate wakes on events that can change a verdict, and on nothing else.
// Its `if:` is evaluated here against the events GitHub sends, because a clause
// that silently never matches is a PR that is silently never merged.
describe('what wakes the merge gate', () => {
  const gate = workflow('agentic-auto-merge.yml');
  const triggers = gate.slice(gate.indexOf('\non:'), gate.indexOf('\npermissions:'));
  const jobIf = (() => {
    const job = gate.slice(gate.indexOf('\n  gate:'));
    const start = job.indexOf('if: >-') + 'if: >-'.length;
    return job.slice(start, job.indexOf('\n    runs-on:'));
  })();

  const wakes = (github: Record<string, unknown>, enabled = 'true') =>
    Boolean(evaluateExpression(jobIf, { github, vars: { AGENTIC_AUTO_MERGE_ENABLED: enabled } } as never));
  const completed = (name: string, conclusion: string, display_title = 'x') => ({
    event_name: 'workflow_run',
    event: { workflow_run: { name, conclusion, display_title } },
  });

  it('listens to CI and to both runners completing, by the names they declare', () => {
    expect(triggers).toMatch(/workflow_run:\s*\n\s*workflows:\s*\["CI", "Claude Pipeline", "OpenCode Pipeline"\]/);
    expect(triggers).toMatch(/types:\s*\[completed\]/);
    expect(triggers).toContain('workflow_dispatch:');
    expect(/^name:\s*(.+)$/m.exec(workflow('ci.yml'))?.[1]?.trim()).toBe('CI');
    expect(/^name:\s*(.+)$/m.exec(workflow('claude-runner.yml'))?.[1]?.trim()).toBe('Claude Pipeline');
    expect(/^name:\s*(.+)$/m.exec(workflow('opencode-runner.yml'))?.[1]?.trim()).toBe('OpenCode Pipeline');
  });

  it('stays off a clock', () => {
    expect(triggers).not.toContain('schedule:');
    expect(triggers).not.toContain('cron:');
  });

  it('looks when CI succeeds anywhere, and not when it fails', () => {
    expect(wakes(completed('CI', 'success'))).toBe(true);
    expect(wakes(completed('CI', 'failure'))).toBe(false);
    expect(wakes(completed('CI', 'cancelled'))).toBe(false);
  });

  // Every comment in the repository creates a noop run in both runners, and
  // each completes. Only a real session's end is worth a sweep.
  it('looks when a real session ends, whatever its conclusion, and never on a noop run', () => {
    expect(wakes(completed('Claude Pipeline', 'success', 'agentic-run issue-1203'))).toBe(true);
    expect(wakes(completed('OpenCode Pipeline', 'failure', 'agentic-run pr-1251'))).toBe(true);
    expect(wakes(completed('Claude Pipeline', 'skipped', 'agentic-noop'))).toBe(false);
  });

  it('looks when asked, and never while auto-merge is switched off', () => {
    expect(wakes({ event_name: 'workflow_dispatch', event: {} })).toBe(true);
    expect(wakes({ event_name: 'workflow_dispatch', event: {} }, 'false')).toBe(false);
    expect(wakes(completed('CI', 'success'), '')).toBe(false);
  });

  // A dropped wake-up costs nothing while another is coming; the watchdog is
  // for when none is.
  it('is re-raised by the watchdog while a marked pull request is open', () => {
    const watchdog = workflow('agentic-watchdog.yml');
    const step = watchdog.slice(watchdog.indexOf('- name: Re-raise the merge gate'));
    expect(step).toContain("workflow_id: 'agentic-auto-merge.yml'");
    expect(step).toContain("line.trim() === 'READY TO MERGE'");
    expect(step).not.toContain('pulls.merge');
  });
});

// The gate's shipped script, run against a fake GitHub. The property that makes
// parallel runs safe is checked directly: every pull request that merges lands
// on exactly the `main` its channels ran against.
describe('the merge gate end to end', () => {
  const script = (() => {
    const action = readFileSync(join(ROOT, '.github/actions/agentic-auto-merge/action.yml'), 'utf8');
    const marker = 'script: |\n';
    return action
      .slice(action.indexOf(marker) + marker.length)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');
  })();

  type Checks = 'green' | 'red' | 'running' | 'none';
  interface FakePr {
    number: number;
    checks: Checks;
    /** How many of `main`'s merges this head contains. Defaults to all of them. */
    base?: number;
    body?: string;
    draft?: boolean;
    head?: string;
    conflicts?: boolean;
    conflictsOnUpdate?: boolean;
    mergeRefused?: boolean;
    jobsMissing?: boolean;
    gated?: boolean;
  }
  interface State extends Required<Omit<FakePr, 'head' | 'body'>> {
    head: string;
    body: string;
    sha: string;
    open: boolean;
    merged: boolean;
  }

  const MARKED = 'Closes #1\n\nREADY TO MERGE';

  function world(prs: FakePr[], main = 0) {
    const w = {
      main,
      prs: new Map<number, State>(),
      merges: [] as { number: number; testedAgainst: number; landedOn: number }[],
      updates: [] as number[],
    };
    for (const pr of prs) {
      w.prs.set(pr.number, {
        base: main,
        body: MARKED,
        draft: false,
        head: `pipeline/feature-${pr.number}-77`,
        conflicts: false,
        conflictsOnUpdate: false,
        mergeRefused: false,
        jobsMissing: false,
        gated: false,
        ...pr,
        sha: `sha-${pr.number}-0`,
        open: true,
        merged: false,
      });
    }
    return w;
  }

  async function gate(w: ReturnType<typeof world>) {
    const out = { outputs: {} as Record<string, string>, failed: null as string | null, log: [] as string[] };
    const toApi = (p: State) => ({
      number: p.number,
      draft: p.draft,
      body: p.body,
      state: p.open ? 'open' : 'closed',
      merged: p.merged,
      head: { ref: p.head, sha: p.sha },
      base: { ref: 'main' },
      user: { login: 'pipeline-user' },
      mergeable_state: p.conflicts ? 'dirty' : 'clean',
    });
    const bySha = (sha: string) => [...w.prs.values()].find((p) => p.sha === sha)!;
    const runsFor = (p: State) => {
      const id = parseInt(p.sha.replace(/\D/g, ''), 10);
      const ci = { path: '.github/workflows/ci.yml', workflow_id: 1, id, name: 'CI' };
      const guard = { path: '.github/workflows/agentic-closing-keyword-guard.yml', workflow_id: 2, id: id + 1, name: 'guard' };
      const gated = p.gated ? [{ ...guard, id: id + 2, workflow_id: 3, status: 'action_required', conclusion: 'action_required' }] : [];
      switch (p.checks) {
        case 'green':
          return [{ ...ci, status: 'completed', conclusion: 'success' }, { ...guard, status: 'completed', conclusion: 'success' }, ...gated];
        case 'red':
          return [{ ...ci, status: 'completed', conclusion: 'failure' }, { ...guard, status: 'completed', conclusion: 'success' }];
        case 'running':
          return [{ ...ci, status: 'in_progress', conclusion: null }, ...gated];
        default:
          return [];
      }
    };
    const refuse = (message: string, status: number) => Object.assign(new Error(message), { status });

    const github: any = {
      rest: {
        pulls: {
          list: async () => ({ data: [] }),
          get: async ({ pull_number }: { pull_number: number }) => ({ data: toApi(w.prs.get(pull_number)!) }),
          merge: async ({ pull_number, sha, merge_method }: { pull_number: number; sha: string; merge_method: string }) => {
            const p = w.prs.get(pull_number)!;
            expect(merge_method).toBe('squash');
            if (sha !== p.sha) throw refuse('Head branch was modified', 409);
            if (p.mergeRefused) throw refuse('Repository rule violations found', 405);
            if (p.conflicts) throw refuse('Pull Request is not mergeable', 405);
            w.merges.push({ number: p.number, testedAgainst: p.base, landedOn: w.main });
            w.main += 1;
            p.open = false;
            p.merged = true;
            return { data: { merged: true } };
          },
        },
        actions: {
          listWorkflowRunsForRepo: async () => ({ data: [] }),
          listJobsForWorkflowRun: async () => ({ data: [] }),
        },
        repos: {
          compareCommitsWithBasehead: async ({ basehead }: { basehead: string }) => {
            const [baseRef, sha] = basehead.split('...');
            expect(baseRef).toBe('main');
            return { data: { behind_by: w.main - bySha(sha!).base } };
          },
        },
      },
      paginate: async (fn: unknown, params: Record<string, unknown>) => {
        if (fn === github.rest.pulls.list) {
          expect(params).toMatchObject({ state: 'open', sort: 'created', direction: 'asc' });
          return [...w.prs.values()].filter((p) => p.open).sort((a, b) => a.number - b.number).map(toApi);
        }
        if (fn === github.rest.actions.listWorkflowRunsForRepo) return runsFor(bySha(params.head_sha as string));
        if (fn === github.rest.actions.listJobsForWorkflowRun) {
          const p = [...w.prs.values()].find((candidate) => runsFor(candidate).some((run) => run.id === params.run_id));
          const shards = [1, 2].map((n) => ({ name: `Scenarios (interaction mode) — shard ${n}/2`, conclusion: 'success' }));
          return p?.jobsMissing ? [{ name: 'Production build', conclusion: 'success' }] : [...shards, { name: 'Production build', conclusion: 'success' }];
        }
        throw new Error('unexpected paginate');
      },
      request: async (route: string, params: Record<string, unknown>) => {
        if (route.startsWith('POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve')) return { data: {} };
        if (route === 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch') {
          const p = w.prs.get(params.pull_number as number)!;
          if (params.expected_head_sha !== p.sha) throw refuse("expected head sha didn't match current head ref", 422);
          if (p.conflictsOnUpdate) {
            p.conflicts = true;
            throw refuse('merge conflict between base and head', 422);
          }
          w.updates.push(p.number);
          p.base = w.main;
          p.sha = `sha-${p.number}-${w.main}`;
          p.checks = 'running';
          return { data: {} };
        }
        throw new Error(`unexpected request ${route}`);
      },
    };
    const core = {
      info: (m: string) => out.log.push(m),
      warning: (m: string) => out.log.push(m),
      setFailed: (m: string) => {
        out.failed = m;
      },
      setOutput: (k: string, v: string) => {
        out.outputs[k] = v;
      },
    };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('github', 'context', 'core', 'require', 'process', script)(
      github,
      { repo: { owner: 'Nico2398', repo: 'BlastSimulator2026' }, runId: 1 },
      core,
      require,
      { env: { GITHUB_WORKSPACE: ROOT } }
    );
    return out;
  }

  // The hazard parallel runs create, and the reason the gate exists: #10 and
  // #11 are each green against the same `main`. Merging both would put a tree
  // on `main` that no channel ran. The gate merges one, brings the other up to
  // date, and merges it only once CI has passed on top of the first.
  it('lands every merge on exactly the main its channels ran against', async () => {
    const w = world([
      { number: 10, checks: 'green' },
      { number: 11, checks: 'green' },
    ]);

    const first = await gate(w);
    expect(first.failed).toBeNull();
    expect(first.outputs.merged).toBe('10');
    expect(first.outputs.updated).toBe('11');

    // CI on #11's updated head reports green; that completion is the next wake.
    w.prs.get(11)!.checks = 'green';
    const second = await gate(w);
    expect(second.outputs.merged).toBe('11');

    expect(w.merges).toEqual([
      { number: 10, testedAgainst: 0, landedOn: 0 },
      { number: 11, testedAgainst: 1, landedOn: 1 },
    ]);
    for (const merge of w.merges) expect(merge.testedAgainst).toBe(merge.landedOn);
  });

  it('brings a green pull request that is behind up to date, and merges nothing', async () => {
    const w = world([{ number: 10, checks: 'green', base: 0 }], 2);
    const out = await gate(w);
    expect(out.outputs.updated).toBe('10');
    expect(out.outputs.merged).toBe('');
    expect(w.merges).toEqual([]);
  });

  it('waits on a head that is still running, without failing', async () => {
    const w = world([{ number: 10, checks: 'running', gated: true }]);
    const out = await gate(w);
    expect(out.outputs.pending).toBe('10');
    expect(out.outputs.approved).toBe('1');
    expect(out.failed).toBeNull();
  });

  it.each([
    ['a red channel', { checks: 'red' as Checks }],
    ['a conflict with main', { checks: 'green' as Checks, conflicts: true }],
    ['an update that conflicts', { checks: 'green' as Checks, base: 0, conflictsOnUpdate: true }],
  ])('hands %s back to the agent, and merges nothing', async (_, pr) => {
    const w = world([{ number: 10, ...pr }], 1);
    const out = await gate(w);
    expect(out.outputs.handback).toBe('10');
    expect(w.merges).toEqual([]);
    expect(out.failed).toBeNull();
  });

  it('does not merge on a run-level success whose required jobs never ran (#615)', async () => {
    const w = world([{ number: 10, checks: 'green', jobsMissing: true }]);
    const out = await gate(w);
    expect(out.outputs.stuck).toBe('10');
    expect(w.merges).toEqual([]);
    expect(out.failed).toContain('#10');
  });

  it('reports a refusal it cannot explain, loudly', async () => {
    const w = world([{ number: 10, checks: 'green', mergeRefused: true }]);
    const out = await gate(w);
    expect(out.outputs.stuck).toBe('10');
    expect(out.failed).toContain('unable to move');
  });

  it('skips a draft and fails loudly on a pipeline pull request that is neither marked nor draft', async () => {
    const w = world([
      { number: 10, checks: 'green', draft: true },
      { number: 11, checks: 'green', body: 'Closes #11' },
      { number: 12, checks: 'green', body: 'a human PR', head: 'feature/something' },
    ]);
    const out = await gate(w);
    expect(w.merges).toEqual([]);
    expect(out.failed).toContain('Neither marked nor draft: #11');
    expect(out.failed).not.toContain('#12');
  });
});

// PR #615 merged with its interaction-mode job silently skipped: an `if:` on
// a pull-request label was evaluated at `opened`, before the label applied a
// call later existed, the shards reported `skipped` rather than `failure`,
// and the run still concluded `success`. The gate is gone rather than
// patched: the interaction shards and the production build run on every
// pull request, so there is no label to race and no `if:` to evaluate early.
// This pins that no such guard comes back — a job optional on PRs and
// unconditional on `main` makes `main` the place regressions are found.
describe('ci.yml runs the interaction shards and the build on every pull request', () => {
  const ci = workflow('ci.yml');

  it('gates neither job behind a pull-request label', () => {
    expect(ci).not.toContain("contains(github.event.pull_request.labels.*.name");
    expect(ci).not.toContain("github.event_name != 'pull_request'");
  });

  it('needs no `labeled` trigger type, because nothing reads labels', () => {
    const types = /pull_request:[\s\S]*?types:\s*\[([^\]]+)\]/.exec(ci)?.[1];
    expect(types, 'ci.yml should rely on the default pull_request types').toBeUndefined();
  });

  it('still declares both jobs, so "not gated" cannot quietly mean "not there"', () => {
    expect(ci).toMatch(/\n {2}scenario-interaction:\n/);
    expect(ci).toMatch(/\n {2}build:\n/);
    expect(ci).toContain('name: Production build');
    expect(ci).toContain('name: "Scenarios (interaction mode)');
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
    // Permissive of the comment lines above `workflows:` and of the widened
    // array (`Claude Pipeline` / `OpenCode Pipeline` alongside `CI`, added by
    // #1059's runner-completion fail-safe) — still fails if `CI` drops out of
    // the array or `types: [completed]` changes.
    expect(triggers).toMatch(/workflow_run:[\s\S]*?workflows:\s*\[[^\]]*"CI"[^\]]*\]/);
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
    const head = new RegExp((pattern![1] ?? '').slice(1, -1));
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
    expect(pattern, 'PIPELINE_HEAD not found in the fail-safe').toBeTruthy();
    const head = new RegExp((pattern![1] ?? '').slice(1, -1));
    expect(head.exec('pipeline/feature-769-32908623869')?.[1]).toBe('769');
    expect(head.exec('pipeline/feature-769')?.[1]).toBe('769');
  });

  // PR #773 again, from the other side: `ci.yml` green, the head red on a
  // workflow this lookup did not name. A failing run blocks the merge whichever
  // file emitted it, so the fail-safe reads channels, not one path.
  it('evaluates every channel on the head rather than ci.yml alone', () => {
    expect(failsafe).not.toContain("run.path === '.github/workflows/ci.yml'");
    expect(failsafe).toContain('latestPerWorkflow(onHead)');
  });

  // The merge gate merges only a head that contains the base's tip, so a PR
  // that conflicts with it is as stuck as a red one — and only an agent can
  // resolve it. Asked only on a dispatch (the gate's, or a re-raise), and only
  // on GitHub's own `dirty`, never on the word of whoever dispatched.
  it('hands back a conflict with the base, on a dispatch and GitHub\'s own verdict', () => {
    expect(failsafe).toContain("if (dispatchedLookup && pr.mergeable_state === 'dirty')");
    expect(failsafe).toContain('github.rest.repos.getBranch');
    expect(failsafe).toContain('conflict:${conflict.sha}');
    expect(failsafe).toContain('git merge origin/${conflict.base}');
    // Bringing the branch up to date may rebase and force-push, but only with
    // a lease: a bare --force would discard a merge the gate pushed meanwhile.
    expect(failsafe).toContain('--force-with-lease');
    expect(failsafe).toContain('never a bare \\`--force\\`');
  });

  // The same conflict is one question; the base moving on is a new one.
  it('asks about a conflict once per head and base', () => {
    expect(failsafe).toContain("const asksAbout = conflict ? `${pr.head.sha} conflict:${conflict.sha}` : `run:${ciRunId}`;");
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
  it('declines while a session on this pull request or its issue is live', () => {
    expect(failsafe).toContain('api.runnerRuns()');
    expect(failsafe).toContain('liveness.liveRunFor(');
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
  // A `workflow_dispatch` alone used to be license to bypass the "already
  // asked" check unconditionally — unsafe once `scan-after-runner` also
  // dispatches automatically, potentially twice for the same still-empty
  // comment list. That blanket bypass must be gone, replaced by a gate only an
  // explicit `force_retry` can open.
  it('answers each CI run once, identified by its run id', () => {
    expect(failsafe).toContain("const MARKER = '<!-- agentic-ci-failure -->'");
    expect(failsafe).toContain('`run:${ciRunId}`');
    expect(failsafe).not.toContain('if (askedAboutThisRun && !dispatchedLookup)');
    expect(failsafe).toMatch(/if \(askedAboutThisRun && !forceRetry\)/);
    expect(failsafe).toContain('process.env.FORCE_RETRY');
  });

  // The clock-free retry. A session that took the handback and died before
  // pushing leaves the head — and therefore the run id — unchanged, so a
  // permanent per-run skip would strand the PR with attempts still unspent.
  // The legitimate repeat now happens only through the explicit `force_retry`
  // input the watchdog's re-raise sets, never through the dispatch source
  // alone — `scan-after-runner`'s own automatic dispatch never sets it.
  it('lets a re-raise ask again about a run whose session produced nothing', () => {
    expect(failsafe).toContain('force_retry:');
    expect(failsafe).toContain('FORCE_RETRY: ${{ inputs.force_retry }}');
    const forceRetryStart = failsafe.indexOf('const forceRetry =');
    expect(forceRetryStart, 'const forceRetry = ... not found').toBeGreaterThan(-1);
    const forceRetryGate = failsafe.slice(forceRetryStart);
    expect(forceRetryGate).toContain("process.env.FORCE_RETRY === 'true'");
    expect(forceRetryGate).toContain('force_retry requested. Asking again.');
    expect(forceRetryGate).toContain('nudges.length >= limit');

    const watchdog = workflow('agentic-watchdog.yml');
    expect(watchdog).toContain("force_retry: 'true'");
  });

  // Structural proof of the actual idempotency fix: the override requires
  // *both* a dispatch-lookup run (never the `workflow_run` path a genuine CI
  // completion takes) and the explicit env flag — either alone is not enough,
  // so `scan-after-runner`'s automatic dispatch (which never sets
  // `force_retry`) can never bypass "already asked", only the watchdog's
  // explicit re-raise can.
  it('requires both a dispatch lookup and an explicit force_retry before re-asking', () => {
    expect(failsafe).toContain(
      "const forceRetry = dispatchedLookup && process.env.FORCE_RETRY === 'true';"
    );
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
    '%s hands that exact branch to rescue',
    (name) => {
      const text = workflow(name);
      expect(text).toContain('branch: ${{ steps.context.outputs.feature_branch }}');
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

  // A work branch this run built is always run-id-suffixed in practice
  // (agentic-prompt names it `pipeline/<role>-<issue>-<runid>`), but the retry's
  // disk inventory used to glob only the bare `pipeline/*-<issue>` form. That
  // read a real branch on disk as "none ... so the work starts from main",
  // telling the retry to rebuild work that already existed instead of
  // continuing it — found investigating PR #872's rescue of issue #842.
  it('the disk inventory globs both the bare and the run-id-suffixed branch name', () => {
    const state = readFileSync(join(ROOT, '.github/actions/agentic-run-state/action.yml'), 'utf8');
    expect(state).toContain('"refs/heads/pipeline/*-${ISSUE}" "refs/heads/pipeline/*-${ISSUE}-*"');
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
// PR #773's ending, made impossible. The sweep refused to merge it — it reads
// every run on the head and a failing `closing-keyword-guard` made the verdict
// red — and then said so only by failing its own job, which is announced to
// nobody. `agentic-ci-failure.yml` is the thing that hands a red PR back to an
// agent, and nothing was calling it for a red that was not `ci.yml`'s. With the
// merge gate a conflict with `main` goes the same way: only an agent resolves one.
describe('the merge gate hands back what it cannot merge', () => {
  const gate = workflow('agentic-auto-merge.yml');
  const handback = gate.slice(gate.indexOf('- name: Hand a red or conflicting marked PR back'));

  it('dispatches the fail-safe for every red or conflicting marked PR', () => {
    expect(handback).toContain('createWorkflowDispatch');
    expect(handback).toContain("workflow_id: 'agentic-ci-failure.yml'");
    expect(handback).toContain('steps.merge.outputs.handback');
  });

  // The sweep calls `core.setFailed` on stuck PRs, so a step without
  // `always()` would be skipped on exactly the runs that also carry a handback.
  it('runs even though the sweep step failed', () => {
    expect(handback).toMatch(/if: always\(\) && steps\.merge\.outputs\.handback != ''/);
  });

  it('dispatches with the PAT', () => {
    expect(handback).toContain('github-token: ${{ secrets.PAT_TOKEN_COPILOT_AUTOMATION }}');
  });

  // A handback that did not happen is a PR nobody is fixing.
  it('fails the job when a dispatch could not be made', () => {
    expect(handback).toMatch(/if \(failed\.length > 0\) \{\s*\n\s*core\.setFailed\(/);
  });
});

// #1006 and #1007, 48 seconds apart: `anthropics/claude-code-action@v1` moved to
// a Claude Code build whose installer reported success and left no executable,
// and four attempts died ENOENT without reading a word of either prompt. The
// action hardcodes the agent build it installs, so a floating tag is a floating
// agent binary — and the failure is indistinguishable downstream from an agent
// that ran and produced nothing, which is what both issues were told.
describe('the agent binary cannot change underneath a run', () => {
  const CALLERS = ['claude-runner.yml', 'claude-code-review.yml'];
  // v1.0.217 / Claude Code 2.1.263, the last build a run finished on here.
  const PINNED = '9c5ddab2e6d17b83ea679153b31f1d5f023cf636';

  it.each(CALLERS)('%s pins claude-code-action to a SHA, never a tag', (name) => {
    const uses = workflow(name)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('uses: anthropics/claude-code-action@'));

    expect(uses.length, `${name} calls the action but no longer matches — update this test`)
      .toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, `${name} floats on a moving ref. Pin the 40-character SHA.`)
        .toMatch(/^uses: anthropics\/claude-code-action@[0-9a-f]{40}( #.*)?$/);
    }
  });

  // Both runner attempts and the reviewer run the same build, or a "retry" is
  // a different run and a review is written by an agent no run was proven on.
  it('pins every call site to the same SHA', () => {
    for (const name of CALLERS) {
      const refs = [...workflow(name).matchAll(/uses: anthropics\/claude-code-action@(\S+)/g)]
        .map((match) => match[1]);
      expect(new Set(refs), `${name} mixes action versions`).toEqual(new Set([PINNED]));
    }
  });
});

// The pin stops one known-bad build returning; this stops the next one being
// reported as an agent that had nothing to say.
describe('an agent that never started is not an agent that produced nothing', () => {
  const runner = workflow('claude-runner.yml');
  const check = runner.slice(
    runner.indexOf('- name: Verify the agent binary the action installed'),
    runner.indexOf('- name: Did the run settle its issue?')
  );

  it('runs on the failed attempt it exists for', () => {
    expect(check).toContain("if: always() && steps.claude.outcome != 'skipped'");
  });

  // State, not a duration: the file on disk, and the class the SDK named.
  it('decides on the executable and the SDK verdict', () => {
    expect(check).toContain('[ -x "${CLAUDE_BIN}" ] || MISSING=true');
    expect(check).toContain('executable_not_found');
  });

  // A job-log warning is not somewhere anyone is watching; an annotation is.
  it('says which failure it was, where a human reads it', () => {
    expect(check).toContain('::error::The agent never started.');
  });

  // An output nothing reads is dead the day it lands. This one has to gate the
  // retry, or the second attempt repeats a deterministic install failure and
  // spends a second halt on the cascade brake.
  it('is what stops the pointless retry', () => {
    expect(runner).toContain(
      "if: always() && steps.state.outputs.retry == 'true' && steps.binary.outputs.missing != 'true'"
    );
  });
});

// The one list that decides, in four places, whether a workflow run on a PR
// head is a channel or the merge machinery. `scripts/await-pr-ci.ts` decides
// whether a run may end on it, the fail-safe whether to hand it back, the
// watchdog whether to re-raise it, and `ci-handback.cjs`'s pure decision core
// (the event-driven path off `claude-runner.yml`/`opencode-runner.yml`
// completion) whether to re-dispatch that nudge — and a copy that drifts
// reintroduces #773 in whichever reader drifted. Inline in the two workflows
// because neither job checks out the repository; `ci-handback.cjs` is `.cjs`
// for the same reason the nudge job's own script is inline.
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
    ['.github/workflows/agentic-watchdog.yml', 'const MACHINERY = new Set(['],
    ['.github/scripts/ci-handback.cjs', 'const MACHINERY = new Set(['],
  ])('%s lists the same set, and never the closing-keyword guard', (path, marker) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    const start = text.indexOf(marker);
    expect(start, `${marker} not found in ${path}`).toBeGreaterThan(-1);
    const block = text.slice(start, text.indexOf(']', start));
    const listed = [...block.matchAll(/'(?:\.github\/workflows\/)?([\w.-]+\.yml)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...MACHINERY].sort());
  });
});

// Unlike MACHINERY/MARKER, RUN_FAILURES had no pinning test proving its three
// copies — `agentic-ci-failure.yml`'s nudge job, `agentic-watchdog.yml`'s
// re-raise step, and `ci-handback.cjs`'s exported constant — stay identical.
describe('the run-failure conclusions are one list, in two copies', () => {
  const RUN_FAILURES = ['failure', 'cancelled', 'timed_out', 'startup_failure', 'stale'];

  it.each([
    ['.github/workflows/agentic-watchdog.yml'],
    ['.github/scripts/ci-handback.cjs'],
  ])('%s lists the same run-failure conclusions', (path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    const marker = 'const RUN_FAILURES = ';
    const start = text.indexOf(marker);
    expect(start, `${marker} not found in ${path}`).toBeGreaterThan(-1);
    const block = text.slice(start, text.indexOf(']', start) + 1);
    const listed = [...block.matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...RUN_FAILURES].sort());
  });
});

// The CI fail-safe and the merge gate both check the repository out, so neither
// has a reason to carry its own copy of what counts as a channel or as red.
describe('the fail-safe and the gate read channels through the shared module', () => {
  it.each([
    ['.github/workflows/agentic-ci-failure.yml'],
    ['.github/actions/agentic-auto-merge/action.yml'],
  ])('%s requires ci-handback.cjs and carries no list of its own', (path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    expect(text).toContain('.github/scripts/ci-handback.cjs');
    expect(text).toContain('latestPerWorkflow');
    expect(text).not.toContain('const MACHINERY = new Set([');
    expect(text).not.toContain('const RUN_FAILURES = ');
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
    const head = new RegExp((pattern![1] ?? '').slice(1, -1));
    expect(head.test('pipeline/feature-769-32908623869')).toBe(true);
    expect(head.test('pipeline/feature-769')).toBe(true);
    expect(head.test('main')).toBe(false);
    expect(head.test('pipeline/tests-769-32908623869')).toBe(false);
  });
});

describe('the watchdog sweeps stranded paused issues', () => {
  const watchdog = workflow('agentic-watchdog.yml');
  const sweep = watchdog.slice(
    watchdog.indexOf('- name: Sweep stranded paused issues'),
    watchdog.indexOf('- name: Re-raise a red CI on an open pipeline PR')
  );

  it('authenticates with the same PAT every other watchdog step uses', () => {
    expect(sweep).toContain('github-token: ${{ secrets.PAT_TOKEN_COPILOT_AUTOMATION }}');
  });

  it('lists its issue source off the `paused` label', () => {
    expect(sweep).toContain("labels: 'paused'");
  });

  // Idempotency guard: an issue the sweep already flagged carries `blocked`
  // from a prior run, so re-flagging it would re-comment and re-label on
  // every schedule tick until a human clears it.
  it('skips an issue that already carries `blocked`', () => {
    expect(sweep).toContain("labels.includes('blocked')");
  });

  it('calls strandedPauseVerdict to decide the flag', () => {
    expect(sweep).toContain('rules.strandedPauseVerdict(api,');
  });
});

// Rule 1 of `agentic-workflow-edition`, made executable. Every interval this
// layer ever held was tuned to the CI of that week and broke when a shard count
// moved: auto-merge's 10-minute settle poll called PR #499 stuck with 35 minutes
// of browser shards left to run, and a 45-minute wait budget in `await-pr-ci` would
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
    // Wall-clock grace window tolerating listWorkflowRuns/comment-read eventual
    // consistency before concluding a run is lost — not a sleep, evaluated once
    // at read time in an always() teardown; see issue #1136.
    '.github/scripts/run-liveness.cjs': 'eventual-consistency grace window, not a sleep',
    // Passes `Date.now()` and the grace-window input straight through to
    // `run-liveness.cjs`'s own verdict — the same non-sleep, read-time grace
    // window as that module, just at the call site; see issue #1136.
    '.github/actions/agentic-recover-blocked/action.yml': 'eventual-consistency grace window, not a sleep',
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
// "once the CI jobs report". No step anywhere writes it later. Selection
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

  // Same reasoning as `stuck`: nothing else is watching, so a warning in a
  // log nobody reads is the same as saying nothing at all.
  it('fails the step rather than passing with a warning', () => {
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
// `require-foreground-agents.mjs` closed this for delegation after #404 and #406.
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
    hooks?: HookRegistry;
  };

  const registered = (event: string, script: string) => registeredHooks(settings.hooks, event, script);

  // In settings.json, never in agent frontmatter: a frontmatter hook registers
  // only for an agent started through the `Agent` tool, and `/agentic-run`
  // forks into the orchestrator without one. That is how the delegation guard
  // sat inert while #406 died 58 seconds in.
  it('blocks a backgrounded Bash call, from settings.json', () => {
    const entries = registered('PreToolUse', 'require-foreground-bash.mjs');
    expect(
      entries.length,
      'require-foreground-bash.mjs is not a PreToolUse hook — a backgrounded command ' +
      'reports on a turn that never comes'
    ).toBeGreaterThan(0);
    expect(entries.some((entry) => /(^|\|)Bash(\||$)/.test(entry.matcher ?? ''))).toBe(true);
  });

  // Stop is the only guard that acts at the moment the work is actually lost,
  // and SubagentStop matters just as much: a specialist is what runs
  // `npm run scenarios`, so its own turn can end on an unfinished handle.
  it.each(['Stop', 'SubagentStop'])('refuses to end a %s with a long run unfinished', (event) => {
    expect(
      registered(event, 'require-settled-turn.mjs').length,
      `require-settled-turn.mjs is not registered on ${event}`
    ).toBeGreaterThan(0);
  });

  it('keeps the delegation guard that closed #404 and #406', () => {
    expect(registered('PreToolUse', 'require-foreground-agents.mjs').length).toBeGreaterThan(0);
  });

  // The loop budget. Every pipeline loop is bounded by its own count and the
  // counts add up to more than the job holds: runs 565, 591, 606 and 609 each
  // finished TDD inside an hour and iterated for five more until the job clock
  // cut them off. The orchestrator has to be *told* the one clock they share,
  // and only a settings.json PreToolUse hook on delegation both reaches the
  // forked orchestrator and carries `additionalContext` to the model.
  describe('the loop budget reaches the orchestrator before every delegation', () => {
    const run = (env: Record<string, string>) => runHook('report-loop-budget.mjs', '{}', env);

    it('is registered on delegation, from settings.json', () => {
      const entries = registered('PreToolUse', 'report-loop-budget.mjs');
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((entry) => /(^|\|)Agent(\||$)/.test(entry.matcher ?? ''))).toBe(true);
    });

    it('says nothing in a session nobody timed', () => {
      const result = run({});
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('counts the minutes down while the budget is open', () => {
      const result = run({ AGENTIC_LOOP_DEADLINE_EPOCH: String(Math.floor(Date.now() / 1000) + 90 * 60) });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
      expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^LOOP BUDGET: (89|90) min left/);
    });

    it('closes the loops past the deadline without blocking the delegation', () => {
      const result = run({ AGENTIC_LOOP_DEADLINE_EPOCH: String(Math.floor(Date.now() / 1000) - 600) });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, string> };
      expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^LOOP BUDGET CLOSED \(10 min past/);
      expect(parsed.hookSpecificOutput.additionalContext).toContain('Finish the iteration already in flight');
      expect(parsed.hookSpecificOutput).not.toHaveProperty('permissionDecision');
    });

    it('treats a malformed deadline as no deadline', () => {
      const result = run({ AGENTIC_LOOP_DEADLINE_EPOCH: 'soon' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    });
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

// The hourly `agentic-watchdog.yml` cron is the only thing that re-raises a
// red CI once the live session that would have read `[await-ci]` itself has
// exited — and GitHub delivers `schedule` unreliably, with gaps of 3-5 hours
// observed. `agentic-ci-failure.yml` gets a second, event-driven wake-up here:
// `claude-runner.yml`/`opencode-runner.yml` finishing is exactly the moment a
// live session might have just ended, so a `workflow_run` completion on either
// is the earliest honest signal that nobody is left to read the verdict.
//
// `.github/scripts/ci-handback.cjs` carries the pure decision this new job
// calls into — `ci-handback.test.ts` covers that module directly. What is
// pinned here is the wiring: the trigger is widened without touching what the
// existing `nudge` job answers, and the new job fires on the opposite event.
describe('the fail-safe also wakes on runner completion, not only CI', () => {
  const failsafe = workflow('agentic-ci-failure.yml');
  const triggers = failsafe.slice(failsafe.indexOf('\non:'), failsafe.indexOf('\npermissions:'));

  const jobBlock = (source: string, name: string): string => {
    const start = source.indexOf(`\n  ${name}:`);
    if (start === -1) return '';
    const rest = source.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\s*\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  // `workflow_run`'s `workflows:` array matches on the *declared* `name:` of
  // the upstream workflow, not its filename — the same fact
  // `agentic-auto-merge.yml`'s ci.yml-name-drift test above pins for `CI`.
  it('names the runner workflows exactly as they declare themselves', () => {
    const claudeName = /^name:\s*(.+)$/m.exec(workflow('claude-runner.yml'))?.[1]?.trim();
    const opencodeName = /^name:\s*(.+)$/m.exec(workflow('opencode-runner.yml'))?.[1]?.trim();
    expect(claudeName, 'claude-runner.yml has no top-level name:').toBeTruthy();
    expect(opencodeName, 'opencode-runner.yml has no top-level name:').toBeTruthy();
    expect(triggers).toContain(`"${claudeName}"`);
    expect(triggers).toContain(`"${opencodeName}"`);
  });

  it('widens the workflow_run trigger to include both runners alongside CI', () => {
    expect(triggers).toMatch(/workflows:\s*\[[^\]]*"CI"[^\]]*\]/);
    expect(triggers).toMatch(/workflows:\s*\[[^\]]*"Claude Pipeline"[^\]]*\]/);
    expect(triggers).toMatch(/workflows:\s*\[[^\]]*"OpenCode Pipeline"[^\]]*\]/);
  });

  // The existing `nudge` job answers a CI-completion event; a runner
  // completing must route to the new job instead, or the two would both react
  // to the same wake-up and post two comments.
  it("the nudge job's own if: does not also fire on a runner completion", () => {
    const nudge = jobBlock(failsafe, 'nudge');
    const rawIfBlock = /if:\s*>-\s*\n([\s\S]*?)\n\s*runs-on:/.exec(nudge)?.[1] ?? '';
    expect(rawIfBlock, 'nudge job if: not found').not.toBe('');
    // The trailing comment above `runs-on:` documents the exclusion by naming
    // both pipelines, which would mask a regression that widened the
    // *functional* condition itself while leaving that stale comment
    // untouched. Strip comment lines before asserting on the actual if:.
    const ifBlock = rawIfBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(ifBlock).not.toMatch(/Claude Pipeline/);
    expect(ifBlock).not.toMatch(/OpenCode Pipeline/);
    expect(ifBlock).toContain("github.event.workflow_run.name == 'CI'");
  });

  // The new job's whole reason to exist: fire on either runner finishing,
  // whatever it concluded — a successful run can still leave a red channel
  // from an earlier push unanswered, and a failed one is exactly the crash
  // this fail-safe exists for. Scoped to the job's own block, not the whole
  // file — the `on:`/`workflow_run` trigger's explanatory comment also
  // mentions both pipelines and would satisfy a looser match even if this
  // job's own `if:` were wrong or the job were deleted.
  it('carries a new job scoped to runner completion, any conclusion', () => {
    const scanAfterRunner = jobBlock(failsafe, 'scan-after-runner');
    expect(scanAfterRunner, 'scan-after-runner job not found').not.toBe('');
    const ifBlock = /if:\s*>-\s*\n([\s\S]*?)\n\s*runs-on:/.exec(scanAfterRunner)?.[1] ?? '';
    expect(ifBlock, 'scan-after-runner if: not found').not.toBe('');
    expect(ifBlock).toMatch(/Claude Pipeline/);
    expect(ifBlock).toMatch(/OpenCode Pipeline/);
  });

  // Unlike `nudge`, this job re-scans PRs and reads `ci-handback.cjs`, so it
  // needs the workspace checked out — `nudge` deliberately does not.
  it('checks out the repository and drives ci-handback.cjs', () => {
    expect(failsafe).toContain('actions/checkout');
    expect(failsafe).toContain('ci-handback.cjs');
  });

  // Two runners finishing within seconds of each other must not race into two
  // comments on the same PR — the same class of collision `agentic-trigger.yml`
  // and `auto-assign-next.yml` already serialise on `agentic-assignment`.
  it('gives the nudge job a concurrency group keyed on PR/branch identity', () => {
    const nudge = jobBlock(failsafe, 'nudge');
    expect(nudge).toContain('concurrency:');
    const concurrency = nudge.slice(nudge.indexOf('concurrency:'));
    const group = /group:\s*(.+)/.exec(concurrency)?.[1] ?? '';
    expect(group).toMatch(/head_branch|DISPATCH_PR|pr\.number|inputs\.pr/);
  });

  // Re-dispatching the nudge job from the new job needs the scope to fire a
  // `workflow_dispatch` — `nudge`'s own `actions: read` cannot do that. The
  // grant lives on `scan-after-runner`'s own job-level `permissions:`, which
  // replaces the workflow-level block entirely for that job, rather than on
  // the workflow-level block — widening that repo-wide would hand every job
  // `actions: write`, including `nudge`, which never dispatches.
  it('grants actions: write for the re-dispatch', () => {
    const scanAfterRunner = jobBlock(failsafe, 'scan-after-runner');
    expect(scanAfterRunner, 'scan-after-runner job not found').not.toBe('');
    const jobPermissions = scanAfterRunner.slice(
      scanAfterRunner.indexOf('permissions:'),
      scanAfterRunner.indexOf('concurrency:')
    );
    expect(jobPermissions).toContain('actions: write');

    // The top-level grant must stay narrow, or a future regression re-widens
    // it repo-wide instead of scoping it to the one job that needs it.
    const topLevelPermissions = failsafe.slice(failsafe.indexOf('\npermissions:'), failsafe.indexOf('\njobs:'));
    expect(topLevelPermissions).toContain('actions: read');
    expect(topLevelPermissions).not.toContain('actions: write');
  });

  // The two must never name the marker differently, or a comment either side
  // writes would be invisible to the other's attempt count.
  it('shares one MARKER literal with ci-handback.cjs', () => {
    const handback = readFileSync(join(ROOT, '.github/scripts/ci-handback.cjs'), 'utf8');
    const moduleMarker = /const MARKER = '([^']+)'/.exec(handback)?.[1];
    expect(moduleMarker, 'MARKER not found in ci-handback.cjs').toBeTruthy();
    expect(failsafe).toContain(`const MARKER = '${moduleMarker}'`);
  });
});
