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
