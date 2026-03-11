import { describe, it, expect } from 'vitest';
import { createCharge, batchCharge } from '../../../src/core/mining/ChargePlan.js';

describe('ChargePlan', () => {
  it('charging a hole stores explosive type and amount', () => {
    const result = createCharge('pop_rock', 2, 1, 8);
    expect('charge' in result).toBe(true);
    if ('charge' in result) {
      expect(result.charge.explosiveId).toBe('pop_rock');
      expect(result.charge.amountKg).toBe(2);
      expect(result.charge.stemmingM).toBe(1);
    }
  });

  it('batch charge hole:* charges all holes identically', () => {
    const holeIds = ['H1', 'H2', 'H3'];
    const depths: Record<string, number> = { H1: 8, H2: 8, H3: 8 };
    const { charges, errors } = batchCharge(holeIds, depths, 'pop_rock', 2, 1.5);
    expect(errors.length).toBe(0);
    expect(Object.keys(charges).length).toBe(3);
    expect(charges['H1']!.explosiveId).toBe('pop_rock');
  });

  it('invalid explosive ID returns an error', () => {
    const result = createCharge('nonexistent', 2, 1, 8);
    expect('error' in result).toBe(true);
  });

  it('amount outside min/max range returns error', () => {
    // pop_rock max is 3kg
    const result = createCharge('pop_rock', 10, 1, 8);
    expect('error' in result).toBe(true);
  });

  it('stemming exceeding hole depth returns error', () => {
    const result = createCharge('pop_rock', 2, 10, 8);
    expect('error' in result).toBe(true);
  });
});
