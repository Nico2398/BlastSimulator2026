import { beforeAll, describe, it, expect } from 'vitest';
import { formatGradeSummary, formatMilestoneSummary, formatTable, toJson } from '../../../scripts/shared/probe-report.js';
import { PROBE_DEFAULTS } from '../../../scripts/shared/probe-config.js';
import { FRONTIER_MARKS, type RunResult } from '../../../scripts/shared/probe-metrics.js';
import { getAllQuests } from '../../../src/core/economy/QuestCatalog.js';

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
      affordableTick: { warehouseT2: 1500, secondHauler: 2000 },
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
      'warehousefull', 'boulder', 'grade', 'warehouset2', 'secondhauler',
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

const rowCells = (l: string): string[] => l.split('|').slice(1, -1).map(c => c.trim());

describe('probe-report quest and frontier columns (#2322)', () => {
  const withTicks = makeResult(1, {
    questTicks: { quest_explosive_t2: 1200, quest_building_t2: 800 },
    frontierTicks: { bench2: 500, shuttle: 2600 },
  });
  const table = formatTable([withTicks, makeResult(2)]);
  const lines = table.split('\n').filter(l => l.trim());
  const header = rowCells(lines[0]!);
  const questAt = header.indexOf('quest ticks');
  const frontierAt = header.indexOf('frontier');
  const words = (c: string) => c.split(' ').sort();

  it('puts quest ticks and frontier right after grade cash', () => {
    expect(header.indexOf('grade cash')).toBeGreaterThanOrEqual(0);
    expect(questAt).toBe(header.indexOf('grade cash') + 1);
    expect(frontierAt).toBe(questAt + 1);
  });

  it('lists id@tick pairs of a run space separated', () => {
    const r = rowCells(lines[2]!);
    expect(words(r[questAt]!)).toEqual(['quest_building_t2@800', 'quest_explosive_t2@1200']);
    expect(words(r[frontierAt]!)).toEqual(['bench2@500', 'shuttle@2600']);
  });

  it('shows - for a run without quests or marks', () => {
    const r = rowCells(lines[3]!);
    expect(r[questAt]).toBe('-');
    expect(r[frontierAt]).toBe('-');
  });

  it('shows - in both columns of the median row', () => {
    const r = rowCells(lines[4]!);
    expect(r[0]).toBe('median(2)');
    expect(r[questAt]).toBe('-');
    expect(r[frontierAt]).toBe('-');
  });

  it('keeps every row as wide as the header', () => {
    for (const l of lines) expect(rowCells(l)).toHaveLength(header.length);
  });
});

describe('probe-report formatGradeSummary earn/tick (#2322)', () => {
  const ladder = (seed: number, over: Partial<RunResult['metrics']>): RunResult => {
    const r = makeResult(seed, over);
    r.config.strategy = 'ladder';
    return r;
  };
  const rows = (out: string) => out.split('\n').filter(l => l.trim()).map(rowCells);

  it('has an earn/tick column right before window', () => {
    const header = rows(formatGradeSummary([ladder(1, {})]))[0]!;
    expect(header).toContain('earn/tick');
    expect(header.indexOf('earn/tick')).toBe(header.indexOf('window') - 1);
  });

  it('shows the median over reaching runs with 2 decimals', () => {
    const out = rows(formatGradeSummary([
      ladder(1, { gradeReachedTick: { 1: 100 }, gradeEarnPerTick: { 1: 2.5 } }),
      ladder(2, { gradeReachedTick: { 1: 200 }, gradeEarnPerTick: { 1: 3.75 } }),
      ladder(3, { gradeReachedTick: {}, gradeEarnPerTick: { 1: 900 } }),
    ]));
    const at = out[0]!.indexOf('earn/tick');
    const g1 = out.find(r => r[3] === '1')!;
    expect(g1[at]).toBe('3.13');
  });

  it('rounds to 2 decimals', () => {
    const out = rows(formatGradeSummary([ladder(1, { gradeReachedTick: { 1: 100 }, gradeEarnPerTick: { 1: 2 / 3 } })]));
    expect(out.find(r => r[3] === '1')![out[0]!.indexOf('earn/tick')]).toBe('0.67');
  });

  it('shows - for a grade no run reached or without earnings, and on tier rows', () => {
    const r = ladder(1, { gradeReachedTick: { 1: 100, 2: 200 }, gradeEarnPerTick: { 1: 1 }, tierReachedTick: { '1.1': 1000 } });
    const out = rows(formatGradeSummary([r]));
    const at = out[0]!.indexOf('earn/tick');
    expect(out.find(x => x[3] === '3')![at]).toBe('-');
    expect(out.find(x => x[3] === '2')![at]).toBe('-');
    expect(out.find(x => x[3] === 't1.1')![at]).toBe('-');
  });

  it('keeps every row as wide as the header', () => {
    const out = rows(formatGradeSummary([ladder(1, { gradeReachedTick: { 1: 100 }, gradeEarnPerTick: { 1: 1 } })]));
    for (const r of out) expect(r).toHaveLength(out[0]!.length);
  });
});

describe('probe-report formatMilestoneSummary (#2322)', () => {
  const questIds = getAllQuests().map(q => q.id);
  const first = questIds[0]!;
  const ladder = (seed: number, over: Partial<RunResult['metrics']>, strategy: RunResult['config']['strategy'] = 'ladder'): RunResult => {
    const r = makeResult(seed, over);
    r.config.strategy = strategy;
    return r;
  };
  const rows = (out: string) => out.split('\n').filter(l => l.trim()).map(rowCells);
  const group = [
    ladder(1, { questTicks: { [first]: 100 }, frontierTicks: { bench2: 400, shuttle: 3000 } }),
    ladder(2, { questTicks: { [first]: 300 }, frontierTicks: { bench2: 600 } }),
    ladder(3, {}),
  ];
  let out: string[][] = [];
  beforeAll(() => { out = rows(formatMilestoneSummary(group)); });

  it('has the milestone headers', () => {
    expect(out[0]).toEqual(['biome', 'kit', 'strategy', 'milestone', 'reached', 'median tick']);
    expect(out[1]!.every(c => /^:?-+:?$/.test(c))).toBe(true);
  });

  it('lists one row per catalog quest, then per frontier mark, in order', () => {
    const body = out.slice(2);
    expect(body.map(r => r[3])).toEqual([
      ...questIds.map(id => `quest:${id}`),
      ...FRONTIER_MARKS.map(m => `frontier:${m}`),
    ]);
    for (const r of body) expect(r).toHaveLength(6);
    expect(body[0]!.slice(0, 3)).toEqual(['desert_badlands', 'digger', 'ladder']);
  });

  it('shows runs reached over runs total and the median tick of the reaching runs', () => {
    const body = out.slice(2);
    const quest = body.find(r => r[3] === `quest:${first}`)!;
    expect(quest[4]).toBe('2/3');
    expect(quest[5]).toBe('200');
    const bench = body.find(r => r[3] === 'frontier:bench2')!;
    expect(bench[4]).toBe('2/3');
    expect(bench[5]).toBe('500');
    const shuttle = body.find(r => r[3] === 'frontier:shuttle')!;
    expect(shuttle[4]).toBe('1/3');
    expect(shuttle[5]).toBe('3000');
  });

  it('shows 0/n and - for a milestone no run reached', () => {
    const treranium = out.slice(2).find(r => r[3] === 'frontier:treranium')!;
    expect(treranium[4]).toBe('0/3');
    expect(treranium[5]).toBe('-');
  });

  it('writes one block of rows per (biome, kit, strategy) group', () => {
    const two = rows(formatMilestoneSummary([...group, ladder(4, {}, 'reinvest')])).slice(2);
    expect(two).toHaveLength(2 * (questIds.length + FRONTIER_MARKS.length));
    expect(new Set(two.map(r => r[2]))).toEqual(new Set(['ladder', 'reinvest']));
  });

  it('is deterministic and an empty list yields header and separator only', () => {
    expect(formatMilestoneSummary(group)).toBe(formatMilestoneSummary(group));
    expect(rows(formatMilestoneSummary([]))).toHaveLength(2);
  });
});
