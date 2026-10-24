/**
 * BlastSimulator2026 — Run metrics as tables a human decides from
 *
 * `runSummary` is one run's page (the job's step summary). `aggregateReport`
 * reads the accumulated `runs.jsonl` and answers the questions a change to the
 * pipeline is weighed against: what a run costs per pipeline and per outcome,
 * which agent spends it, how far the lead's context grows, how much the cache
 * and the verify cache save, and where turns go to polling.
 *
 * @module metrics/report
 */

import type { AgentMetrics, RunMetrics } from './extract.js';

const usd = (value: number): string => `$${value.toFixed(2)}`;
const k = (tokens: number): string => (tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}k`);
const minutes = (seconds: number): string => `${Math.round(seconds / 60)} min`;
const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

function top(counter: Record<string, number>, n: number): string {
  return Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => `${name} ×${count}`).join(', ') || '—';
}

function agentRow(agent: AgentMetrics): string {
  const prompt = agent.tokens.input + agent.tokens.cacheRead + agent.tokens.cacheWrite5m + agent.tokens.cacheWrite1h;
  return `| ${agent.agent} | ${agent.invocations} | ${agent.requests} | ${usd(agent.costUSD)} | ${k(agent.peakContextTokens)} | ${k(agent.finalContextTokens)} | ${k(agent.tokens.output)} (${k(agent.tokens.thinking)} thinking) | ${prompt > 0 ? pct(agent.tokens.cacheRead / prompt) : '—'} | ${agent.compactions} | ${top(agent.effort, 3)} |`;
}

export function runSummary(run: RunMetrics): string {
  const p = run.pipeline;
  return [
    `### Agentic run metrics — ${run.issue ? `issue #${run.issue}` : run.entity ?? 'session'} (session ${run.sessionId.slice(0, 8)})`,
    '',
    `**${usd(run.cost.totalUSD)}**${run.cost.source === 'estimated' ? ' (no cost-state written: tokens only)' : ''} · ${minutes(run.wallSeconds)} wall · ${minutes(run.durations.apiSeconds ?? 0)} API · ${minutes(run.durations.toolSeconds ?? 0)} tools · cache hit ${pct(run.tokens.cacheHitRatio)} · pipeline \`${p.pipelineSkill ?? 'none'}\` · terminal: ${run.terminal ?? 'unknown'}`,
    '',
    '| Agent | Runs | Requests | Cost | Peak context | Final context | Output | Cache hit | Compactions | Effort |',
    '|-------|------|----------|------|--------------|---------------|--------|-----------|-------------|--------|',
    ...run.agents.map(agentRow),
    '',
    `- Models: ${Object.entries(run.cost.byModel).map(([model, c]) => `${model} ${usd(c.costUSD)}`).join(', ') || '—'}`,
    `- Delegations: ${top(p.delegations, 8)}`,
    `- Skills loaded: ${top(run.skills, 12)}`,
    `- Shell: ${top(run.bash, 12)}`,
    `- Pipeline: verify ${p.verifyRuns} runs (${p.verifyPass} green, ${p.verifyCachedChannels} channels from cache) · RED proven ${p.redProven}, not proven ${p.redNotProven} · blind refusals ${p.blindRefusals} · hook refusals ${p.hookRefusals} · tool errors ${p.toolErrors} · long-run polls ${p.longWaitPolls}`,
  ].join('\n');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

export function aggregateReport(runs: RunMetrics[]): string {
  if (runs.length === 0) return 'No runs recorded.';
  const total = runs.reduce((sum, run) => sum + run.cost.totalUSD, 0);
  const lines = [
    `## Agentic pipeline metrics — ${runs.length} sessions, ${usd(total)} total`,
    '',
    '### By pipeline',
    '| Pipeline | Sessions | Median cost | P90 cost | Median wall | Median requests | Cache hit |',
    '|----------|----------|-------------|----------|-------------|-----------------|-----------|',
  ];
  for (const [pipeline, group] of [...groupBy(runs, (r) => r.pipeline.pipelineSkill ?? 'none')].sort((a, b) => b[1].length - a[1].length)) {
    const costs = group.map((r) => r.cost.totalUSD);
    lines.push(`| ${pipeline} | ${group.length} | ${usd(median(costs))} | ${usd(percentile(costs, 0.9))} | ${minutes(median(group.map((r) => r.wallSeconds)))} | ${median(group.map((r) => r.agents.reduce((s, a) => s + a.requests, 0)))} | ${pct(median(group.map((r) => r.tokens.cacheHitRatio)))} |`);
  }

  lines.push('', '### By outcome', '| Terminal | Sessions | Cost | Share of spend |', '|----------|----------|------|----------------|');
  for (const [terminal, group] of groupBy(runs, (r) => r.terminal ?? 'unknown')) {
    const cost = group.reduce((sum, r) => sum + r.cost.totalUSD, 0);
    lines.push(`| ${terminal} | ${group.length} | ${usd(cost)} | ${pct(total > 0 ? cost / total : 0)} |`);
  }

  const byAgent = groupBy(runs.flatMap((r) => r.agents), (a) => a.agent);
  lines.push('', '### By agent', '| Agent | Invocations | Cost | Share | Median peak context | P90 peak context | Compactions |', '|-------|-------------|------|-------|---------------------|------------------|-------------|');
  for (const [agent, group] of [...byAgent].sort((a, b) => b[1].reduce((s, x) => s + x.costUSD, 0) - a[1].reduce((s, x) => s + x.costUSD, 0))) {
    const cost = group.reduce((sum, a) => sum + a.costUSD, 0);
    const peaks = group.map((a) => a.peakContextTokens);
    lines.push(`| ${agent} | ${group.reduce((s, a) => s + a.invocations, 0)} | ${usd(cost)} | ${pct(total > 0 ? cost / total : 0)} | ${k(median(peaks))} | ${k(percentile(peaks, 0.9))} | ${group.reduce((s, a) => s + a.compactions, 0)} |`);
  }

  const sum = (pick: (r: RunMetrics) => number): number => runs.reduce((s, r) => s + pick(r), 0);
  const verifyRuns = sum((r) => r.pipeline.verifyRuns);
  lines.push(
    '',
    '### Pipeline counters',
    `- verify: ${verifyRuns} runs, ${pct(verifyRuns > 0 ? sum((r) => r.pipeline.verifyPass) / verifyRuns : 0)} green, ${sum((r) => r.pipeline.verifyCachedChannels)} channels answered from cache`,
    `- RED: ${sum((r) => r.pipeline.redProven)} proven, ${sum((r) => r.pipeline.redNotProven)} not proven · blind refusals ${sum((r) => r.pipeline.blindRefusals)} · hook refusals ${sum((r) => r.pipeline.hookRefusals)}`,
    `- long-run polls: median ${median(runs.map((r) => r.pipeline.longWaitPolls))} per session · tool errors: median ${median(runs.map((r) => r.pipeline.toolErrors))}`,
  );
  return lines.join('\n');
}
