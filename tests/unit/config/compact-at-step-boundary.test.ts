// BlastSimulator2026 — Automatic compaction runs between pipeline steps
//
// The runner makes a compaction due early (the smallest auto-compact window),
// and `compact-at-step-boundary.mjs` refuses it while `npm run pipeline --
// step` says a step is in flight. Claude Code asks again on every request
// (measured: a refused compaction was re-requested on each of the following
// requests and ran on the first one after the marker went), so it lands at the
// next boundary. These cases pin the hook's verdicts and the `step` command.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { step, withProgressLine } from '../../../scripts/lib/pipeline/steps.js';
import { hookScript, runHook, type HookRegistry } from '../../helpers/claudeHooks';

const ROOT = join(import.meta.dirname, '../../..');
const HOOK = 'compact-at-step-boundary.mjs';
let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'step-boundary-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: project });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function transcript(promptTokens: number): string {
  const path = join(project, 'transcript.jsonl');
  writeFileSync(path, `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: promptTokens - 10, cache_creation_input_tokens: 0 } } })}\n`);
  return path;
}

function compact(fields: Record<string, unknown>) {
  const result = runHook(HOOK, JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', ...fields }), { CLAUDE_PROJECT_DIR: project });
  return { status: result.status, blocked: result.stdout.includes('"decision":"block"'), stdout: result.stdout };
}

describe('step boundaries', () => {
  it('records each finished step in the plan and holds the marker for the one in flight', () => {
    step(project, '42-7', 'tdd:1 plan');
    expect(JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8'))).toMatchObject({ label: '42-7', name: 'tdd:1 plan' });
    step(project, '42-7', 'tdd:3 skeleton', 'none');
    step(project, '42-7', 'done');
    const plan = readFileSync(join(project, '.agentic/plan/42-7.md'), 'utf8');
    expect(plan).toMatch(/## Progress\n- tdd:1 plan done — [0-9a-f]+ — none\n- tdd:3 skeleton done — [0-9a-f]+\n/);
    expect(existsSync(join(project, '.agentic/step.json'))).toBe(false);
  });

  it('appends under an existing Progress section, before the next heading', () => {
    expect(withProgressLine('# Plan\n## Progress\n- a done\n## Notes\nx\n', '- b done')).toBe('# Plan\n## Progress\n- a done\n- b done\n## Notes\nx\n');
    expect(withProgressLine('# Plan\n', '- a done')).toBe('# Plan\n\n## Progress\n- a done\n');
  });

  it('rejects a label or step name unsafe on disk', () => {
    expect(() => step(project, '../x', 'plan')).toThrow();
    expect(() => step(project, '42-7', 'plan; rm -rf /')).toThrow();
  });
});

describe('the gating hook', () => {
  beforeEach(() => {
    mkdirSync(join(project, '.agentic'), { recursive: true });
  });

  it('allows a compaction when no step is in flight', () => {
    expect(compact({}).blocked).toBe(false);
  });

  it('refuses the lead\'s automatic compaction mid-step, naming the step', () => {
    writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement' }));
    const lead = compact({ transcript_path: transcript(150_000) });
    expect(lead.status).toBe(0);
    expect(lead.blocked).toBe(true);
    expect(lead.stdout).toContain('tdd:6 implement');
    expect(compact({ agent_type: 'orchestrator' }).blocked).toBe(true);
  });

  it('allows manual compaction, sub-agents, and a lead near the hard limit', () => {
    writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement' }));
    expect(compact({ trigger: 'manual' }).blocked).toBe(false);
    expect(compact({ agent_type: 'test-writer' }).blocked).toBe(false);
    expect(compact({ transcript_path: transcript(650_000) }).blocked).toBe(false);
  });
});

describe('registration', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as { hooks?: HookRegistry };

  it('gates automatic compaction from settings.json', () => {
    const entries = (settings.hooks?.PreCompact ?? []).filter((entry) => entry.matcher === 'auto');
    expect(entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hookScript(hook))).some((s) => s.endsWith(`/${HOOK}`))).toBe(true);
  });
});
