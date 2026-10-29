import { describe, it, expect } from 'vitest';
import { formatTable, toJson } from '../../../scripts/shared/probe-report.js';
import { PROBE_DEFAULTS } from '../../../scripts/shared/probe-config.js';
import type { RunResult } from '../../../scripts/shared/probe-metrics.js';

function makeResult(seed: number, over: Partial<RunResult['metrics']> = {}): RunResult {
  return {
    config: { seed, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 3000 },
    metrics: {
      cashAt: { 1000: 12345, 3000: null, 6000: null, 10000: null },
      lowPointCash: 500,
      lowPointTick: 321,
      bankruptTick: null,
      firstBlastSoldShareAt6000: null,
      blastsFired: 3,
      warehouseFullTick: 900,
      ticksHaulWaitedOnFullStorage: 17,
      boulderSoldShare: null,
      gradeReachedTick: { 1: 0, 2: 2500 },
      gradeCashAt: { 1: 90000, 2: 80000 },
      catalogBoughtTick: null,
      boulderOreSoldShare: null,
      affordableTick: { warehouseT2: 1500, researchCenter: null, secondHauler: 2000 },
      firstSaleTick: null,
      salesCostRatio: null,
      salesCostWindows: [null, null, null, null],
      ...over,
    },
    endTick: 3000,
    endReason: null,
  };
}

describe('probe-report formatTable', () => {
  const results = [makeResult(42), makeResult(7, { blastsFired: 9 })];
  const table = formatTable(results);
  const lines = table.split('\n').filter(l => l.trim().length > 0);

  it('emits a markdown table: header, separator, one row per run, a median row per multi-run group', () => {
    // both runs share biome/kit/strategy, so one median row follows them
    expect(lines).toHaveLength(2 + results.length + 1);
    expect(lines[2 + results.length]).toContain('median(2)');
    expect(lines[0]!.startsWith('|')).toBe(true);
    expect(lines[1]).toMatch(/^\|[\s:|-]+\|$/);
    expect(lines[1]).toContain('---');
  });

  it('rows have the same column count as the header', () => {
    const cols = (l: string) => l.split('|').length;
    for (const l of lines) expect(cols(l)).toBe(cols(lines[0]!));
  });

  it('renders null as "-"', () => {
    expect(lines[2]).toMatch(/\|\s*-\s*\|/);
  });

  it('includes every metric column', () => {
    const header = lines[0]!.toLowerCase();
    for (const col of [
      'seed', 'biome', 'kit', 'strategy', 'low cash', 'low tick', 'bankrupt', 'blasts',
      'warehousefull', 'boulder', 'grade', 'warehouset2', 'researchcenter', 'secondhauler',
    ]) {
      expect(header).toContain(col);
    }
    for (const t of ['1000', '3000', '6000', '10000']) expect(header).toContain(t);
  });

  it('shows values of the run', () => {
    expect(lines[2]).toContain('12345');
    expect(lines[3]).toContain('9');
  });

  it('is deterministic', () => {
    expect(formatTable(results)).toBe(table);
  });

  it('empty results still yield header and separator', () => {
    expect(formatTable([]).split('\n').filter(l => l.trim()).length).toBe(2);
  });
});

describe('probe-report toJson', () => {
  const results = [makeResult(42)];

  it('is valid JSON carrying results and options', () => {
    const parsed = JSON.parse(toJson(results, PROBE_DEFAULTS));
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].config.seed).toBe(42);
    expect(parsed.options).toEqual(PROBE_DEFAULTS);
  });

  it('is deterministic', () => {
    expect(toJson(results, PROBE_DEFAULTS)).toBe(toJson(results, PROBE_DEFAULTS));
  });
});

describe('probe-report toJson extended metrics (#1945)', () => {
  const extended = makeResult(42, {
    cashAt: { 1000: 1, 3000: 2, 6000: 3, 10000: 4, 15000: 5, 25000: 6, 40000: 7, 50000: null },
    gradeCashAt: { 1: 100, 2: 200 },
    catalogBoughtTick: 4200,
    boulderOreSoldShare: 0.5,
  });
  const opts = PROBE_DEFAULTS;

  it('carries gradeCashAt, catalogBoughtTick, boulderOreSoldShare and the extended cashAt keys', () => {
    const parsed = JSON.parse(toJson([extended], opts));
    const m = parsed.results[0].metrics;
    expect(m.gradeCashAt).toEqual({ 1: 100, 2: 200 });
    expect(m.catalogBoughtTick).toBe(4200);
    expect(m.boulderOreSoldShare).toBe(0.5);
    for (const t of ['15000', '25000', '40000', '50000']) expect(m.cashAt).toHaveProperty(t);
  });

  it('serializes deterministically', () => {
    expect(toJson([extended], opts)).toBe(toJson([extended], opts));
  });
});

describe('probe-report sales/costs columns (#2117)', () => {
  const cells = (l: string): string[] => l.split('|').slice(1, -1).map(c => c.trim());
  const col = (table: string, name: string): { header: string[]; at: number } => {
    const header = cells(table.split('\n')[0]!);
    return { header, at: header.indexOf(name) };
  };
  const rows = (table: string) => table.split('\n').filter(l => l.trim()).slice(2).map(cells);

  const pair = [
    makeResult(1, { firstSaleTick: 1200, salesCostRatio: 1 }),
    makeResult(2, { firstSaleTick: 1800, salesCostRatio: 3 }),
  ];
  const table = formatTable(pair);

  it('has first sale, sales/costs and sales/costs p10 columns', () => {
    const { header } = col(table, 'first sale');
    expect(header).toContain('first sale');
    expect(header).toContain('sales/costs');
    expect(header).toContain('sales/costs p10');
  });

  it('shows the first sale tick and the ratio with 2 decimals per run, p10 as -', () => {
    const [run1, run2] = rows(table);
    const fs = col(table, 'first sale').at;
    const sc = col(table, 'sales/costs').at;
    const p10 = col(table, 'sales/costs p10').at;
    expect(run1![fs]).toBe('1200');
    expect(run1![sc]).toBe('1.00');
    expect(run1![p10]).toBe('-');
    expect(run2![fs]).toBe('1800');
    expect(run2![sc]).toBe('3.00');
    expect(run2![p10]).toBe('-');
  });

  it('rounds the ratio to 2 decimals', () => {
    const t = formatTable([makeResult(1, { salesCostRatio: 2 / 3 })]);
    expect(rows(t)[0]![col(t, 'sales/costs').at]).toBe('0.67');
  });

  it('shows null as - in a per-run row', () => {
    const t = formatTable([makeResult(1)]);
    const r = rows(t)[0]!;
    expect(r[col(t, 'first sale').at]).toBe('-');
    expect(r[col(t, 'sales/costs').at]).toBe('-');
  });

  it('the median row carries the medians of both and the 10th percentile of the ratio', () => {
    const median = rows(table)[2]!;
    expect(median[0]).toBe('median(2)');
    expect(median[col(table, 'first sale').at]).toBe('1500');
    expect(median[col(table, 'sales/costs').at]).toBe('2.00');
    // linear interpolation between ranks: 1 + 0.1 * (3 - 1)
    expect(median[col(table, 'sales/costs p10').at]).toBe('1.20');
  });

  it('interpolates p10 across five runs', () => {
    const five = [1, 2, 3, 4, 5].map(v => makeResult(v, { firstSaleTick: v * 100, salesCostRatio: v }));
    const t = formatTable(five);
    const median = rows(t)[5]!;
    expect(median[0]).toBe('median(5)');
    expect(median[col(t, 'sales/costs').at]).toBe('3.00');
    // position 0.1 * 4 = 0.4 -> 1 + 0.4 * (2 - 1)
    expect(median[col(t, 'sales/costs p10').at]).toBe('1.40');
    expect(median[col(t, 'first sale').at]).toBe('300');
  });

  it('ignores runs without a ratio in the medians and the percentile', () => {
    const t = formatTable([
      makeResult(1, { firstSaleTick: 1000, salesCostRatio: 1 }),
      makeResult(2),
      makeResult(3, { firstSaleTick: 2000, salesCostRatio: 3 }),
    ]);
    const median = rows(t)[3]!;
    expect(median[col(t, 'first sale').at]).toBe('1500');
    expect(median[col(t, 'sales/costs').at]).toBe('2.00');
    expect(median[col(t, 'sales/costs p10').at]).toBe('1.20');
  });

  it('shows - in the median row when no run has a sale', () => {
    const t = formatTable([makeResult(1), makeResult(2)]);
    const median = rows(t)[2]!;
    expect(median[col(t, 'first sale').at]).toBe('-');
    expect(median[col(t, 'sales/costs').at]).toBe('-');
    expect(median[col(t, 'sales/costs p10').at]).toBe('-');
  });

  it('a single run with a ratio has p10 equal to that ratio in its median row', () => {
    const t = formatTable([
      makeResult(1, { firstSaleTick: 900, salesCostRatio: 2.5 }),
      makeResult(2),
    ]);
    const median = rows(t)[2]!;
    expect(median[col(t, 'sales/costs').at]).toBe('2.50');
    expect(median[col(t, 'sales/costs p10').at]).toBe('2.50');
  });

  it('keeps every row as wide as the header', () => {
    const lines = table.split('\n').filter(l => l.trim());
    for (const l of lines) expect(cells(l)).toHaveLength(cells(lines[0]!).length);
  });

  it('toJson carries the new metrics', () => {
    const parsed = JSON.parse(toJson([makeResult(1, { firstSaleTick: 1200, salesCostRatio: 1.5, salesCostWindows: [1, null, 2, 3] })], PROBE_DEFAULTS));
    const m = parsed.results[0].metrics;
    expect(m.firstSaleTick).toBe(1200);
    expect(m.salesCostRatio).toBe(1.5);
    expect(m.salesCostWindows).toEqual([1, null, 2, 3]);
  });
});
