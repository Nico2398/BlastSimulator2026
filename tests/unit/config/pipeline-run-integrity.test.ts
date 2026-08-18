// BlastSimulator2026 — A pipeline run reaches a terminal state
//
// Twice now a run has ended without producing anything and without saying so.
// Issue #404 was cut off at three hours with 2h08 of finished work on a branch
// that never reached the remote. Issue #406 ended 58 seconds in: the orchestrator
// launched @planner in the background, printed "waiting for it to complete", and
// ended its turn — a runner takes exactly one turn, so the process exited with
// `num_turns: 0` and the notification it was waiting for never came. Both left
// their issue holding `in-progress`, which defers every later assignment behind
// a run that no longer exists.
//
// Three mechanisms stop that, and each is invisible when it silently stops
// working — which is exactly how the first fix for #404 failed: the guard was
// declared in the orchestrator's frontmatter, where the orchestrator's own
// session never registers it. These tests pin all three.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const GUARD = join(ROOT, '.claude/hooks/require-foreground-agents.sh');

const workflow = (name: string): string =>
  readFileSync(join(ROOT, '.github/workflows', name), 'utf8');
const action = (name: string): string =>
  readFileSync(join(ROOT, '.github/actions', name, 'action.yml'), 'utf8');
const settings = (): {
  hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]>;
} => JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8'));

/** Both runners must behave identically — the pipeline swaps between them. */
const RUNNERS = ['claude-runner.yml', 'opencode-runner.yml'];

interface HookRun {
  status: number;
  stderr: string;
}

/** Runs the PreToolUse guard against a tool-input payload, as Claude Code does. */
function runGuard(toolInput: unknown, env: Record<string, string> = {}): HookRun {
  const payload =
    typeof toolInput === 'string'
      ? toolInput
      : JSON.stringify({ tool_name: 'Agent', tool_input: toolInput });
  try {
    execFileSync(GUARD, {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' };
  }
}

describe('foreground delegation guard', () => {
  // The trap: omitting the parameter is not neutral. `run_in_background`
  // defaults to true, so the call the model is most likely to write is the one
  // that loses the run.
  it('blocks a delegation that leaves run_in_background unset', () => {
    const result = runGuard({ subagent_type: 'planner', prompt: 'plan issue 406' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('run_in_background was not set');
    expect(result.stderr).toContain('run_in_background: false');
  });

  it('blocks a delegation that asks for the background explicitly', () => {
    const result = runGuard({ subagent_type: 'planner', run_in_background: true });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('run_in_background was set to true');
  });

  it('allows a synchronous delegation', () => {
    expect(runGuard({ subagent_type: 'planner', run_in_background: false }).status).toBe(0);
  });

  // Parallel delegation is how the pipeline runs its reviewers, and it must stay
  // available: several calls in one message, every one of them foreground.
  it('allows several synchronous delegations issued together', () => {
    for (const agent of ['quality-reviewer', 'security-reviewer', 'i18n-reviewer']) {
      expect(runGuard({ subagent_type: agent, run_in_background: false }).status).toBe(0);
    }
  });

  // A guard that blocks on a payload it cannot parse would halt the pipeline
  // outright. The rule still lives in the skill bodies; this fails open.
  it('allows a payload it cannot parse rather than halting the pipeline', () => {
    expect(runGuard('not json at all').status).toBe(0);
  });

  // Blocking is the default so that a runner cannot lose a run to an
  // environment variable that failed to arrive. Interactive sessions opt out.
  it('gets out of the way when a human opts into background agents', () => {
    const result = runGuard(
      { subagent_type: 'planner' },
      { AGENTIC_ALLOW_BACKGROUND_AGENTS: '1' }
    );
    expect(result.status).toBe(0);
  });
});

describe('foreground guard registration', () => {
  // The whole point. Declared in `.claude/agents/orchestrator.md` this hook is
  // inert: frontmatter hooks are registered by the code that starts a sub-agent
  // through the `Agent` tool, and `/agentic-run` forks the session into the
  // orchestrator without one. settings.json hooks do fire in the runner — the
  // SessionStart hook next to it ran in the same job that lost issue #406.
  it('is registered as a PreToolUse hook in settings.json', () => {
    const entries = settings().hooks?.PreToolUse ?? [];
    const guards = entries.filter((entry) =>
      (entry.hooks ?? []).some((hook) =>
        (hook.command ?? '').endsWith('require-foreground-agents.sh')
      )
    );
    expect(guards.length).toBeGreaterThan(0);
  });

  it('matches both spellings of the delegation tool', () => {
    const entries = settings().hooks?.PreToolUse ?? [];
    const guards = entries.filter((entry) =>
      (entry.hooks ?? []).some((hook) =>
        (hook.command ?? '').endsWith('require-foreground-agents.sh')
      )
    );
    for (const tool of ['Agent', 'Task']) {
      expect(
        guards.some((entry) => new RegExp(entry.matcher ?? '.*').test(tool)),
        `no PreToolUse matcher covers the ${tool} tool`
      ).toBe(true);
    }
  });

  it('is proven wired by validate:context, not merely proven to exist', () => {
    const validator = readFileSync(join(ROOT, 'scripts/validate-context.ts'), 'utf8');
    expect(validator).toContain('require-foreground-agents.sh');
    expect(validator).toContain('SETTINGS_HOOKS');
    expect(validator).toMatch(/issues\.push\(\.\.\.checkSettings\(\)\)/);
  });
});

// Volumetric work — the same edit across N files — is what spends a job budget.
// #554's run 166 walked 94 files one at a time and was cancelled at 360 minutes
// with nothing pushed; #553's run before it ended the same way. The fan-out is a
// procedure, and a procedure that lives in only one of the three runtime trees is
// a procedure two runtimes do not have.
describe('volumetric work fans out instead of iterating', () => {
  const TDD_SKILL = 'skills/agentic-pipeline-tdd/SKILL.md';

  it.each(['.claude', '.github', '.opencode'])('%s carries the batch procedure', (runtime) => {
    const text = readFileSync(join(ROOT, runtime, TDD_SKILL), 'utf8');
    expect(text).toContain('Volumetric work goes out in parallel batches');
    // The three properties that make it safe on a runner: one message so every
    // batch is awaited in the turn that issued it, disjoint files so two agents
    // never edit one file, and no commit inside a batch so they cannot race the
    // index.
    expect(text).toContain('Delegate every batch in a single message');
    expect(text).toContain('disjoint by file');
    expect(text).toContain('commits nothing');
  });

  // The browser harness is the most expensive thing the pipeline runs, so the
  // visual loop is where fanning out is worth the most.
  it.each(['.claude', '.github', '.opencode'])('%s points the visual loop at it', (runtime) => {
    const text = readFileSync(join(ROOT, runtime, 'skills/agentic-pipeline-full/SKILL.md'), 'utf8');
    expect(text).toContain('Volumetric iterations fan out');
  });

  // Fanning out only helps if the branches are the run's own; otherwise the wave
  // finishes into a branch the rescue cannot push (#554).
  it.each(['.claude', '.github', '.opencode'])('%s ties the label to the run id', (runtime) => {
    const text = readFileSync(join(ROOT, runtime, TDD_SKILL), 'utf8');
    expect(text).toContain('`<label>` is `<issue>-<runId>`');
    expect(text).toContain('Never reuse a branch from an earlier run');
  });
});

describe('a run that settles nothing is retried', () => {
  it('measures the terminal state of every issue-backed run', () => {
    for (const name of RUNNERS) {
      const text = workflow(name);
      expect(text, name).toContain('uses: ./.github/actions/agentic-run-state');
      // `always()`: a crashed or failed attempt is the case worth catching.
      expect(text, name).toMatch(/if: always\(\) && steps\.context\.outputs\.issue != ''/);
    }
  });

  it('spends the job budget from a start time recorded first', () => {
    for (const name of RUNNERS) {
      const text = workflow(name);
      const steps = text.slice(text.indexOf('steps:'));
      expect(steps.indexOf('started_at=$(date +%s)'), name).toBeLessThan(
        steps.indexOf('actions/checkout')
      );
      expect(text, name).toContain('started_at: ${{ steps.clock.outputs.started_at }}');
    }
  });

  // The budget the retry gate spends and the budget the job actually has are two
  // numbers in two places. Drift between them is silent and only shows up as a
  // retry started with no room to finish, which loses the branch it was retrying.
  it('spends the same budget the job timeout actually grants', () => {
    for (const name of RUNNERS) {
      const text = workflow(name);
      const timeout = /timeout-minutes:\s*(\d+)/.exec(text)?.[1];
      const budget = /budget_minutes:\s*'(\d+)'/.exec(text)?.[1];
      expect(timeout, name).toBeDefined();
      expect(budget, `${name}: budget_minutes must match timeout-minutes`).toBe(timeout);
    }
  });

  // No `success()` in the condition, deliberately: the retry must fire when the
  // attempt reported success having produced nothing, which is what #406 did.
  it('retries on the state verdict alone, not on the attempt exit code', () => {
    for (const name of RUNNERS) {
      expect(workflow(name), name).toContain("if: steps.state.outputs.retry == 'true'");
    }
  });

  it('tells the retry what the previous attempt left unpushed on disk', () => {
    for (const name of RUNNERS) {
      expect(workflow(name), name).toContain('steps.state.outputs.branch_state');
    }
  });

  it('names the failure mode the retry has to avoid', () => {
    expect(workflow('claude-runner.yml')).toContain('Every delegation is synchronous');
  });

  it('never retries without enough clock left to reach a PR', () => {
    const text = action('agentic-run-state');
    expect(text).toContain('min_remaining_minutes');
    expect(text).toContain('budget - elapsed');
  });

  it('treats a PR, a `blocked` label and a closed issue as terminal', () => {
    const text = action('agentic-run-state');
    expect(text).toContain("issue.state === 'closed'");
    expect(text).toContain("labels.has('blocked')");
    // The PR arm uses the deliverable predicate — the run's own branch or a
    // closing reference, never a timeline mention (#568). Its full shape is
    // pinned across every copy in autonomy-loop.test.ts.
    expect(text).toContain('closedByPullRequestsReferences');
    expect(text).toContain('pipeline/feature-${issueNumber}');
  });
});

describe('an unfinished run releases the assignment chain', () => {
  const rescue = action('agentic-rescue');

  it('labels the issue `blocked` and drops `in-progress`', () => {
    expect(rescue).toContain('gh issue edit "${ISSUE}" --add-label blocked');
    expect(rescue).toContain('gh issue edit "${ISSUE}" --remove-label in-progress');
  });

  // Four ways a run reaches the rescue step without a deliverable: no branch, an
  // empty branch, a branch that could not be pushed, and a branch saved into a
  // draft PR that nobody has reviewed. Every one of them has to settle the issue,
  // because by then the session is over and nothing is left to wait for.
  it('escalates on every outcome that is not a finished run', () => {
    const calls = rescue.match(/^\s+escalate$/gm) ?? [];
    expect(calls.length).toBe(4);
  });

  it('leaves a run that opened its own PR alone', () => {
    const finished = rescue.indexOf('the run finished. Nothing to rescue');
    expect(finished).toBeGreaterThan(-1);
    expect(rescue.slice(0, finished)).not.toMatch(/^\s+escalate$/m);
  });

  it('does not escalate an issue the run already settled itself', () => {
    expect(rescue).toContain('is already closed');
    expect(rescue).toContain('Not escalating twice');
  });

  it('runs after the retry, so it judges the last attempt', () => {
    for (const name of RUNNERS) {
      const text = workflow(name);
      expect(text.indexOf('agentic-rescue'), name).toBeGreaterThan(
        text.indexOf('Retry the run when the first attempt settled nothing')
      );
    }
  });
});
