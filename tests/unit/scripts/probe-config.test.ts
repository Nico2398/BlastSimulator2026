import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  expandMatrix,
  PROBE_DEFAULTS,
  QUICK_HORIZON,
  LADDER_REFERENCE_SITE,
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

describe('probe-config ladder reference site', () => {
  const reference = { seeds: [LADDER_REFERENCE_SITE.seed], biomes: [LADDER_REFERENCE_SITE.biome], kits: [LADDER_REFERENCE_SITE.kit] };

  it('runs a ladder-only matrix on the one reference site', () => {
    expect(parseArgs(['--strategy', 'ladder'])).toMatchObject(reference);
    expect(parseArgs(['--strategy', 'ladder,stay_g1', '--horizon', '50000'])).toMatchObject(reference);
    expect(expandMatrix(parseArgs(['--strategy', 'ladder']))).toHaveLength(1);
  });

  it('lets a named seed, biome or kit win, the rest staying on the reference site', () => {
    expect(parseArgs(['--strategy', 'ladder', '--seed', '42,7,13'])).toMatchObject({ ...reference, seeds: [42, 7, 13] });
    expect(parseArgs(['--strategy', 'ladder', '--biome', 'green_foothills'])).toMatchObject({ ...reference, biomes: ['green_foothills'] });
    expect(parseArgs(['--strategy', 'ladder', '--kit', 'digger'])).toMatchObject({ ...reference, kits: ['digger'] });
  });

  it('keeps the full matrix when an early-game strategy runs too, and --quick its own site', () => {
    const mixed = parseArgs(['--strategy', 'ladder,reinvest']);
    expect(mixed.seeds).toEqual(PROBE_DEFAULTS.seeds);
    expect(mixed.biomes).toEqual(PROBE_DEFAULTS.biomes);
    expect(parseArgs(['--quick', '--strategy', 'ladder']).kits).toEqual(['digger']);
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

describe('probe-config --event-policy (#2117)', () => {
  it('defaults to first', () => {
    expect(PROBE_DEFAULTS.eventPolicy).toBe('first');
    expect(parseArgs([]).eventPolicy).toBe('first');
  });

  it('parses first and cheapest', () => {
    expect(parseArgs(['--event-policy', 'first']).eventPolicy).toBe('first');
    expect(parseArgs(['--event-policy', 'cheapest']).eventPolicy).toBe('cheapest');
  });

  it('combines with other flags in either order', () => {
    const o = parseArgs(['--event-policy', 'cheapest', '--seed', '7', '--quick']);
    expect(o.eventPolicy).toBe('cheapest');
    expect(o.seeds).toEqual([7]);
    expect(parseArgs(['--quick', '--event-policy', 'cheapest']).eventPolicy).toBe('cheapest');
  });

  it('throws on an unknown policy naming it', () => {
    expect(() => parseArgs(['--event-policy', 'priciest'])).toThrow(/priciest/);
  });

  it('throws when the value is missing', () => {
    expect(() => parseArgs(['--event-policy'])).toThrow(/--event-policy/);
    expect(() => parseArgs(['--event-policy', '--quick'])).toThrow();
  });

  it('expandMatrix carries a cheapest policy into every run', () => {
    const runs = expandMatrix(parseArgs(['--event-policy', 'cheapest']));
    expect(runs).toHaveLength(24);
    expect(runs.every(r => r.eventPolicy === 'cheapest')).toBe(true);
  });

  it('expandMatrix leaves every run on first by default', () => {
    const runs = expandMatrix(PROBE_DEFAULTS);
    expect(runs.every(r => (r.eventPolicy ?? 'first') === 'first')).toBe(true);
  });
});

describe('probe-config --start-delay (#2118)', () => {
  it('defaults to 0 and the defaults stay equal to a bare parse', () => {
    expect(PROBE_DEFAULTS.startDelay).toBe(0);
    expect(parseArgs([]).startDelay).toBe(0);
    expect(parseArgs([])).toEqual(PROBE_DEFAULTS);
  });

  it('parses a positive integer', () => {
    expect(parseArgs(['--start-delay', '400']).startDelay).toBe(400);
    expect(parseArgs(['--start-delay', '1']).startDelay).toBe(1);
  });

  it('accepts an explicit 0', () => {
    expect(parseArgs(['--start-delay', '0']).startDelay).toBe(0);
  });

  it('combines with other flags in any order', () => {
    const a = parseArgs(['--quick', '--start-delay', '250', '--horizon', '900']);
    const b = parseArgs(['--horizon', '900', '--start-delay', '250', '--quick']);
    expect(a.startDelay).toBe(250);
    expect(b.startDelay).toBe(250);
    expect(a).toEqual(b);
  });

  it('throws on a negative value naming it', () => {
    expect(() => parseArgs(['--start-delay', '-5'])).toThrow(/-5/);
  });

  it('throws on a non-integer value naming it', () => {
    expect(() => parseArgs(['--start-delay', '1.5'])).toThrow(/1\.5/);
    expect(() => parseArgs(['--start-delay', 'soon'])).toThrow(/soon/);
  });

  it('throws when the value is missing', () => {
    expect(() => parseArgs(['--start-delay'])).toThrow(/start-delay/);
    expect(() => parseArgs(['--start-delay', '--quick'])).toThrow();
  });

  it('expandMatrix puts startDelay on every run only when above 0', () => {
    const runs = expandMatrix(parseArgs(['--start-delay', '300']));
    expect(runs).toHaveLength(24);
    for (const run of runs) expect(run.startDelay).toBe(300);
  });

  it('expandMatrix leaves the key off a run at the default 0', () => {
    for (const run of expandMatrix(PROBE_DEFAULTS)) expect(run).not.toHaveProperty('startDelay');
    for (const run of expandMatrix(parseArgs(['--start-delay', '0']))) expect(run).not.toHaveProperty('startDelay');
  });

  it('a default run config is unchanged by the new option', () => {
    expect(expandMatrix(PROBE_DEFAULTS)[0]).toEqual({
      biome: 'desert_badlands', kit: 'digger', seed: 42, strategy: 'opening', horizon: 10000,
    });
  });

  it('startDelay and the event policy ride the same run config', () => {
    const runs = expandMatrix(parseArgs(['--start-delay', '120', '--event-policy', 'cheapest']));
    expect(runs[0]).toMatchObject({ startDelay: 120, eventPolicy: 'cheapest' });
  });
});
