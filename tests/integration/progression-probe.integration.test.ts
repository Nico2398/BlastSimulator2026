// BlastSimulator2026 — Progression probe integration: the quick matrix and the ladder strategy
//
// The probe runs to finite metrics, deterministically, and fails without crashing. Split from progression-probe.integration.test.ts so the probe's
// long runs execute in parallel (tests/helpers/progressionProbe.ts says why).

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/shared/probe-config.js';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import { runMatrix, runProbe } from '../../scripts/shared/probe-strategies.js';
import { toJson } from '../../scripts/shared/probe-report.js';
import type { RunResult } from '../../scripts/shared/probe-metrics.js';
import { METRIC_KEYS, expectFiniteOrAllowedNull } from '../helpers/progressionProbe.js';

describe('progression probe integration', () => {
  const opts = parseArgs(['--quick', '--horizon', '1200', '--strategy', 'opening']);
  /** The first case's matrix, kept as one of the determinism case's two runs (a run is ~2 s; the cases only read it). */
  let firstMatrix: RunResult[] | undefined;

  it('runs the quick matrix to one finite result', () => {
    const seen: RunResult[] = [];
    const results = runMatrix(opts, r => seen.push(r));
    firstMatrix = results;
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
    // Two independent runs: the first case's (when it ran) and a fresh one.
    const a = toJson(firstMatrix ?? runMatrix(opts), opts);
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
