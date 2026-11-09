// BlastSimulator2026 — Progression probe integration: --start-delay
//
// A start delay holds the first order back and leaves an undelayed run identical. Split from progression-probe.integration.test.ts so the probe's
// long runs execute in parallel (tests/helpers/progressionProbe.ts says why).

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/shared/probe-config.js';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import { runMatrix, runProbe } from '../../scripts/shared/probe-strategies.js';
import { toJson } from '../../scripts/shared/probe-report.js';
import type { RunResult } from '../../scripts/shared/probe-metrics.js';

describe('probe --start-delay (#2118)', () => {
  const base: ProbeRunConfig = { seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 1200 };
  /** The undelayed run, played once for the two cases that only read it (a run is ~2 s). */
  let plainRun: RunResult | undefined;
  const plainBase = (): RunResult => (plainRun ??= runProbe(base));

  it('a delay of 0 leaves the run identical to no delay at all', () => {
    const plain = plainBase();
    const zero = runProbe({ ...base, startDelay: 0 });
    expect(zero.metrics).toEqual(plain.metrics);
    expect(zero.endTick).toBe(plain.endTick);
    expect(zero.endReason).toBe(plain.endReason);
  }, 120000);

  it('with no delay the opening fires its first blast inside the horizon', () => {
    expect(plainBase().metrics.blastsFired).toBeGreaterThanOrEqual(1);
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
