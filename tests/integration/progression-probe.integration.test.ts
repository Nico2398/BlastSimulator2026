import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/shared/probe-config.js';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import { runMatrix, runProbe } from '../../scripts/shared/probe-strategies.js';
import { toJson } from '../../scripts/shared/probe-report.js';
import type { RunResult } from '../../scripts/shared/probe-metrics.js';

const METRIC_KEYS = [
  'cashAt', 'lowPointCash', 'lowPointTick', 'bankruptTick', 'firstBlastSoldShareAt6000',
  'blastsFired', 'warehouseFullTick', 'ticksHaulWaitedOnFullStorage', 'boulderSoldShare',
  'gradeReachedTick', 'affordableTick',
];

/** Collect every leaf value with its path. */
function leaves(v: unknown, path = ''): Array<[string, unknown]> {
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as object).flatMap(([k, c]) => leaves(c, path ? `${path}.${k}` : k));
  }
  return [[path, v]];
}

function expectFiniteOrAllowedNull(r: RunResult, horizon: number): void {
  for (const [path, value] of leaves(r.metrics)) {
    if (value === null) {
      const m = /^cashAt\.(\d+)$/.exec(path);
      const allowed =
        (m !== null && Number(m[1]) > horizon) ||
        path === 'firstBlastSoldShareAt6000' ||
        path === 'boulderSoldShare' ||
        path === 'bankruptTick' ||
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
    const r = results[0];
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

  it('never crashes on failure: endReason is null or names the failed opening step', () => {
    const r = runProbe({
      seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 300,
    });
    if (r.endReason !== null) expect(r.endReason).toMatch(/^opening_failed:.+|.+/);
    expectFiniteOrAllowedNull(r, 300);
  }, 60000);
});
