import { describe, it, expect } from 'vitest';
import {
  createCharge, batchCharge, landLoadedCharge, computeChargeHoleDurationTicks, chargeOrderCost,
  chargeColumnM, maxChargeKgForHole,
} from '../../../src/core/mining/ChargePlan.js';
import type { PlannedCharge } from '../../../src/core/mining/ChargePlan.js';
import { MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS, CHARGE_HOLE_REFERENCE_AMOUNT_KG, CHARGE_KG_PER_METRE } from '../../../src/core/config/balance.js';

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

describe('chargeOrderCost (#1341)', () => {
  it('is costPerKg * amountKg for a known explosive', () => {
    expect(chargeOrderCost('dynatomics', 20)).toBe(4000);
    expect(chargeOrderCost('boomite', 5)).toBe(60);
  });

  it('is 0 for zero kg (boundary)', () => {
    expect(chargeOrderCost('dynatomics', 0)).toBe(0);
  });

  it('is 0 for an unknown explosive id (rejection)', () => {
    expect(chargeOrderCost('nonexistent', 10)).toBe(0);
  });

  it('scales linearly with amount', () => {
    expect(chargeOrderCost('pop_rock', 2.5)).toBe(12.5);
  });
});


// ---------------------------------------------------------------------------
// Charge column must fit the hole (#1361)
// ---------------------------------------------------------------------------

describe('chargeColumnM (#1361)', () => {
  it('is amountKg / CHARGE_KG_PER_METRE', () => {
    expect(CHARGE_KG_PER_METRE).toBe(2);
    expect(chargeColumnM(8)).toBe(4);
    expect(chargeColumnM(5)).toBe(2.5);
  });

  it('is 0 for a zero charge', () => {
    expect(chargeColumnM(0)).toBe(0);
  });

  it('scales linearly', () => {
    expect(chargeColumnM(2)).toBeCloseTo(2 * chargeColumnM(1), 10);
  });
});

describe('maxChargeKgForHole (#1361)', () => {
  it('is (depth - stemming) * kgPerMetre', () => {
    expect(maxChargeKgForHole(6, 2)).toBe(8);
    expect(maxChargeKgForHole(8, 0.5)).toBe(15);
  });

  it('is 0 when stemming equals depth', () => {
    expect(maxChargeKgForHole(6, 6)).toBe(0);
  });

  it('is 0, never negative, when stemming exceeds depth', () => {
    expect(maxChargeKgForHole(6, 7)).toBe(0);
    expect(maxChargeKgForHole(1, 100)).toBe(0);
  });

  it('round-trips with chargeColumnM: the max charge fills exactly the space under the stemming', () => {
    const max = maxChargeKgForHole(6, 2);
    expect(chargeColumnM(max) + 2).toBe(6);
  });
});

describe('createCharge — column must fit the hole (#1361)', () => {
  it('createCharge(rumblox, 12, 2, 6) is refused by the column rule and the message mentions 8', () => {
    const result = createCharge('rumblox', 12, 2, 6);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
    if ('error' in result) {
      expect(result.error).not.toContain('out of range');
      expect(result.error).toContain('8');
    }
  });

  it('refuses rumblox 12 kg + 2 m stemming in a 6 m hole (in range, column overflows) and names the 8 kg maximum', () => {
    const result = createCharge('rumblox', 12, 2, 6);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
    if ('error' in result) expect(result.error).toMatch(/\b8(\.0)?\b/);
  });

  it('accepts the exact boundary: 8 kg + 2 m stemming in a 6 m hole', () => {
    const result = createCharge('boomite', 8, 2, 6);
    expect('charge' in result).toBe(true);
    if ('charge' in result) expect(result.charge).toEqual({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
  });

  it('refuses 8.5 kg + 2 m stemming in a 6 m hole (just over the boundary)', () => {
    // krackle (1-10 kg) allows 8.5 kg, so only the column check can refuse it.
    const result = createCharge('krackle', 8.5, 2, 6);
    expect('error' in result).toBe(true);
  });

  it('reports the max floored to 0.1 kg, not rounded up', () => {
    // depth 5.07, stemming 1 -> raw max 8.14 -> "8.1"
    const result = createCharge('krackle', 8.5, 1, 5.07);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('8.1');
      expect(result.error).not.toContain('8.2');
    }
  });

  it('a column that fits leaves no error for small charges in deep holes', () => {
    expect('charge' in createCharge('boomite', 1, 0.5, 2)).toBe(true);
    expect('charge' in createCharge('pop_rock', 2, 1.5, 8)).toBe(true);
  });

  it('keeps the unknown-explosive refusal ahead of the column check', () => {
    const result = createCharge('nonexistent', 100, 2, 6);
    expect('error' in result && result.error).toContain('Unknown explosive');
  });

  it('keeps the amount-range refusal ahead of the column check', () => {
    const result = createCharge('boomite', 999, 2, 6);
    expect('error' in result && result.error).toContain('out of range');
  });

  it('keeps the minimum-stemming refusal ahead of the column check', () => {
    const result = createCharge('boomite', 8, 0.2, 6);
    expect('error' in result && result.error.toLowerCase()).toContain('stemming');
    expect('error' in result && result.error).toContain('below minimum');
  });

  it('keeps the stemming-exceeds-depth refusal ahead of the column check', () => {
    const result = createCharge('boomite', 8, 10, 6);
    expect('error' in result && result.error).toContain('exceeds hole depth');
  });

  it('the localized column error is not the stemming-exceeds-depth message', () => {
    const result = createCharge('boomite', 8, 5, 6);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).not.toContain('exceeds hole depth');
  });

  it('batchCharge reports the column error for every hole too shallow, charging none of them', () => {
    const depths: Record<string, number> = { H1: 6, H2: 6 };
    const { charges, errors } = batchCharge(['H1', 'H2'], depths, 'boomite', 8, 3);
    expect(Object.keys(charges)).toHaveLength(0);
    expect(errors.map(e => e.holeId).sort()).toEqual(['H1', 'H2']);
  });

  it('batchCharge charges the deep holes and errors only the shallow one', () => {
    const depths: Record<string, number> = { H1: 8, H2: 4 };
    const { charges, errors } = batchCharge(['H1', 'H2'], depths, 'boomite', 5, 2);
    expect(Object.keys(charges)).toEqual(['H1']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.holeId).toBe('H2');
  });
});
