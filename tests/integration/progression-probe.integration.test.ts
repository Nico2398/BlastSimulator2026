import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/shared/probe-config.js';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import { runMatrix, runProbe } from '../../scripts/shared/probe-strategies.js';
import { toJson } from '../../scripts/shared/probe-report.js';
import type { RunResult } from '../../scripts/shared/probe-metrics.js';

const METRIC_KEYS = [
  'cashAt', 'lowPointCash', 'lowPointTick', 'bankruptTick', 'firstBlastSoldShareAt6000',
  'blastsFired', 'warehouseFullTick', 'ticksHaulWaitedOnFullStorage', 'boulderSoldShare',
  'gradeReachedTick', 'affordableTick', 'firstSaleTick', 'salesCostRatio', 'salesCostWindows',
];

/** Collect every leaf value with its path. */
function leaves(v: unknown, path = ''): Array<[string, unknown]> {
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as object).flatMap(([k, c]) => leaves(c, path ? `${path}.${k}` : k));
  }
  return [[path, v]];
}

function expectFiniteOrAllowedNull(r: RunResult, horizon: number): void {
  // Off the progression ladder (no grade state) every pit sample reads null.
  const offLadder = Object.values(r.metrics.pitDepthAt ?? {}).every(v => v === null);
  for (const [path, value] of leaves(r.metrics)) {
    if (value === null) {
      const m = /^cashAt\.(\d+)$/.exec(path);
      const pit = /^pitDepthAt\.(\d+)$/.exec(path);
      const allowed =
        (m !== null && Number(m[1]) > horizon) ||
        (pit !== null && (offLadder || Number(pit[1]) > horizon)) ||
        path === 'firstBlastSoldShareAt6000' ||
        path === 'boulderSoldShare' ||
        path === 'boulderOreSoldShare' ||
        path === 'catalogBoughtTick' ||
        path === 'bankruptTick' ||
        path === 'firstSaleTick' ||
        path === 'salesCostRatio' ||
        path.startsWith('salesCostWindows.') ||
        path === 'warehouseFullTick' ||
        path.startsWith('affordableTick.');
      expect(allowed, `unexpected null at ${path}`).toBe(true);
    } else {
      expect(typeof value, path).toBe('number');
      expect(Number.isFinite(value as number), path).toBe(true);
    }
  }
}

describe('progression probe integration', () => {
  const opts = parseArgs(['--quick', '--horizon', '1200', '--strategy', 'opening']);

  it('runs the quick matrix to one finite result', () => {
    const seen: RunResult[] = [];
    const results = runMatrix(opts, r => seen.push(r));
    expect(results).toHaveLength(1);
    expect(seen).toHaveLength(1);
    const r = results[0]!;
    for (const k of METRIC_KEYS) expect(r.metrics, k).toHaveProperty(k);
    expectFiniteOrAllowedNull(r, 1200);
    expect(r.metrics.blastsFired).toBeGreaterThanOrEqual(1);
    expect(r.endTick).toBeGreaterThan(0);
    expect(r.endTick).toBeLessThanOrEqual(1200);
    // samples beyond the horizon stay null
    expect(r.metrics.cashAt[3000]).toBeNull();
    expect(r.metrics.cashAt[10000]).toBeNull();
    expect(r.metrics.firstBlastSoldShareAt6000).toBeNull();
  }, 60000);

  it('is deterministic: two runs serialize identically', () => {
    const a = toJson(runMatrix(opts), opts);
    const b = toJson(runMatrix(opts), opts);
    expect(a).toBe(b);
  }, 60000);

  it('reinvest strategy with a short horizon returns finite metrics without throwing', () => {
    const cfg: ProbeRunConfig = {
      seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'reinvest', horizon: 600,
    };
    let r!: RunResult;
    expect(() => { r = runProbe(cfg); }).not.toThrow();
    expect(r.config).toEqual(cfg);
    expectFiniteOrAllowedNull(r, 600);
  }, 60000);

  it('reinvest fires strictly more blasts than the opening on the same setup (#1974)', () => {
    const base = { seed: 42, biome: 'desert_badlands', kit: 'digger', horizon: 6000 } as const;
    const opening = runProbe({ ...base, strategy: 'opening' });
    const reinvest = runProbe({ ...base, strategy: 'reinvest' });
    expectFiniteOrAllowedNull(reinvest, 6000);
    expect(reinvest.metrics.blastsFired).toBeGreaterThan(opening.metrics.blastsFired);
  }, 300000);

  it('never crashes on failure: endReason is null or a reason the run loop produces', () => {
    const r = runProbe({
      seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 300,
    });
    if (r.endReason !== null) expect(r.endReason).toMatch(/^(opening_failed:\w+|stalled|game_over:.+)$/);
    expectFiniteOrAllowedNull(r, 300);
  }, 60000);
});

describe('ladder strategy (#1945)', () => {
  const cfg: ProbeRunConfig = {
    seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'ladder', horizon: 600,
  };

  it('never throws and ends with null or a run-loop reason', () => {
    let r!: RunResult;
    expect(() => { r = runProbe(cfg); }).not.toThrow();
    expect(r.config).toEqual(cfg);
    if (r.endReason !== null) expect(r.endReason).toMatch(/^(opening_failed:\w+|stalled|game_over:.+)$/);
    expect(r.metrics).toHaveProperty('gradeCashAt');
    expect(r.metrics).toHaveProperty('catalogBoughtTick');
    expect(r.metrics).toHaveProperty('boulderOreSoldShare');
  }, 60000);

  it('is deterministic: two runs serialize identically', () => {
    const o = parseArgs(['--quick', '--horizon', '600', '--strategy', 'ladder']);
    expect(toJson(runMatrix(o), o)).toBe(toJson(runMatrix(o), o));
  }, 120000);
});

describe('probe --start-delay (#2118)', () => {
  const base: ProbeRunConfig = { seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 1200 };

  it('a delay of 0 leaves the run identical to no delay at all', () => {
    const plain = runProbe(base);
    const zero = runProbe({ ...base, startDelay: 0 });
    expect(zero.metrics).toEqual(plain.metrics);
    expect(zero.endTick).toBe(plain.endTick);
    expect(zero.endReason).toBe(plain.endReason);
  }, 120000);

  it('with no delay the opening fires its first blast inside the horizon', () => {
    expect(runProbe(base).metrics.blastsFired).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('a delay nearly as long as the horizon keeps the first order, and so every blast, out of the run', () => {
    const r = runProbe({ ...base, startDelay: 1150 });
    expect(r.metrics.blastsFired).toBe(0);
    expect(r.endTick).toBeGreaterThanOrEqual(1150);
    expect(r.endTick).toBeLessThanOrEqual(1200);
    expect(r.config.startDelay).toBe(1150);
  }, 120000);

  it('a delayed run is deterministic', () => {
    const o = parseArgs(['--quick', '--strategy', 'opening', '--horizon', '700', '--start-delay', '300']);
    expect(toJson(runMatrix(o), o)).toBe(toJson(runMatrix(o), o));
  }, 240000);

  it('events during the delay are answered by the run event policy: the delayed run still ends without a stall', () => {
    const r = runProbe({ ...base, horizon: 900, startDelay: 600, eventPolicy: 'cheapest' });
    if (r.endReason !== null) expect(r.endReason).toMatch(/^(opening_failed:\w+|game_over:.+)$/);
    expect(r.endReason).not.toBe('stalled');
    expect(r.endTick).toBeGreaterThanOrEqual(600);
  }, 120000);

  it('reinvest honours the delay too', () => {
    const r = runProbe({ ...base, strategy: 'reinvest', horizon: 400, startDelay: 380 });
    expect(r.metrics.blastsFired).toBe(0);
  }, 120000);
});
