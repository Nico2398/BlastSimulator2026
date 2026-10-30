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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { step, stepFor, withProgressLine } from '../../../scripts/lib/pipeline/steps.js';
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

type TranscriptRecord = { type: string; timestamp: string; message: { id: string; model?: string; usage?: object } };

/** Records whose last prompt is `promptTokens`, with `afterSince` API responses after SINCE. */
function records(promptTokens: number, afterSince: number, model = 'claude-sonnet-5-5'): TranscriptRecord[] {
  const usage = { input_tokens: 10, cache_read_input_tokens: promptTokens - 10, cache_creation_input_tokens: 0 };
  const list: TranscriptRecord[] = [{ type: 'assistant', timestamp: '2026-10-24T09:59:00.000Z', message: { id: 'before', model, usage } }];
  for (let i = 0; i < afterSince; i += 1) {
    const timestamp = new Date(Date.parse(SINCE) + (i + 1) * 1000).toISOString();
    // A response streamed as two records shares one message id and counts once.
    list.push({ type: 'assistant', timestamp, message: { id: `m${i}`, model, usage } }, { type: 'assistant', timestamp, message: { id: `m${i}`, model, usage } });
  }
  return list;
}

function writeRecords(path: string, list: TranscriptRecord[]): string {
  writeFileSync(path, `${list.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return path;
}

/** The main session's transcript. */
function transcript(promptTokens: number, afterSince = 0): string {
  return writeRecords(join(project, 'session.jsonl'), records(promptTokens, afterSince));
}

/** A sub-agent transcript of the session above, written after it, as a fork or a delegation writes one. */
function agentTranscript(agentType: string, promptTokens: number, afterSince = 0, model?: string): void {
  const dir = join(project, 'session', 'subagents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-a${agentType}.meta.json`), JSON.stringify({ agentType }));
  const path = writeRecords(join(dir, `agent-a${agentType}.jsonl`), records(promptTokens, afterSince, model));
  const later = new Date(Date.now() + 60_000);
  utimesSync(path, later, later);
}

function marker(heavy: boolean): void {
  writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement', since: SINCE, heavy }));
}

function compact(fields: Record<string, unknown>, env: NodeJS.ProcessEnv = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' }) {
  const result = runHook(HOOK, JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', ...fields }), { CLAUDE_PROJECT_DIR: project, ...env });
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

  it('lets the pipeline commands open their own steps, the heavy ones marked heavy', () => {
    stepFor(project, 'tdd start', '42-7');
    stepFor(project, 'tdd split', '42-7');
    expect(JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8'))).toMatchObject({ name: 'tdd: tests', heavy: false });
    stepFor(project, 'tdd red', '42-7');
    expect(JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8'))).toMatchObject({ name: 'tdd: implement', heavy: true });
    stepFor(project, 'tdd join', '42-7');
    expect(JSON.parse(readFileSync(join(project, '.agentic/step.json'), 'utf8'))).toMatchObject({ name: 'verify and finalize', heavy: false });
    expect(readFileSync(join(project, '.agentic/plan/42-7.md'), 'utf8')).toMatch(/- tdd: plan and skeleton done — [0-9a-f]+\n- tdd: tests done — [0-9a-f]+\n- tdd: implement done — /);
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

  it('outside a step, waits until the context is near full', () => {
    expect(compact({ transcript_path: transcript(100_000, 3) }).stdout).toContain('waits until 500k');
    expect(compact({ transcript_path: transcript(520_000, 3) }).blocked).toBe(false);
  });

  it('leaves a session the runner did not shrink, or one with no readable transcript, to Claude Code', () => {
    expect(compact({ transcript_path: transcript(100_000, 3) }, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' }).blocked).toBe(false);
    expect(compact({}).blocked).toBe(false);
  });

  it('allows at the boundary before a heavy step once the context passed the heavy floor', () => {
    marker(true);
    expect(compact({ transcript_path: transcript(100_000, 0) }).blocked).toBe(false);
    expect(compact({ transcript_path: transcript(100_000, 1) }).blocked).toBe(false);
    expect(compact({ transcript_path: transcript(60_000, 1) }).blocked).toBe(true);
  });

  it('refuses at the boundary before a light step until the context is near full', () => {
    marker(false);
    const light = compact({ transcript_path: transcript(100_000, 1) });
    expect(light.status).toBe(0);
    expect(light.blocked).toBe(true);
    expect(light.stdout).toContain('tdd:6 implement');
    expect(compact({ transcript_path: transcript(520_000, 1) }).blocked).toBe(false);
  });

  it('refuses inside a step, heavy or not, until the mid-step valve', () => {
    marker(true);
    const inside = compact({ transcript_path: transcript(600_000, 2) });
    expect(inside.blocked).toBe(true);
    expect(inside.stdout).toContain('in flight');
    expect(compact({ agent_type: 'orchestrator', transcript_path: transcript(600_000, 2) }).blocked).toBe(true);
    expect(compact({ transcript_path: transcript(860_000, 2) }).blocked).toBe(false);
  });

  it('treats a marker without a start time as mid-step', () => {
    writeFileSync(join(project, '.agentic/step.json'), JSON.stringify({ label: '42-7', name: 'tdd:6 implement', heavy: true }));
    expect(compact({ transcript_path: transcript(520_000, 0) }).blocked).toBe(true);
  });

  it('judges a forked orchestrator by its own transcript, not the idle main session', () => {
    marker(true);
    const main = transcript(20_000, 0);
    agentTranscript('orchestrator', 600_000, 3);
    expect(compact({ transcript_path: main }).stdout).toContain('in flight');
    agentTranscript('orchestrator', 860_000, 3);
    expect(compact({ transcript_path: main }).blocked).toBe(false);
    agentTranscript('orchestrator', 100_000, 0);
    expect(compact({ transcript_path: main }).blocked).toBe(false);
  });

  it('holds a sub-agent to the near-full rule by its own transcript, capped for a small window', () => {
    marker(true);
    const main = transcript(20_000, 0);
    agentTranscript('visual-tester', 150_000, 0);
    expect(compact({ transcript_path: main }).stdout).toContain('waits until 500k');
    agentTranscript('visual-tester', 520_000, 0);
    expect(compact({ transcript_path: main }).blocked).toBe(false);
    agentTranscript('Explore', 170_000, 0, 'claude-haiku-5-5');
    expect(compact({ transcript_path: main }).blocked).toBe(false);
  });

  it('skips API-error records for the prompt size, and allows when the transcript ends on one', () => {
    marker(false);
    const path = join(project, 'session.jsonl');
    const synthetic = (id: string): TranscriptRecord => ({ type: 'assistant', timestamp: '2026-10-24T10:00:30.000Z', message: { id, model: '<synthetic>', usage: { input_tokens: 0 } } });
    const grown = records(600_000, 3);
    writeRecords(path, [...grown.slice(0, 2), synthetic('e1'), ...grown.slice(2)]);
    expect(compact({ transcript_path: path }).stdout).toContain('in flight');
    writeRecords(path, [...grown, synthetic('e2')]);
    expect(compact({ transcript_path: path }).blocked).toBe(false);
  });

  it('allows manual compaction', () => {
    marker(false);
    expect(compact({ trigger: 'manual' }).blocked).toBe(false);
  });
});

describe('registration', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as { hooks?: HookRegistry };

  it('gates automatic compaction from settings.json', () => {
    const entries = (settings.hooks?.PreCompact ?? []).filter((entry) => entry.matcher === 'auto');
    expect(entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hookScript(hook))).some((s) => s.endsWith(`/${HOOK}`))).toBe(true);
  });
});
