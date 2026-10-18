// BlastSimulator2026 — Progression probe report: markdown table and JSON (#1922)

import type { ProbeOptions } from './probe-config.js';
import { CASH_SAMPLE_TICKS, type RunResult } from './probe-metrics.js';

type Cell = number | string | null;

const NONE = '-';

function cell(v: Cell, digits = 0): string {
  if (v === null) return NONE;
  if (typeof v === 'string') return v;
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

function share(v: number | null): string {
  return v === null ? NONE : `${(v * 100).toFixed(0)}%`;
}

function grades(r: RunResult): string {
  const entries = Object.entries(r.metrics.gradeReachedTick).sort(([a], [b]) => Number(a) - Number(b));
  return entries.length === 0 ? NONE : entries.map(([g, t]) => `g${g}@${t}`).join(' ');
}

const HEADERS = [
  'seed', 'biome', 'kit', 'strategy',
  ...CASH_SAMPLE_TICKS.map(t => `cash@${t}`),
  'low cash', 'low tick', 'bankrupt', 'firstBlastSold@6000', 'blasts',
  'warehouseFull tick', 'haulWait ticks', 'boulderSold', 'grades',
  'affordable warehouseT2', 'affordable researchCenter', 'affordable secondHauler', 'end',
];

function row(r: RunResult): string[] {
  const m = r.metrics;
  return [
    String(r.config.seed), r.config.biome, r.config.kit, r.config.strategy,
    ...CASH_SAMPLE_TICKS.map(t => cell(m.cashAt[t] ?? null)),
    cell(m.lowPointCash), cell(m.lowPointTick), cell(m.bankruptTick),
    share(m.firstBlastSoldShareAt6000), cell(m.blastsFired),
    cell(m.warehouseFullTick), cell(m.ticksHaulWaitedOnFullStorage), share(m.boulderSoldShare), grades(r),
    cell(m.affordableTick.warehouseT2), cell(m.affordableTick.researchCenter), cell(m.affordableTick.secondHauler),
    r.endReason ?? `t${r.endTick}`,
  ];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median of a metric over runs, ignoring runs where it is null. */
function med(runs: RunResult[], pick: (r: RunResult) => number | null): number | null {
  return median(runs.map(pick).filter((v): v is number => v !== null));
}

function medianRow(runs: RunResult[]): string[] {
  const first = runs[0]!.config;
  return [
    `median(${runs.length})`, first.biome, first.kit, first.strategy,
    ...CASH_SAMPLE_TICKS.map(t => cell(med(runs, r => r.metrics.cashAt[t] ?? null))),
    cell(med(runs, r => r.metrics.lowPointCash)), cell(med(runs, r => r.metrics.lowPointTick)),
    cell(med(runs, r => r.metrics.bankruptTick)),
    share(med(runs, r => r.metrics.firstBlastSoldShareAt6000)), cell(med(runs, r => r.metrics.blastsFired)),
    cell(med(runs, r => r.metrics.warehouseFullTick)), cell(med(runs, r => r.metrics.ticksHaulWaitedOnFullStorage)),
    share(med(runs, r => r.metrics.boulderSoldShare)), NONE,
    cell(med(runs, r => r.metrics.affordableTick.warehouseT2)),
    cell(med(runs, r => r.metrics.affordableTick.researchCenter)),
    cell(med(runs, r => r.metrics.affordableTick.secondHauler)), NONE,
  ];
}

const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

/** Markdown table: one row per run, then a median row per (biome, kit, strategy) group. */
export function formatTable(results: readonly RunResult[]): string {
  const lines = [line(HEADERS), line(HEADERS.map(() => '---'))];
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    lines.push(line(row(r)));
    const key = `${r.config.biome}|${r.config.kit}|${r.config.strategy}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const runs of groups.values()) {
    if (runs.length > 1) lines.push(line(medianRow(runs)));
  }
  return lines.join('\n');
}

export function toJson(results: readonly RunResult[], opts: ProbeOptions): string {
  return JSON.stringify({ options: opts, results }, null, 2);
}
