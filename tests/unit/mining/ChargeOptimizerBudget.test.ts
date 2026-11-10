// BlastSimulator2026 — charge optimizer work budget (#2204)

import { describe, it, expect } from 'vitest';
import { optimizerSweepSteps } from '../../../src/core/mining/ChargeOptimizer.js';
import { OPTIMIZER_SWEEP_STEPS, OPTIMIZER_MIN_SWEEP_STEPS } from '../../../src/core/config/balance.js';

describe('optimizerSweepSteps', () => {
  it('sweeps fully on a small pattern', () => {
    expect(optimizerSweepSteps(9, 8)).toBe(OPTIMIZER_SWEEP_STEPS);
  });
  it('sweeps fewer amounts on the largest grade pattern', () => {
    const steps = optimizerSweepSteps(400, 8);
    expect(steps).toBeLessThan(OPTIMIZER_SWEEP_STEPS);
    expect(steps).toBeGreaterThanOrEqual(OPTIMIZER_MIN_SWEEP_STEPS);
  });
  it('never drops below the minimum, even for a huge pattern', () => {
    expect(optimizerSweepSteps(10_000, 8)).toBe(OPTIMIZER_MIN_SWEEP_STEPS);
  });
  it('tolerates an empty pattern', () => {
    expect(optimizerSweepSteps(0, 0)).toBe(OPTIMIZER_SWEEP_STEPS);
  });
});
