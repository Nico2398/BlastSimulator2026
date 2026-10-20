import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  expandMatrix,
  PROBE_DEFAULTS,
  QUICK_HORIZON,
} from '../../../scripts/shared/probe-config.js';

describe('probe-config parseArgs', () => {
  it('returns the defaults for no arguments', () => {
    expect(parseArgs([])).toEqual(PROBE_DEFAULTS);
  });

  it('parses a comma-separated seed list', () => {
    expect(parseArgs(['--seed', '42,7']).seeds).toEqual([42, 7]);
  });

  it('parses a single seed', () => {
    expect(parseArgs(['--seed', '5']).seeds).toEqual([5]);
  });

  it('parses --biome, --kit and --strategy', () => {
    const o = parseArgs(['--biome', 'green_foothills', '--kit', 'full', '--strategy', 'reinvest']);
    expect(o.biomes).toEqual(['green_foothills']);
    expect(o.kits).toEqual(['full']);
    expect(o.strategies).toEqual(['reinvest']);
  });

  it('parses --horizon and --json', () => {
    const o = parseArgs(['--horizon', '1500', '--json', 'out/probe.json']);
    expect(o.horizon).toBe(1500);
    expect(o.jsonPath).toBe('out/probe.json');
  });

  it('--quick narrows to one cheap run', () => {
    const o = parseArgs(['--quick']);
    expect(o.quick).toBe(true);
    expect(o.seeds).toEqual([42]);
    expect(o.biomes).toEqual(['desert_badlands']);
    expect(o.kits).toEqual(['digger']);
    expect(o.horizon).toBe(QUICK_HORIZON);
    expect(QUICK_HORIZON).toBe(3000);
  });

  it('explicit --horizon overrides --quick in either order', () => {
    expect(parseArgs(['--quick', '--horizon', '800']).horizon).toBe(800);
    expect(parseArgs(['--horizon', '800', '--quick']).horizon).toBe(800);
  });

  it('throws on an unknown flag naming it', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/--bogus/);
  });

  it('throws on unknown biome, kit, strategy naming the value', () => {
    expect(() => parseArgs(['--biome', 'moonbase'])).toThrow(/moonbase/);
    expect(() => parseArgs(['--kit', 'gigantic'])).toThrow(/gigantic/);
    expect(() => parseArgs(['--strategy', 'yolo'])).toThrow(/yolo/);
  });

  it('throws on a non-integer seed naming it', () => {
    expect(() => parseArgs(['--seed', 'abc'])).toThrow(/abc/);
    expect(() => parseArgs(['--seed', '42,1.5'])).toThrow(/1\.5/);
  });

  it('throws on horizon <= 0 or non-integer naming it', () => {
    expect(() => parseArgs(['--horizon', '0'])).toThrow(/0/);
    expect(() => parseArgs(['--horizon', '-5'])).toThrow(/-5/);
    expect(() => parseArgs(['--horizon', 'soon'])).toThrow(/soon/);
  });
});

describe('probe-config expandMatrix', () => {
  it('expands defaults to 24 runs (3 seeds x 2 biomes x 2 kits x 2 strategies)', () => {
    expect(expandMatrix(PROBE_DEFAULTS)).toHaveLength(24);
  });

  it('orders by biome, kit, seed, strategy', () => {
    const runs = expandMatrix(PROBE_DEFAULTS);
    expect(runs[0]).toEqual({
      biome: 'desert_badlands', kit: 'digger', seed: 42, strategy: 'opening', horizon: 10000,
    });
    expect(runs[1]!.strategy).toBe('reinvest');
    expect(runs[1]!.seed).toBe(42);
    expect(runs[2]!.seed).toBe(7);
    expect(runs[6]!.kit).toBe('full');
    expect(runs[12]!.biome).toBe('green_foothills');
    expect(runs[23]).toEqual({
      biome: 'green_foothills', kit: 'full', seed: 13, strategy: 'reinvest', horizon: 10000,
    });
  });

  it('is stable across calls', () => {
    expect(expandMatrix(PROBE_DEFAULTS)).toEqual(expandMatrix(PROBE_DEFAULTS));
  });

  it('carries the horizon into every run', () => {
    const runs = expandMatrix(parseArgs(['--quick']));
    expect(runs).toHaveLength(2);
    expect(runs.every(r => r.horizon === 3000)).toBe(true);
  });

  it('yields no runs for an empty axis', () => {
    expect(expandMatrix({ ...PROBE_DEFAULTS, seeds: [] })).toEqual([]);
  });
});

describe('probe-config ladder strategies (#1945)', () => {
  it('accepts ladder and stay_g1', () => {
    expect(parseArgs(['--strategy', 'ladder,stay_g1']).strategies).toEqual(['ladder', 'stay_g1']);
  });

  it('rejects an unknown strategy naming the value', () => {
    expect(() => parseArgs(['--strategy', 'ladder,warp'])).toThrow(/warp/);
  });

  it('accepts a long horizon', () => {
    expect(parseArgs(['--horizon', '50000']).horizon).toBe(50000);
  });

  it('keeps the defaults for strategies and horizon', () => {
    expect(PROBE_DEFAULTS.strategies).toEqual(['opening', 'reinvest']);
    expect(PROBE_DEFAULTS.horizon).toBe(10000);
  });
});
