import { describe, it, expect } from 'vitest';
import {
  createCharge, batchCharge, landLoadedCharge, computeChargeHoleDurationTicks,
} from '../../../src/core/mining/ChargePlan.js';
import type { PlannedCharge } from '../../../src/core/mining/ChargePlan.js';
import { MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG } from '../../../src/core/config/balance.js';

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

  // ── stemming floor (#527) ──────────────────────────────────────────────────
  // Mirrors the UI's existing 0.5m stemming floor (Charge.ts adjustStemming) so
  // a console charge can never under-stem what a player could ever click.

  it('stemming below MIN_STEMMING_M returns an error, not a charge', () => {
    const result = createCharge('pop_rock', 2, 0.2, 8);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
  });

  it('stemming exactly at MIN_STEMMING_M succeeds (boundary, not off-by-one)', () => {
    const result = createCharge('pop_rock', 2, MIN_STEMMING_M, 8);
    expect('charge' in result).toBe(true);
    if ('charge' in result) {
      expect(result.charge.stemmingM).toBe(MIN_STEMMING_M);
    }
  });

  it('non-finite stemming (NaN) returns an error, not a charge', () => {
    const result = createCharge('pop_rock', 2, NaN, 8);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
  });

  it('non-finite amount (NaN) returns an error, not a charge', () => {
    const result = createCharge('pop_rock', NaN, 1, 8);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
  });

  it('batchCharge surfaces the stemming-floor error per affected hole, not a silent skip', () => {
    const holeIds = ['H1', 'H2', 'H3'];
    const depths: Record<string, number> = { H1: 8, H2: 8, H3: 8 };
    const { charges, errors } = batchCharge(holeIds, depths, 'pop_rock', 2, 0.2);
    expect(Object.keys(charges).length).toBe(0);
    expect(errors.length).toBe(3);
    expect(errors.map(e => e.holeId).sort()).toEqual(['H1', 'H2', 'H3']);
    for (const e of errors) {
      expect(e.message.toLowerCase()).toContain('stemming');
    }
  });
});

// ---------------------------------------------------------------------------
// landLoadedCharge tests (#554)
// ---------------------------------------------------------------------------

describe('landLoadedCharge', () => {
  it('copies a planned charge\'s fields unchanged into the returned HoleCharge', () => {
    const planned: PlannedCharge = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

    const landed = landLoadedCharge(planned);

    expect(landed).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
  });

  it('returns a HoleCharge usable independently of the planned charge (same shape, not a reference copy issue)', () => {
    const planned: PlannedCharge = { explosiveId: 'pop_rock', amountKg: 2, stemmingM: 1.5 };

    const landed = landLoadedCharge(planned);

    expect(landed.explosiveId).toBe(planned.explosiveId);
    expect(landed.amountKg).toBe(planned.amountKg);
    expect(landed.stemmingM).toBe(planned.stemmingM);
  });
});

// ---------------------------------------------------------------------------
// computeChargeHoleDurationTicks tests (#554)
// ---------------------------------------------------------------------------

describe('computeChargeHoleDurationTicks', () => {
  it('reference amount costs exactly CHARGE_HOLE_BASE_DURATION_TICKS', () => {
    const ticks = computeChargeHoleDurationTicks(CHARGE_HOLE_REFERENCE_AMOUNT_KG);
    expect(ticks).toBe(CHARGE_HOLE_BASE_DURATION_TICKS);
  });

  it('double the reference amount roughly doubles the duration (within rounding)', () => {
    const base = computeChargeHoleDurationTicks(CHARGE_HOLE_REFERENCE_AMOUNT_KG);
    const doubled = computeChargeHoleDurationTicks(CHARGE_HOLE_REFERENCE_AMOUNT_KG * 2);
    expect(doubled).toBeGreaterThanOrEqual(base * 2 - 1);
    expect(doubled).toBeLessThanOrEqual(base * 2 + 1);
  });

  it('a very small amount clamps to a minimum of 1 tick, never 0 or negative', () => {
    const ticks = computeChargeHoleDurationTicks(0.001);
    expect(ticks).toBe(1);
  });

  it('zero amount clamps to a minimum of 1 tick', () => {
    const ticks = computeChargeHoleDurationTicks(0);
    expect(ticks).toBe(1);
    expect(ticks).toBeGreaterThan(0);
  });

  it('scales roughly linearly with amount for two arbitrary amounts', () => {
    const light = computeChargeHoleDurationTicks(2);
    const heavy = computeChargeHoleDurationTicks(8);
    expect(heavy).toBeGreaterThan(light);
  });
});
