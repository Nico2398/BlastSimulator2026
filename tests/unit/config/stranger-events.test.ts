// BlastSimulator2026 — A stranger's event wakes nothing in the pipeline.
//
// The repository is public: any GitHub account can fork it, open a pull
// request, file an issue, edit or close what it filed, and comment anywhere.
// Each of those raises an event, and a workflow subscribed to it runs in this
// repository with this repository's secrets — `pull_request` from a fork being
// the one exception GitHub makes on its own.
//
// The 2026-11-06 audit (outside PRs #2150/#2151) found the pipeline reacting to
// a stranger's event in five places: a comment mention, a pull request's merge
// marker, a fork's pipeline-named branch, the issue form, and the rescue step
// behind a refused mention. `.github/scripts/pipeline-trust.cjs` holds the rule
// and the story. This file holds the inventory: every workflow a stranger's
// event can reach is classified here, by name, and each of its jobs either
// checks who raised the event in its own `if:` — evaluated below against the
// owner's event and a stranger's — or is exempt for a reason written next to it.
// A new workflow on one of these events, or a new job in one, fails here until
// someone classifies it.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { evaluateExpression } from '../../helpers/actionsExpression';

const ROOT = join(import.meta.dirname, '../../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const read = (name: string) => readFileSync(join(WORKFLOWS, name), 'utf8');

/**
 * Events a stranger can raise, directly or through a run of theirs completing:
 * a fork's CI finishing raises `workflow_run` here, with this repository's
 * secrets.
 */
const STRANGER_EVENTS = [
  'issue_comment',
  'pull_request_review_comment',
  'pull_request_review',
  'pull_request_target',
  'pull_request',
  'issues',
  'discussion',
  'discussion_comment',
  'fork',
  'watch',
  'workflow_run',
];

/** The identity clauses a guarded job's `if:` may use. */
const IDENTITY_CLAUSES = [
  "github.event.comment.author_association == 'OWNER'",
  'github.event.sender.login == github.repository_owner',
  'github.event.pull_request.head.repo.full_name == github.repository',
];

/**
 * Jobs that run on a stranger's event on purpose, each with why that is safe.
 * Everything else must be guarded.
 */
const EXEMPT: Record<string, string> = {
  'ci.yml:*':
    'The verification channels. No secrets; a fork\'s runs wait for the owner\'s approval, and the merge gate no longer grants it.',
  'agentic-closing-keyword-guard.yml:*':
    'A read-only check on the pull request body, with no secret and no write.',
  'agentic-intake.yml:label':
    'Runs on a stranger\'s issue to take `ready` back off it, under GITHUB_TOKEN, which raises nothing.',
  'agentic-auto-merge.yml:gate':
    'Woken by any CI completing; re-reads every pull request\'s trust in `agentic-auto-merge/action.yml` before reading its marker.',
  'agentic-ci-failure.yml:nudge':
    'Woken by any CI failing; asks `pipeline-trust.cjs` before it hands anything to an agent (pinned in autonomy-loop.test.ts).',
  'agentic-ci-failure.yml:scan-after-runner':
    'Woken by a runner finishing, which only the owner\'s comment starts; dispatches `nudge`, which asks `pipeline-trust.cjs` itself.',
};

/** The `on:` block of a workflow, as written. */
function triggers(text: string): string[] {
  const start = text.indexOf('\non:');
  if (start === -1) return [];
  const rest = text.slice(start + 4);
  const end = rest.search(/\n[a-z][a-z-]*:/);
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]!);
}

/** Each job's name and its `if:` text, folded or not. */
function jobs(text: string): { name: string; condition: string }[] {
  const body = text.slice(text.indexOf('\njobs:') + '\njobs:'.length);
  const headers = [...body.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)];
  return headers.map((header, i) => {
    const block = body.slice(header.index!, headers[i + 1]?.index ?? body.length);
    const at = block.search(/^ {4}if:/m);
    if (at === -1) return { name: header[1]!, condition: '' };
    const lines = block.slice(at).split('\n');
    const first = lines[0]!.replace(/^ {4}if:\s*/, '');
    const folded = first === '>-' || first === '>' || first === '|';
    // A folded `if:` runs until the first line indented less than its body.
    const following = lines.slice(1);
    const stop = following.findIndex((line) => line.trim() !== '' && !line.startsWith('      '));
    const condition = folded ? following.slice(0, stop === -1 ? following.length : stop).join('\n') : first;
    return { name: header[1]!, condition: condition.replace(/^\$\{\{|\}\}$/g, '').trim() };
  });
}

const reachable = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .filter((name) => triggers(read(name)).some((event) => STRANGER_EVENTS.includes(event)))
  .sort();

describe('every workflow a stranger\'s event reaches is classified', () => {
  it('finds the workflows it is meant to', () => {
    // Read off the tree, so this is only a floor: the runners and the merge
    // gate are where the audit found the gaps.
    expect(reachable).toEqual(expect.arrayContaining(['claude-runner.yml', 'opencode-runner.yml', 'agentic-auto-merge.yml']));
  });

  it.each(reachable)('%s: each job checks who raised the event, or says why it need not', (name) => {
    const text = read(name);
    for (const job of jobs(text)) {
      const key = `${name}:${job.name}`;
      const exempt = EXEMPT[key] ?? EXEMPT[`${name}:*`];
      if (exempt) continue;
      expect(
        IDENTITY_CLAUSES.some((clause) => job.condition.includes(clause)),
        `${key} runs on a stranger's event with no identity check in its \`if:\` — guard it, or exempt it here with a reason`
      ).toBe(true);
    }
  });

  it('exempts nothing that no longer exists', () => {
    for (const key of Object.keys(EXEMPT)) {
      const [name, job] = key.split(':') as [string, string];
      expect(reachable, `${key}: the workflow no longer runs on a stranger's event`).toContain(name);
      if (job !== '*') expect(jobs(read(name)).map((j) => j.name), key).toContain(job);
    }
  });
});

// Matching the clause proves it was written; evaluating the whole `if:` proves
// it is what decides. Each guarded job sees the same event twice, once raised by
// the owner and once by a stranger, and only the owner's may run it.
describe('each guard admits the owner and refuses a stranger', () => {
  const OWNER = { login: 'Nico2398', type: 'User' };
  const STRANGER = { login: 'battle-mage', type: 'User' };
  const vars = { AGENTIC_AUTO_MERGE_ENABLED: 'true', AGENTIC_AUTO_ASSIGN_ENABLED: 'true', CLAUDE_REVIEW_ENABLED: 'true' };

  const event = (who: 'owner' | 'stranger', eventName: string, action: string, head = 'pipeline/feature-1-2') => {
    const user = who === 'owner' ? OWNER : STRANGER;
    const association = who === 'owner' ? 'OWNER' : 'NONE';
    const repo = who === 'owner' ? 'Nico2398/BlastSimulator2026' : 'battle-mage/BlastSimulator2026';
    return {
      github: {
        event_name: eventName,
        repository: 'Nico2398/BlastSimulator2026',
        repository_owner: 'Nico2398',
        head_ref: head,
        event: {
          action,
          sender: user,
          label: { name: 'blocked' },
          changes: { body: { from: 'before' } },
          comment: { body: '@claude @opencode please look', user, author_association: association },
          issue: { number: 2143, labels: [{ name: 'agent-task' }, { name: 'in-progress' }, { name: 'blocked' }] },
          pull_request: {
            number: 2150,
            draft: false,
            merged: true,
            body: 'READY TO MERGE',
            user,
            author_association: association,
            head: { ref: head, repo: { full_name: repo } },
          },
        },
      },
      vars,
      inputs: {},
    };
  };

  // The event each guarded job is written for, so the owner's copy passes
  // every other clause and the identity clause alone is left to decide.
  const SCENARIOS: Record<string, { eventName: string; action: string; head?: string }> = {
    'claude-runner.yml:run': { eventName: 'issue_comment', action: 'created' },
    'opencode-runner.yml:run': { eventName: 'issue_comment', action: 'created' },
    'claude-code-review.yml:claude-review': { eventName: 'pull_request', action: 'opened', head: 'feature/hand-written' },
    'auto-assign-next.yml:wake-merge-gate': { eventName: 'pull_request', action: 'edited' },
    'auto-assign-next.yml:chain-next-task': { eventName: 'pull_request', action: 'closed' },
    'handle-failure.yml:chain': { eventName: 'issues', action: 'labeled' },
    'handle-failure.yml:notify': { eventName: 'issues', action: 'labeled' },
    'handle-failure.yml:reconcile-dependencies': { eventName: 'issues', action: 'edited' },
    'agentic-chain-on-close.yml:chain': { eventName: 'issues', action: 'closed' },
    'agentic-intake.yml:scope-colors': { eventName: 'issues', action: 'closed' },
  };

  const guarded = reachable.flatMap((name) =>
    jobs(read(name))
      .filter((job) => !EXEMPT[`${name}:${job.name}`] && !EXEMPT[`${name}:*`])
      .map((job) => ({ key: `${name}:${job.name}`, condition: job.condition }))
  );

  it('has a scenario for every guarded job', () => {
    expect(guarded.map((g) => g.key).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });

  it.each(guarded.map((g) => [g.key, g.condition] as const))('%s', (key, condition) => {
    const scenario = SCENARIOS[key]!;
    const owner = event('owner', scenario.eventName, scenario.action, scenario.head);
    const stranger = event('stranger', scenario.eventName, scenario.action, scenario.head);
    expect(Boolean(evaluateExpression(condition, owner as never)), `${key}: the owner's own event no longer runs it`).toBe(true);
    expect(Boolean(evaluateExpression(condition, stranger as never)), `${key}: a stranger's event runs it`).toBe(false);
  });
});
