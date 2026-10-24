// BlastSimulator2026 — Automatic compaction runs between pipeline steps
//
// The runner makes Claude Code ask for a compaction early (the smallest
// auto-compact window), and `compact-at-step-boundary.mjs` decides: allow in
// the first requests after `npm run pipeline -- step` when the step ahead is
// heavy or the context is near full, refuse inside a step unless it nears the
// hard limit. Claude Code asks again on every refused request, so a refused
// compaction lands at the next boundary that allows it. These cases pin the
// hook's verdicts and the `step` command.

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

const SINCE = '2026-10-24T10:00:00.000Z';

/** A lead transcript whose last prompt is `promptTokens`, with `afterSince` API responses after SINCE. */
function transcript(promptTokens: number, afterSince = 0): string {
  const path = join(project, 'transcript.jsonl');
  const usage = { input_tokens: 10, cache_read_input_tokens: promptTokens - 10, cache_creation_input_tokens: 0 };
  const records = [{ type: 'assistant', timestamp: '2026-10-24T09:59:00.000Z', message: { id: 'before', usage } }];
  for (let i = 0; i < afterSince; i += 1) {
    const timestamp = new Date(Date.parse(SINCE) + (i + 1) * 1000).toISOString();
    // A response streamed as two records shares one message id and counts once.
    records.push({ type: 'assistant', timestamp, message: { id: `m${i}`, usage } }, { type: 'assistant', timestamp, message: { id: `m${i}`, usage } });
  }
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return path;
}

function marker(heavy: boolean): void {
  writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement', since: SINCE, heavy }));
}

function compact(fields: Record<string, unknown>) {
  const result = runHook(HOOK, JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', ...fields }), { CLAUDE_PROJECT_DIR: project });
  return { status: result.status, blocked: result.stdout.includes('"decision":"block"'), stdout: result.stdout };
}

describe('step boundaries', () => {
  it('records each finished step in the plan and holds the marker for the one in flight', () => {
    step(project, '42-7', 'tdd:1 plan');
    expect(JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8'))).toMatchObject({ label: '42-7', name: 'tdd:1 plan', heavy: false });
    step(project, '42-7', 'tdd:6 implement', undefined, true);
    const heavy = JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8')) as { heavy: boolean; since: string };
    expect(heavy.heavy).toBe(true);
    expect(Number.isFinite(Date.parse(heavy.since))).toBe(true);
    step(project, '42-7', 'done', 'none');
    const plan = readFileSync(join(project, '.agentic/plan/42-7.md'), 'utf8');
    expect(plan).toMatch(/## Progress\n- tdd:1 plan done — [0-9a-f]+\n- tdd:6 implement done — [0-9a-f]+ — none\n/);
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

  it('allows at the boundary before a heavy step once the context passed the heavy floor', () => {
    marker(true);
    expect(compact({ transcript_path: transcript(100_000, 1) }).blocked).toBe(false);
    expect(compact({ transcript_path: transcript(60_000, 1) }).blocked).toBe(true);
  });

  it('refuses at the boundary before a light step until the context is near full', () => {
    marker(false);
    const light = compact({ transcript_path: transcript(100_000, 2) });
    expect(light.status).toBe(0);
    expect(light.blocked).toBe(true);
    expect(light.stdout).toContain('tdd:6 implement');
    expect(compact({ transcript_path: transcript(520_000, 2) }).blocked).toBe(false);
  });

  it('refuses inside a step, heavy or not, until the mid-step valve', () => {
    marker(true);
    const inside = compact({ transcript_path: transcript(600_000, 3) });
    expect(inside.blocked).toBe(true);
    expect(inside.stdout).toContain('in flight');
    expect(compact({ agent_type: 'orchestrator', transcript_path: transcript(600_000, 3) }).blocked).toBe(true);
    expect(compact({ transcript_path: transcript(860_000, 3) }).blocked).toBe(false);
  });

  it('treats a marker without a start time as mid-step', () => {
    writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement', heavy: true }));
    expect(compact({ transcript_path: transcript(520_000, 0) }).blocked).toBe(true);
  });

  it('allows manual compaction and sub-agents', () => {
    marker(false);
    expect(compact({ trigger: 'manual' }).blocked).toBe(false);
    expect(compact({ agent_type: 'test-writer' }).blocked).toBe(false);
  });
});

describe('registration', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as { hooks?: HookRegistry };

  it('gates automatic compaction from settings.json', () => {
    const entries = (settings.hooks?.PreCompact ?? []).filter((entry) => entry.matcher === 'auto');
    expect(entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hookScript(hook))).some((s) => s.endsWith(`/${HOOK}`))).toBe(true);
  });
});
