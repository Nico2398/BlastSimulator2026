// BlastSimulator2026 — Progression probe report: markdown table and JSON (#1922)

import type { ProbeOptions } from './probe-config.js';
import { CASH_SAMPLE_TICKS, SALES_COST_WINDOW_STARTS, type RunResult } from './probe-metrics.js';
import { GRADE_TARGET_WINDOWS, gradeVerdicts, type GradeVerdict } from './probe-ladder.js';

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

function gradeCash(r: RunResult): string {
  const entries = Object.entries(r.metrics.gradeCashAt).sort(([a], [b]) => Number(a) - Number(b));
  return entries.length === 0 ? NONE : entries.map(([g, c]) => `g${g}:${Math.round(c)}`).join(' ');
}

const HEADERS = [
  'seed', 'biome', 'kit', 'strategy',
  ...CASH_SAMPLE_TICKS.map(t => `cash@${t}`),
  'low cash', 'low tick', 'bankrupt', 'firstBlastSold@6000', 'blasts',
  'warehouseFull tick', 'haulWait ticks', 'boulderSold', 'boulderOreSold', 'grades', 'grade cash', 'catalog bought',
  'affordable warehouseT2', 'affordable researchCenter', 'affordable secondHauler',
  'first sale', 'sales/costs', 'sales/costs p10', ...SALES_COST_WINDOW_STARTS.map(t => `sales/costs@${t}`), 'end',
];

function row(r: RunResult): string[] {
  const m = r.metrics;
  return [
    String(r.config.seed), r.config.biome, r.config.kit, r.config.strategy,
    ...CASH_SAMPLE_TICKS.map(t => cell(m.cashAt[t] ?? null)),
    cell(m.lowPointCash), cell(m.lowPointTick), cell(m.bankruptTick),
    share(m.firstBlastSoldShareAt6000), cell(m.blastsFired),
    cell(m.warehouseFullTick), cell(m.ticksHaulWaitedOnFullStorage), share(m.boulderSoldShare), share(m.boulderOreSoldShare), grades(r), gradeCash(r), cell(m.catalogBoughtTick),
    cell(m.affordableTick.warehouseT2), cell(m.affordableTick.researchCenter), cell(m.affordableTick.secondHauler),
    cell(m.firstSaleTick), cell(m.salesCostRatio, 2), NONE, ...SALES_COST_WINDOW_STARTS.map((_, i) => cell(m.salesCostWindows[i] ?? null, 2)),
    r.endReason ?? `t${r.endTick}`,
  ];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The `q` quantile (0-1) by linear interpolation between ranks; null for no values. */
function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
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
    share(med(runs, r => r.metrics.boulderSoldShare)), share(med(runs, r => r.metrics.boulderOreSoldShare)), NONE, NONE,
    cell(med(runs, r => r.metrics.catalogBoughtTick)),
    cell(med(runs, r => r.metrics.affordableTick.warehouseT2)),
    cell(med(runs, r => r.metrics.affordableTick.researchCenter)),
    cell(med(runs, r => r.metrics.affordableTick.secondHauler)),
    cell(med(runs, r => r.metrics.firstSaleTick)), cell(med(runs, r => r.metrics.salesCostRatio), 2),
    cell(percentile(runs.map(r => r.metrics.salesCostRatio).filter((v): v is number => v !== null), 0.1), 2),
    ...SALES_COST_WINDOW_STARTS.map((_, i) => cell(med(runs, r => r.metrics.salesCostWindows[i] ?? null), 2)),
    NONE,
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

/**
 * Per (biome, kit, strategy) group and grade: runs that reached it, median tick and cash at that
 * tick, and the verdict of the median tick against GRADE_TARGET_WINDOWS (grades without a window
 * report no verdict). A grade no run reached is listed 'missed'.
 */
export function formatGradeSummary(results: readonly RunResult[]): string {
  const headers = ['biome', 'kit', 'strategy', 'grade', 'reached', 'median tick', 'median cash', 'window', 'verdict'];
  const lines = [line(headers), line(headers.map(() => '---'))];
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = `${r.config.biome}|${r.config.kit}|${r.config.strategy}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const runs of groups.values()) {
    const first = runs[0]!.config;
    const grades = new Set<number>(Object.keys(GRADE_TARGET_WINDOWS).map(Number));
    for (const r of runs) for (const g of Object.keys(r.metrics.gradeReachedTick)) grades.add(Number(g));
    for (const grade of [...grades].sort((a, b) => a - b)) {
      const reached = runs.filter(r => r.metrics.gradeReachedTick[grade] !== undefined);
      const tick = median(reached.map(r => r.metrics.gradeReachedTick[grade]!));
      const cash = median(reached.map(r => r.metrics.gradeCashAt[grade]).filter((c): c is number => c !== undefined));
      const window = GRADE_TARGET_WINDOWS[grade];
      const verdict: GradeVerdict['status'] | typeof NONE = window
        ? gradeVerdicts(tick === null ? {} : { [grade]: tick }, { [grade]: window })[0]!.status
        : NONE;
      lines.push(line([
        first.biome, first.kit, first.strategy, String(grade), `${reached.length}/${runs.length}`,
        cell(tick), cell(cash), window ? `${window[0]}-${window[1]}` : NONE, verdict,
      ]));
    }
  }
  return lines.join('\n');
}

export function toJson(results: readonly RunResult[], opts: ProbeOptions): string {
  return JSON.stringify({ options: opts, results }, null, 2);
}
