/**
 * BlastSimulator2026 — One run's metrics, from its transcripts
 *
 * What the pipeline's next design decision needs to know about a run, and
 * nothing that could leak: costs, tokens and durations per model and per
 * agent, how large each agent's context grew, what it called (tool names,
 * skill names, shell commands by category), and the pipeline's own counters
 * (verify cache hits, RED proofs, blind-phase refusals, long-run polls). Free
 * text — prompts, file contents, command lines, descriptions — never enters a
 * record.
 *
 * @module metrics/extract
 */

import { bashCategory } from './bash-category.js';
import type { SessionTranscript, TranscriptRecord } from './transcripts.js';

const METRICS_SCHEMA = 1;

/**
 * Relative price of each token kind against a fresh input token. Stable across
 * Claude models (output 5×, 5-minute cache write 1.25×, 1-hour write 2×, cache
 * read 0.1×), so a model's real cost from Claude Code's own `cost-state` can be
 * shared out across the agents that spent it without a price table to go stale.
 */
const WEIGHT = { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 };

interface TokenCounts {
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

interface ModelCost {
  costUSD: number;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  /** Cache writes, 5-minute and 1-hour together: `cost-state` does not split them. */
  cacheWrite: number;
}

export interface AgentMetrics {
  agent: string;
  invocations: number;
  requests: number;
  tokens: TokenCounts;
  /** This agent's share of the run's cost, allocated per model by weighted tokens. */
  costUSD: number;
  /** Prompt size (input + cache read + cache write) of its largest request. */
  peakContextTokens: number;
  /** Prompt size of its last request — where the context ended. */
  finalContextTokens: number;
  compactions: number;
  wallSeconds: number;
  models: Record<string, number>;
  effort: Record<string, number>;
  tools: Record<string, number>;
}

export interface RunContext {
  repo?: string | undefined;
  workflow?: string | undefined;
  runId?: string | undefined;
  runAttempt?: string | undefined;
  issue?: string | undefined;
  entity?: string | undefined;
  conclusion?: string | undefined;
  terminal?: string | undefined;
}

export interface RunMetrics extends RunContext {
  schema: number;
  sessionId: string;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  wallSeconds: number;
  cost: {
    totalUSD: number;
    /** `cost-state` is Claude Code's own accounting; `estimated` when the run died before writing one. */
    source: 'cost-state' | 'estimated';
    byModel: Record<string, ModelCost>;
  };
  durations: { apiSeconds?: number | undefined; toolSeconds?: number | undefined };
  lines: { added?: number | undefined; removed?: number | undefined };
  tokens: TokenCounts & { cacheHitRatio: number };
  agents: AgentMetrics[];
  skills: Record<string, number>;
  bash: Record<string, number>;
  pipeline: {
    pipelineSkill?: string | undefined;
    delegations: Record<string, number>;
    longWaitPolls: number;
    verifyRuns: number;
    verifyPass: number;
    verifyCachedChannels: number;
    redProven: number;
    redNotProven: number;
    blindRefusals: number;
    hookRefusals: number;
    toolErrors: number;
  };
}

const zero = (): TokenCounts => ({ input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function bump(counter: Record<string, number>, key: string, by = 1): void {
  counter[key] = (counter[key] ?? 0) + by;
}

function addTokens(into: TokenCounts, from: TokenCounts): void {
  for (const key of Object.keys(into) as (keyof TokenCounts)[]) into[key] += from[key];
}

/** The token counts of one API response's `usage` block. */
export function usageTokens(usage: Record<string, unknown> | undefined): TokenCounts {
  if (!usage) return zero();
  const creation = (usage.cache_creation ?? {}) as Record<string, unknown>;
  const details = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const write1h = num(creation.ephemeral_1h_input_tokens);
  const write5m = 'ephemeral_5m_input_tokens' in creation ? num(creation.ephemeral_5m_input_tokens) : num(usage.cache_creation_input_tokens) - write1h;
  return {
    input: num(usage.input_tokens),
    output: num(usage.output_tokens),
    thinking: num(details.thinking_tokens),
    cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite5m: Math.max(0, write5m),
    cacheWrite1h: write1h,
  };
}

const weighted = (t: TokenCounts): number =>
  t.input * WEIGHT.input + t.output * WEIGHT.output + t.cacheWrite5m * WEIGHT.cacheWrite5m + t.cacheWrite1h * WEIGHT.cacheWrite1h + t.cacheRead * WEIGHT.cacheRead;

const promptSize = (t: TokenCounts): number => t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

interface ToolUse { name: string; input: Record<string, unknown> }

function contentBlocks(record: TranscriptRecord): Record<string, unknown>[] {
  const content = record.message?.content;
  return Array.isArray(content) ? content.filter((block): block is Record<string, unknown> => block !== null && typeof block === 'object') : [];
}

function toolUses(record: TranscriptRecord): ToolUse[] {
  return contentBlocks(record)
    .filter((block) => block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name as string, input: (block.input ?? {}) as Record<string, unknown> }));
}

function toolResultTexts(record: TranscriptRecord): { text: string; isError: boolean }[] {
  return contentBlocks(record)
    .filter((block) => block.type === 'tool_result')
    .map((block) => {
      const content = block.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('\n')
          : '';
      return { text, isError: block.is_error === true };
    });
}

/** Tool names are a fixed vocabulary, except MCP tools: keep their server, drop nothing secret. */
function toolName(name: string): string {
  return /^[A-Za-z0-9_:-]{1,80}$/.test(name) ? name : 'other';
}

const SAFE_NAME = /^[A-Za-z0-9:_-]{1,64}$/;

interface AgentAccumulator {
  metrics: AgentMetrics;
  byModel: Map<string, TokenCounts>;
  first?: number;
  last?: number;
}

function accumulate(
  acc: AgentAccumulator,
  records: TranscriptRecord[],
  run: RunMetrics,
  scripts: ReadonlySet<string>,
): void {
  const latest = new Map<string, TranscriptRecord>();
  const order: string[] = [];
  for (const record of records) {
    const time = record.timestamp ? Date.parse(record.timestamp) : NaN;
    if (Number.isFinite(time)) {
      acc.first = Math.min(acc.first ?? time, time);
      acc.last = Math.max(acc.last ?? time, time);
    }
    if (record.type === 'system' && typeof record.subtype === 'string' && record.subtype.includes('compact')) acc.metrics.compactions++;
    if (record.type === 'assistant' && record.message) {
      const id = record.message.id ?? `${order.length}`;
      if (!latest.has(id)) order.push(id);
      latest.set(id, record);
      for (const use of toolUses(record)) {
        bump(acc.metrics.tools, toolName(use.name));
        if (use.name === 'Skill' && typeof use.input.skill === 'string' && SAFE_NAME.test(use.input.skill)) {
          bump(run.skills, use.input.skill);
          if (run.pipeline.pipelineSkill === undefined && use.input.skill.startsWith('agentic-pipeline-')) run.pipeline.pipelineSkill = use.input.skill;
        }
        if ((use.name === 'Agent' || use.name === 'Task') && typeof use.input.subagent_type === 'string' && SAFE_NAME.test(use.input.subagent_type)) {
          bump(run.pipeline.delegations, use.input.subagent_type);
        }
        if (use.name === 'Bash' && typeof use.input.command === 'string') {
          const category = bashCategory(use.input.command, scripts);
          bump(run.bash, category);
          if (category === 'npm run long wait') run.pipeline.longWaitPolls++;
        }
      }
    }
    if (record.type === 'user') {
      for (const result of toolResultTexts(record)) {
        if (result.isError) run.pipeline.toolErrors++;
        if (/Blind phase for /.test(result.text)) run.pipeline.blindRefusals++;
        if (/hook (error|blocked)|PreToolUse:\w+ hook/i.test(result.text)) run.pipeline.hookRefusals++;
        run.pipeline.verifyRuns += (result.text.match(/^VERIFY: (PASS|FAIL)/gm) ?? []).length;
        run.pipeline.verifyPass += (result.text.match(/^VERIFY: PASS/gm) ?? []).length;
        run.pipeline.verifyCachedChannels += (result.text.match(/^PASS \(cached/gm) ?? []).length;
        run.pipeline.redProven += (result.text.match(/^RED PROVEN for /gm) ?? []).length;
        run.pipeline.redNotProven += (result.text.match(/^RED NOT PROVEN for /gm) ?? []).length;
      }
    }
  }
  for (const id of order) {
    const record = latest.get(id)!;
    const tokens = usageTokens(record.message?.usage);
    const model = typeof record.message?.model === 'string' && SAFE_NAME.test(record.message.model) ? record.message.model : 'unknown';
    if (model === '<synthetic>') continue;
    acc.metrics.requests++;
    addTokens(acc.metrics.tokens, tokens);
    if (!acc.byModel.has(model)) acc.byModel.set(model, zero());
    addTokens(acc.byModel.get(model)!, tokens);
    bump(acc.metrics.models, model);
    if (typeof record.effort === 'string' && /^[a-z]{1,10}$/.test(record.effort)) bump(acc.metrics.effort, record.effort);
    const size = promptSize(tokens);
    acc.metrics.peakContextTokens = Math.max(acc.metrics.peakContextTokens, size);
    acc.metrics.finalContextTokens = size;
  }
}

function newAgent(agent: string): AgentAccumulator {
  return {
    metrics: {
      agent, invocations: 0, requests: 0, tokens: zero(), costUSD: 0, peakContextTokens: 0, finalContextTokens: 0,
      compactions: 0, wallSeconds: 0, models: {}, effort: {}, tools: {},
    },
    byModel: new Map(),
  };
}

function lastCostState(records: TranscriptRecord[]): TranscriptRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) if (records[i]!.type === 'cost-state') return records[i];
  return undefined;
}

/** The metrics of one session and every sub-agent it ran. */
export function extractMetrics(session: SessionTranscript, context: RunContext, scripts: ReadonlySet<string>): RunMetrics {
  const run: RunMetrics = {
    schema: METRICS_SCHEMA,
    ...context,
    sessionId: /^[A-Za-z0-9-]{1,64}$/.test(session.sessionId) ? session.sessionId : 'unknown',
    wallSeconds: 0,
    cost: { totalUSD: 0, source: 'estimated', byModel: {} },
    durations: {},
    lines: {},
    tokens: { ...zero(), cacheHitRatio: 0 },
    agents: [],
    skills: {},
    bash: {},
    pipeline: {
      delegations: {}, longWaitPolls: 0, verifyRuns: 0, verifyPass: 0, verifyCachedChannels: 0,
      redProven: 0, redNotProven: 0, blindRefusals: 0, hookRefusals: 0, toolErrors: 0,
    },
  };

  const agents = new Map<string, AgentAccumulator>();
  const agentFor = (name: string): AgentAccumulator => {
    if (!agents.has(name)) agents.set(name, newAgent(name));
    return agents.get(name)!;
  };
  const main = agentFor('main');
  main.metrics.invocations = 1;
  accumulate(main, session.records, run, scripts);
  for (const sub of session.subagents) {
    const acc = agentFor(sub.agentType);
    acc.metrics.invocations++;
    accumulate(acc, sub.records, run, scripts);
  }

  const all = [...agents.values()];
  const starts = all.map((a) => a.first).filter((t): t is number => t !== undefined);
  const ends = all.map((a) => a.last).filter((t): t is number => t !== undefined);
  if (starts.length > 0) run.startedAt = new Date(Math.min(...starts)).toISOString();
  if (ends.length > 0) run.endedAt = new Date(Math.max(...ends)).toISOString();
  run.wallSeconds = starts.length > 0 && ends.length > 0 ? Math.round((Math.max(...ends) - Math.min(...starts)) / 1000) : 0;
  for (const acc of all) {
    acc.metrics.wallSeconds = acc.first !== undefined && acc.last !== undefined ? Math.round((acc.last - acc.first) / 1000) : 0;
    addTokens(run.tokens, acc.metrics.tokens);
  }
  const prompt = run.tokens.input + run.tokens.cacheRead + run.tokens.cacheWrite5m + run.tokens.cacheWrite1h;
  run.tokens.cacheHitRatio = prompt > 0 ? round(run.tokens.cacheRead / prompt, 4) : 0;

  // Per-model weighted tokens, summed over agents, to share each model's cost out.
  const modelWeight = new Map<string, number>();
  for (const acc of all) for (const [model, tokens] of acc.byModel) modelWeight.set(model, (modelWeight.get(model) ?? 0) + weighted(tokens));

  const costState = lastCostState(session.records);
  const modelCost = new Map<string, number>();
  if (costState && typeof costState.totalCostUSD === 'number') {
    run.cost.source = 'cost-state';
    run.cost.totalUSD = round(costState.totalCostUSD, 4);
    const usage = (costState.modelUsage ?? {}) as Record<string, Record<string, unknown>>;
    for (const [model, entry] of Object.entries(usage)) {
      if (!SAFE_NAME.test(model)) continue;
      modelCost.set(model, num(entry.costUSD));
      run.cost.byModel[model] = {
        costUSD: round(num(entry.costUSD), 4),
        input: num(entry.inputTokens),
        output: num(entry.outputTokens),
        thinking: num(entry.thinkingTokens),
        cacheRead: num(entry.cacheReadInputTokens),
        cacheWrite: num(entry.cacheCreationInputTokens),
      };
    }
    run.durations = { apiSeconds: Math.round(num(costState.totalAPIDuration) / 1000), toolSeconds: Math.round(num(costState.totalToolDuration) / 1000) };
    run.lines = { added: num(costState.totalLinesAdded), removed: num(costState.totalLinesRemoved) };
  }

  for (const acc of all) {
    let cost = 0;
    for (const [model, tokens] of acc.byModel) {
      const total = modelWeight.get(model) ?? 0;
      if (total > 0 && modelCost.has(model)) cost += (modelCost.get(model)! * weighted(tokens)) / total;
    }
    acc.metrics.costUSD = round(cost, 4);
  }
  if (run.cost.source === 'estimated') {
    // No `cost-state` (the process died first): leave totalUSD at 0 rather than invent prices.
    for (const acc of all) for (const [model, tokens] of acc.byModel) {
      const entry = (run.cost.byModel[model] ??= { costUSD: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0 });
      entry.input += tokens.input;
      entry.output += tokens.output;
      entry.thinking += tokens.thinking;
      entry.cacheRead += tokens.cacheRead;
      entry.cacheWrite += tokens.cacheWrite5m + tokens.cacheWrite1h;
    }
  }

  run.agents = all.map((a) => a.metrics).sort((a, b) => b.costUSD - a.costUSD || b.requests - a.requests);
  return run;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
