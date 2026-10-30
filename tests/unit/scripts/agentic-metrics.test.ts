// BlastSimulator2026 — Run metrics from Claude Code transcripts
//
// The runner exports these records as an artifact and appends them to a
// public branch, so two properties matter as much as the numbers: nothing
// free-form leaves the runner (commands become categories, unknown names
// become `other`), and the cost the records report is Claude Code's own
// `cost-state`, shared out across agents rather than re-priced here.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { bashCategory } from '../../../scripts/lib/metrics/bash-category.js';
import { extractMetrics, usageTokens } from '../../../scripts/lib/metrics/extract.js';
import { newLines, publish } from '../../../scripts/lib/metrics/publish.js';
import { aggregateReport, runSummary } from '../../../scripts/lib/metrics/report.js';
import { parseJsonl, type SessionTranscript, type TranscriptRecord } from '../../../scripts/lib/metrics/transcripts.js';

const SCRIPTS = new Set(['test', 'long', 'pipeline', 'typecheck']);
const VOCAB = { scripts: SCRIPTS, skills: new Set(['agentic-pipeline-full', 'agentic-pipeline-tdd']), agents: new Set(['test-writer', 'reviewer']) };

function assistant(id: string, usage: Record<string, unknown>, content: unknown[] = [], at = '2026-10-24T00:00:00Z'): TranscriptRecord {
  return { type: 'assistant', timestamp: at, effort: 'medium', message: { id, model: 'claude-sonnet-5-5', usage, content } };
}

function toolResult(text: string, isError = false): TranscriptRecord {
  return { type: 'user', timestamp: '2026-10-24T00:01:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: text, is_error: isError }] } };
}

const usage = (input: number, read: number, write: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write },
  output_tokens: output,
  output_tokens_details: { thinking_tokens: Math.floor(output / 2) },
});

function session(): SessionTranscript {
  return {
    sessionId: 'abc-123',
    records: [
      // Two records for one streamed message: usage counted once.
      assistant('m1', usage(10, 0, 1000, 100), [{ type: 'tool_use', name: 'Skill', input: { skill: 'agentic-pipeline-full' } }]),
      assistant('m1', usage(10, 0, 1000, 100), [{ type: 'tool_use', name: 'Bash', input: { command: 'cd /x && npm run -s pipeline -- tdd split --label 1-2' } }]),
      assistant('m2', usage(5, 1000, 500, 200), [
        { type: 'tool_use', name: 'Bash', input: { command: 'npm run long -- wait verify' } },
        { type: 'tool_use', name: 'Agent', input: { subagent_type: 'test-writer', prompt: 'SECRET brief text' } },
      ], '2026-10-24T00:10:00Z'),
      toolResult('Changed vs main\nPASS (cached: this exact tree already passed) static\nVERIFY: PASS'),
      toolResult('Blind phase for 1-2: the tests …', true),
      { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-24T00:11:00Z', compactMetadata: { trigger: 'auto', preTokens: 120000, postTokens: 9000 } },
      {
        type: 'cost-state', totalCostUSD: 3, totalAPIDuration: 60000, totalToolDuration: 120000, totalLinesAdded: 40, totalLinesRemoved: 4,
        modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1, costUSD: 3 } },
      },
    ],
    subagents: [
      {
        agentType: 'test-writer',
        spawnDepth: 2,
        records: [
          assistant('s1', usage(5, 0, 500, 100), [{ type: 'tool_use', name: 'Bash', input: { command: 'curl -H "Authorization: token ghp_x" https://example.invalid' } }]),
          toolResult('RED PROVEN for 1-2 (1 failing tests in 1 files):'),
        ],
      },
    ],
  };
}

describe('bashCategory', () => {
  it.each([
    ['npm run test', 'npm run test'],
    ['npm run -s pipeline -- verify --base origin/main', 'npm run pipeline verify'],
    ['npm run pipeline -- tdd join --label 1-2', 'npm run pipeline tdd join'],
    ['npm run long -- wait verify', 'npm run long wait'],
    ['npm run something-unknown', 'npm run (other)'],
    ['cd /repo && git -C /wt show HEAD', 'git show'],
    ['gh pr view 12 --json body', 'gh pr view'],
    ['gh api repos/o/r/issues', 'gh api'],
    ['FOO=1 npx vitest run tests/unit/nav/Pathfinding.test.ts', 'npx vitest'],
    ['curl -H "Authorization: token ghp_secret" https://x', 'curl'],
    ['./do-something --password hunter2', 'other'],
    ['npx ghp_secrettoken', 'npx (other)'],
    ['gh pr ghpsecret', 'gh pr'],
    ['npm run pipeline -- ghpsecret', 'npm run pipeline'],
  ])('%s → %s', (command, category) => {
    expect(bashCategory(command, SCRIPTS)).toBe(category);
  });
});

describe('usageTokens', () => {
  it('splits cache writes by lifetime and reads thinking tokens', () => {
    expect(usageTokens(usage(1, 2, 3, 4))).toEqual({ input: 1, output: 4, thinking: 2, cacheRead: 2, cacheWrite5m: 0, cacheWrite1h: 3 });
  });

  it('treats an unsplit cache write as 5-minute', () => {
    expect(usageTokens({ cache_creation_input_tokens: 7 }).cacheWrite5m).toBe(7);
  });
});

describe('extractMetrics', () => {
  const run = extractMetrics(session(), { issue: '1', runId: '99' }, VOCAB);

  it('takes the cost from cost-state and shares it across agents', () => {
    expect(run.cost).toMatchObject({ totalUSD: 3, source: 'cost-state' });
    const total = run.agents.reduce((sum, agent) => sum + agent.costUSD, 0);
    expect(total).toBeCloseTo(3, 3);
    expect(run.agents.map((a) => a.agent)).toEqual(['main', 'test-writer']);
  });

  it('counts a streamed message once and tracks context size', () => {
    const main = run.agents.find((a) => a.agent === 'main')!;
    expect(main.requests).toBe(2);
    expect(main.tokens.output).toBe(300);
    expect(main.peakContextTokens).toBe(1505);
    expect(main.finalContextTokens).toBe(1505);
    expect(main.compactions).toBe(1);
    expect(main.compactedAtTokens).toEqual([120000]);
    expect(main.effort).toEqual({ medium: 2 });
  });

  it('reads the pipeline counters', () => {
    expect(run.pipeline).toMatchObject({
      pipelineSkill: 'agentic-pipeline-full',
      delegations: { 'test-writer': 1 },
      longWaitPolls: 1,
      verifyRuns: 1,
      verifyPass: 1,
      verifyCachedChannels: 1,
      redProven: 1,
      blindRefusals: 1,
      toolErrors: 1,
    });
    expect(run.bash).toEqual({ 'npm run pipeline tdd split': 1, 'npm run long wait': 1, curl: 1 });
  });

  it('carries no free text out of the transcript', () => {
    const text = JSON.stringify(run);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('example.invalid');
  });

  it('maps every name a session typed onto the vocabulary', () => {
    const typed = session();
    typed.records.push(
      assistant('m3', usage(1, 1, 1, 1), [
        { type: 'tool_use', name: 'Skill', input: { skill: 'ghp_tokenLookingSkill' } },
        { type: 'tool_use', name: 'Agent', input: { subagent_type: '/home/runner/secret' } },
        { type: 'tool_use', name: 'mcp__github__issue_read', input: {} },
        { type: 'tool_use', name: 'ghp_notATool', input: {} },
      ]),
    );
    typed.subagents[0]!.agentType = 'ghp_agentType';
    const mapped = extractMetrics(typed, {}, VOCAB);
    const text = JSON.stringify(mapped);
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('/home/runner');
    expect(mapped.skills).toMatchObject({ other: 1 });
    expect(mapped.pipeline.delegations).toMatchObject({ other: 1 });
    expect(mapped.agents.find((a) => a.agent === 'main')!.tools).toMatchObject({ mcp__github: 1, other: 1 });
  });

  it('does not count an API error as a request or a context size', () => {
    const errored = session();
    errored.records.push({ type: 'assistant', timestamp: '2026-10-24T00:12:00Z', message: { id: 'e1', model: '<synthetic>', usage: usage(0, 0, 0, 0), content: [] } });
    const main = extractMetrics(errored, {}, VOCAB).agents.find((a) => a.agent === 'main')!;
    expect(main.requests).toBe(2);
    expect(main.finalContextTokens).toBe(1505);
  });

  // A run killed by the timeout writes no cost-state: its tokens are priced
  // at the measured rate (2 USD per million weighted tokens for sonnet-5-5).
  it('estimates the cost from the tokens when cost-state is missing', () => {
    const partial = session();
    partial.records = partial.records.filter((record) => record.type !== 'cost-state');
    const estimated = extractMetrics(partial, {}, VOCAB);
    expect(estimated.cost.source).toBe('estimated');
    // 20 input + 400 output ×5 + 1000 read ×0.1 + 2000 1-hour writes ×2 = 6120 weighted.
    expect(estimated.cost.totalUSD).toBeCloseTo(0.0122, 4);
    expect(estimated.cost.byModel['claude-sonnet-5-5']!.output).toBe(400);
    expect(estimated.agents.reduce((sum, agent) => sum + agent.costUSD, 0)).toBeCloseTo(0.0122, 3);
  });

  // A run killed by the timeout writes no cost-state, so its durations come
  // from the transcript: each tool call's result time minus its call time.
  it('times each tool call, a long wait by the command it waits on', () => {
    const use = (id: string, name: string, input: Record<string, unknown>, at: string) =>
      assistant(id, usage(1, 0, 0, 1), [{ type: 'tool_use', id: `t-${id}`, name, input }], at);
    const result = (id: string, at: string): TranscriptRecord =>
      ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: `t-${id}`, content: 'ok' }] } });
    const timed: SessionTranscript = {
      sessionId: 'timed',
      records: [
        use('a', 'Bash', { command: 'npm run long -- start v1 -- npm run pipeline -- verify' }, '2026-10-24T00:00:00Z'),
        result('a', '2026-10-24T00:00:02Z'),
        use('b', 'Bash', { command: 'npm run long -- wait v1' }, '2026-10-24T00:00:10Z'),
        result('b', '2026-10-24T00:09:10Z'),
        use('c', 'Bash', { command: 'npm run long -- wait v1' }, '2026-10-24T00:09:20Z'),
        result('c', '2026-10-24T00:12:20Z'),
        use('d', 'Bash', { command: 'npm run long -- wait SECRET-name' }, '2026-10-24T00:13:00Z'),
        result('d', '2026-10-24T00:13:30Z'),
        use('e', 'Read', { file_path: '/x' }, '2026-10-24T00:14:00Z'),
        result('e', '2026-10-24T00:14:01Z'),
        use('f', 'Grep', { pattern: 'never answered' }, '2026-10-24T00:15:00Z'),
      ],
      subagents: [],
    };
    const run = extractMetrics(timed, {}, VOCAB);
    expect(run.toolSeconds).toEqual({
      'npm run long start': 2,
      'npm run long wait (npm run pipeline verify)': 720,
      'npm run long wait (other)': 30,
      Read: 1,
    });
    expect(JSON.stringify(run)).not.toContain('SECRET');
    expect(runSummary(run)).toContain('Time in tools: npm run long wait (npm run pipeline verify) 12 min');
  });

  it('leaves a model with no measured rate unpriced', () => {
    const partial = session();
    partial.records = partial.records.filter((record) => record.type !== 'cost-state');
    for (const record of [...partial.records, ...partial.subagents[0]!.records]) {
      if (record.message && 'model' in record.message) record.message.model = 'claude-unknown-9';
    }
    expect(extractMetrics(partial, {}, VOCAB).cost.totalUSD).toBe(0);
  });
});

describe('transcripts', () => {
  it('skips a line cut off by a killed process', () => {
    expect(parseJsonl('{"type":"assistant"}\n{"type":"us')).toHaveLength(1);
  });
});

describe('reports', () => {
  const run = extractMetrics(session(), { issue: '1', terminal: 'true' }, VOCAB);

  it('summarises one run', () => {
    const summary = runSummary(run);
    expect(summary).toContain('**$3.00**');
    expect(summary).toContain('| test-writer |');
    expect(summary).toContain('| 1 (at 120k) |');
  });

  it('aggregates runs by pipeline, outcome and agent', () => {
    const report = aggregateReport([run, { ...run, sessionId: 'def' }]);
    expect(report).toContain('2 sessions, $6.00 total');
    expect(report).toContain('| agentic-pipeline-full | 2 |');
    expect(report).toContain('| true | 2 | $6.00 | 100% |');
  });
});

describe('publish', () => {
  // Real git against a local bare repository standing in for origin.
  it('creates the branch, appends new sessions, and adds nothing twice', () => {
    const root = mkdtempSync(join(tmpdir(), 'metrics-publish-'));
    try {
      const remote = join(root, 'origin.git');
      execFileSync('git', ['init', '-q', '--bare', remote]);
      const dir = join(root, 'records');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a.json'), '{"schema":1,"sessionId":"a"}\n');
      expect(publish({ dir, remote })).toBe(1);
      writeFileSync(join(dir, 'b.json'), '{"schema":1,"sessionId":"b"}\n');
      expect(publish({ dir, remote })).toBe(1);
      expect(publish({ dir, remote })).toBe(0);
      const file = execFileSync('git', ['--git-dir', remote, 'show', 'agentic-metrics:runs.jsonl'], { encoding: 'utf8' });
      expect(file.trim().split('\n')).toEqual(['{"schema":1,"sessionId":"a"}', '{"schema":1,"sessionId":"b"}']);
      expect(newLines(file, ['{"sessionId":"b"}', '{"sessionId":"c"}'])).toEqual(['{"sessionId":"c"}']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
