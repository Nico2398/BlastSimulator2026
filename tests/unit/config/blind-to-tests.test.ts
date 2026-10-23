// BlastSimulator2026 — The blind phase is enforced, not requested
//
// The lead session writes the skeleton and the implementation; a test-writer
// sub-agent writes the tests in their own worktree. What keeps the
// implementation from being shaped by the tests is `blind-to-tests.mjs`: while
// `npm run pipeline -- tdd split` has a blind marker open, any file or shell
// tool call reaching the tests worktree or branch is refused, for every caller
// except the test-writer. These cases drive the hook the way Claude Code does.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hookScript, runHook, type HookRegistry } from '../../helpers/claudeHooks';

const ROOT = join(import.meta.dirname, '../../..');
const HOOK = 'blind-to-tests.mjs';

let project: string;
const worktree = '/work/BlastSimulator2026-tests-42-7';
// Built so the repo-wide dangling-reference lint does not read it as one of ours.
const TEST = ['tests', 'unit', 'score.test.ts'].join('/');

function call(tool: string, input: Record<string, unknown>, agentType?: string) {
  const payload = { tool_name: tool, tool_input: input, ...(agentType ? { agent_type: agentType } : {}) };
  return runHook(HOOK, JSON.stringify(payload), { CLAUDE_PROJECT_DIR: project });
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'blind-hook-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('with no blind phase open', () => {
  it('allows everything', () => {
    expect(call('Read', { file_path: `${worktree}/${TEST}` }).status).toBe(0);
  });
});

describe('with a blind phase open', () => {
  beforeEach(() => {
    mkdirSync(join(project, '.agentic', 'tdd'), { recursive: true });
    writeFileSync(
      join(project, '.agentic', 'tdd', 'blind.json'),
      JSON.stringify({ label: '42-7', testsBranch: 'pipeline/tests-42-7', worktree })
    );
  });

  it.each([
    ['Read', { file_path: `${worktree}/${TEST}` }],
    ['Grep', { pattern: 'score', path: worktree }],
    ['Glob', { pattern: '../BlastSimulator2026-tests-42-7/**/*.test.ts' }],
    ['Bash', { command: `git show pipeline/tests-42-7:${TEST}` }],
    ['Bash', { command: 'git log --all --stat' }],
    ['Bash', { command: `cat ${worktree}/${TEST}` }],
  ])('refuses the implementing session %s %j', (tool, input) => {
    const run = call(tool, input);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('tdd join');
  });

  it('refuses a sub-agent that is not the test-writer — fails closed', () => {
    expect(call('Read', { file_path: `${worktree}/${TEST}` }, 'batch-worker').status).toBe(2);
    expect(call('Read', { file_path: `${worktree}/${TEST}` }, 'orchestrator').status).toBe(2);
  });

  it('lets the test-writer work in its worktree', () => {
    expect(call('Read', { file_path: `${worktree}/${TEST}` }, 'test-writer').status).toBe(0);
    expect(call('Bash', { command: `cd ${worktree} && npx vitest run ${TEST}` }, 'test-writer').status).toBe(0);
  });

  it('leaves the implementing session its own tree and the join itself', () => {
    expect(call('Read', { file_path: '/work/BlastSimulator2026/src/core/config/balance.ts' }).status).toBe(0);
    expect(call('Bash', { command: 'npm run pipeline -- tdd join --label 42-7' }).status).toBe(0);
    expect(call('Bash', { command: 'git log --oneline -3' }).status).toBe(0);
  });
});

describe('registration', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as { hooks?: HookRegistry };

  // settings.json, not an agent's frontmatter: the orchestrator is entered by
  // `/agentic-run` forking into it, and frontmatter hooks only register for
  // agents started through the Agent tool.
  it.each(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'NotebookEdit'])('guards %s from settings.json', (tool) => {
    const guards = (settings.hooks?.PreToolUse ?? []).filter((entry) => new RegExp(`^(${entry.matcher ?? '.*'})$`).test(tool));
    const scripts = guards.flatMap((entry) => (entry.hooks ?? []).map((hook) => hookScript(hook)));
    expect(scripts.some((script) => script.endsWith(`/${HOOK}`))).toBe(true);
  });
});
