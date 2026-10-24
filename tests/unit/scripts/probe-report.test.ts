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
      deepestPitM: 10.2,
      warehouseFullTick: 900,
      ticksHaulWaitedOnFullStorage: 17,
      boulderSoldShare: null,
      gradeReachedTick: { 1: 0, 2: 2500 },
      gradeCashAt: { 1: 90000, 2: 80000 },
      catalogBoughtTick: null,
      boulderOreSoldShare: null,
      affordableTick: { warehouseT2: 1500, researchCenter: null, secondHauler: 2000 },
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
      'seed', 'biome', 'kit', 'strategy', 'low cash', 'low tick', 'bankrupt', 'blasts', 'pit m',
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

  it('shows the deepest pit with one decimal', () => {
    expect(lines[2]).toContain('10.2');
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
