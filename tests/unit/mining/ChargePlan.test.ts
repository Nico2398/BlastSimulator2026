import { describe, it, expect } from 'vitest';
import {
  createCharge, batchCharge, landLoadedCharge, computeChargeHoleDurationTicks, computeChargeDurationTicks, chargeOrderCost,
  chargeColumnM, maxChargeKgForHole,
  chargeFitsHole, maxFittingChargeKg, fillChargeKg,
  plannedChargesCost,
  holeSpacingM, holeCellSize, patternAreaM2, powderFactor, holePowderFactors,
} from '../../../src/core/mining/ChargePlan.js';
import * as chargePlan from '../../../src/core/mining/ChargePlan.js';
import type { PlannedCharge } from '../../../src/core/mining/ChargePlan.js';
import { computeTaskDuration } from '../../../src/core/entities/EmployeeTaskDuration.js';
import { createGridPlan, type DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { chargeKgPerMetre } from '../../../src/core/mining/HoleDiameter.js';
import { t } from '../../../src/core/i18n/I18n.js';
import {
  DRILL_GRID_DEFAULT_SPACING_M, VEHICLE_TIER_MULTIPLIERS, MIN_STEMMING_M, CHARGE_HOLE_BASE_DURATION_TICKS,
  CHARGE_HOLE_REFERENCE_AMOUNT_KG, CHARGE_KG_PER_METRE, HOLE_CELL_MAX_SIDE_M,
} from '../../../src/core/config/balance.js';

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

  it('an amount whose column overflows the hole returns an error', () => {
    // pop_rock holds 1.375 kg/m in an 89 mm hole: 10 kg is a 7.3 m column, 8.3 m with the stemming.
    const result = createCharge('pop_rock', 10, 1, 8);
    expect('error' in result).toBe(true);
  });

  it('an amount past the old per-explosive cap is accepted when it fits (no kg range any more)', () => {
    // pop_rock was capped at 3 kg per hole; 5 kg is a 3.6 m column, well inside an 8 m hole.
    const result = createCharge('pop_rock', 5, 1, 8);
    expect('charge' in result && result.charge.amountKg).toBe(5);
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

  it('a zero, negative or infinite explicit amount returns an error, not a charge', () => {
    for (const amount of [0, -2, Infinity]) {
      const result = createCharge('boomite', amount, 1, 8);
      expect('error' in result, String(amount)).toBe(true);
      expect('charge' in result, String(amount)).toBe(false);
    }
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
  // Boomite is the reference density (2 kg/m in an 89 mm hole), so 4 m under the stemming holds 8 kg.
  it('createCharge(boomite, 12, 2, 6) is refused by the column rule and the message mentions 8', () => {
    const result = createCharge('boomite', 12, 2, 6);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
    if ('error' in result) {
      expect(result.error).not.toContain('out of range');
      expect(result.error).toContain('8');
    }
  });

  it('refuses boomite 12 kg + 2 m stemming in a 6 m hole and names the 8 kg maximum', () => {
    const result = createCharge('boomite', 12, 2, 6);
    expect('error' in result).toBe(true);
    expect('charge' in result).toBe(false);
    if ('error' in result) expect(result.error).toMatch(/\b8(\.0)?\b/);
  });

  it('measures the column at the explosive\'s own density: rumblox (3 kg/m) fits 12 kg where boomite fits 8', () => {
    expect('charge' in createCharge('rumblox', 12, 2, 6)).toBe(true);
    const over = createCharge('rumblox', 13, 2, 6);
    expect('error' in over).toBe(true);
    if ('error' in over) expect(over.error).toMatch(/\b12(\.0)?\b/);
  });

  it('accepts the exact boundary: 8 kg + 2 m stemming in a 6 m hole', () => {
    const result = createCharge('boomite', 8, 2, 6);
    expect('charge' in result).toBe(true);
    if ('charge' in result) expect(result.charge).toEqual({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
  });

  it('refuses 8.5 kg + 2 m stemming in a 6 m hole (just over the boundary)', () => {
    // No per-explosive kg range: only the column check can refuse it.
    const result = createCharge('boomite', 8.5, 2, 6);
    expect('error' in result).toBe(true);
  });

  it('reports the max floored to 0.1 kg, not rounded up', () => {
    // depth 5.07, stemming 1 -> raw max 8.14 -> "8.1"
    const result = createCharge('boomite', 8.5, 1, 5.07);
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

  it('an oversized amount is refused by the column rule alone, naming the maximum that fits (no kg range)', () => {
    const result = createCharge('boomite', 999, 2, 6);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).not.toContain('out of range');
      expect(result.error).toBe(t('mining.charge.column_exceeds_hole', {
        amount: 999, column: +chargeColumnM(999, undefined, 'boomite').toFixed(2), stemming: 2, depth: 6, max: 8,
      }));
    }
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

describe('ChargePlan module surface (#2197)', () => {
  it('no longer exports the weak-explosive summary', () => {
    expect(Object.keys(chargePlan)).not.toContain('weakHoleSummary');
  });
});

describe('computeChargeDurationTicks (#1649)', () => {
  it('tier 1 with defaults equals the unscaled task duration', () => {
    expect(computeChargeDurationTicks(60, 1)).toBe(computeTaskDuration(60, 1, 1, 1, 1));
  });

  it.each([1, 2, 3] as const)('tier %s divides base ticks by the tier work rate before proficiency scaling', (tier) => {
    expect(computeChargeDurationTicks(120, tier, 3, 0.9, 0.85))
      .toBe(computeTaskDuration(120 / VEHICLE_TIER_MULTIPLIERS[tier].workRate, 3, 0.9, 0.85, 1));
  });

  it('a tier 3 truck takes fewer ticks than tier 1, tier 2 in between', () => {
    const t1 = computeChargeDurationTicks(120, 1);
    const t2 = computeChargeDurationTicks(120, 2);
    const t3 = computeChargeDurationTicks(120, 3);
    expect(t3).toBeLessThan(t2);
    expect(t2).toBeLessThan(t1);
  });

  it('never drops below one tick for a tiny base', () => {
    expect(computeChargeDurationTicks(0.01, 3)).toBeGreaterThanOrEqual(1);
  });

  it('a higher proficiency level shortens the duration', () => {
    expect(computeChargeDurationTicks(120, 2, 5)).toBeLessThan(computeChargeDurationTicks(120, 2, 1));
  });
});

// ── planned cost: every load is paid at list price (#2153) ──────────────────
// Boomite lists at $12/kg (chargeOrderCost), so 5 kg = $60.

describe('plannedChargesCost (#2153)', () => {
  it('sums the list price of every charge', () => {
    const byHole = { H1: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 }, H2: { explosiveId: 'krackle', amountKg: 3, stemmingM: 2 } };
    expect(plannedChargesCost(byHole)).toBeCloseTo(chargeOrderCost('boomite', 5) + chargeOrderCost('krackle', 3), 6);
  });

  it('is zero for an empty map', () => {
    expect(plannedChargesCost({})).toBe(0);
  });
});

describe('landLoadedCharge stock field (#2153)', () => {
  it('carries no stock field', () => {
    const loaded = landLoadedCharge({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    expect(loaded).not.toHaveProperty('fromStockKg');
  });
});

describe('hole diameter scales charge capacity (#1934)', () => {
  it('no diameter equals the explicit 89 mm default', () => {
    expect(chargeColumnM(8)).toBe(chargeColumnM(8, 0.089));
    expect(maxChargeKgForHole(8, 2)).toBe(maxChargeKgForHole(8, 2, 0.089));
    expect(maxFittingChargeKg(8, 2)).toBe(maxFittingChargeKg(8, 2, 0.089));
    expect(chargeFitsHole(12, 2, 8)).toBe(chargeFitsHole(12, 2, 8, 0.089));
  });

  it('maxChargeKgForHole is proportional to d^2 (127 mm holds about 2.03x of 89 mm)', () => {
    const ratio = maxChargeKgForHole(8, 2, 0.127) / maxChargeKgForHole(8, 2, 0.089);
    expect(ratio).toBeCloseTo((0.127 / 0.089) ** 2, 6);
    expect(ratio).toBeCloseTo(2.03, 1);
  });

  it('chargeColumnM is shorter for the same kg in a wider hole', () => {
    expect(chargeColumnM(16, 0.127)).toBeLessThan(chargeColumnM(16, 0.089));
    expect(chargeColumnM(16, 0.089)).toBeCloseTo(8, 9);
    expect(chargeColumnM(16, 0.127)).toBeCloseTo(16 / 4.07, 1);
  });

  it('chargeFitsHole: 16 kg with 2 m stemming fits an 8 m hole at 127 mm, not at 89 mm', () => {
    expect(chargeFitsHole(16, 2, 8, 0.127)).toBe(true);
    expect(chargeFitsHole(16, 2, 8, 0.089)).toBe(false);
    expect(chargeFitsHole(16, 2, 8)).toBe(false);
  });

  it('maxFittingChargeKg grows with diameter and the displayed maximum is itself accepted', () => {
    const narrow = maxFittingChargeKg(8, 2, 0.089);
    const wide = maxFittingChargeKg(8, 2, 0.127);
    expect(wide).toBeGreaterThan(narrow * 2);
    expect(chargeFitsHole(wide, 2, 8, 0.127)).toBe(true);
  });

  it('boundary: stemming past the hole depth leaves zero capacity at any diameter', () => {
    expect(maxChargeKgForHole(8, 9, 0.165)).toBe(0);
  });

  // Boomite (reference density): an 8 m hole under 2 m of stemming holds 12 kg at 89 mm, about 24.4 kg at 127 mm.
  it('createCharge accepts 16 kg in an 8 m hole at 127 mm', () => {
    const result = createCharge('boomite', 16, 2, 8, 0.127);
    expect('charge' in result).toBe(true);
  });

  it('createCharge refuses 16 kg in an 8 m hole at 89 mm, with or without the explicit diameter', () => {
    expect('error' in createCharge('boomite', 16, 2, 8, 0.089)).toBe(true);
    expect('error' in createCharge('boomite', 16, 2, 8)).toBe(true);
  });

  it('createCharge refuses a charge past the wider hole too', () => {
    expect('error' in createCharge('boomite', 30, 2, 8, 0.127)).toBe(true);
  });

  it('batchCharge uses each hole\'s own diameter', () => {
    const { charges, errors } = batchCharge(
      ['H1', 'H2'], { H1: 8, H2: 8 }, 'boomite', 16, 2, { H1: 0.127, H2: 0.089 },
    );
    expect(Object.keys(charges)).toEqual(['H1']);
    expect(errors.map(e => e.holeId)).toEqual(['H2']);
  });

  it('batchCharge without diameters behaves as before (all 89 mm)', () => {
    const { charges, errors } = batchCharge(['H1'], { H1: 8 }, 'boomite', 16, 2);
    expect(Object.keys(charges)).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('batchCharge in fill mode fills each hole to its own bore', () => {
    const { charges, errors } = batchCharge(['H1', 'H2'], { H1: 8, H2: 8 }, 'boomite', null, 2, { H1: 0.127, H2: 0.089 });
    expect(errors).toEqual([]);
    expect(charges['H1']!.amountKg).toBe(fillChargeKg(8, 2, 0.127, 'boomite'));
    expect(charges['H2']!.amountKg).toBe(fillChargeKg(8, 2, 0.089, 'boomite'));
    expect(charges['H1']!.amountKg).toBeGreaterThan(charges['H2']!.amountKg * 2);
  });
});

// ── explosive density (#2 fill mode) ─────────────────────────────────────────
// Every column helper reads the explosive's loaded density when given one, the reference density otherwise.

describe('charge column at the explosive density', () => {
  it('chargeColumnM: the same kg makes a shorter column of a denser explosive', () => {
    // 89 mm: boomite 2 kg/m, dynatomics 4 kg/m, pop_rock 1.375 kg/m.
    expect(chargeColumnM(8, 0.089, 'boomite')).toBeCloseTo(4, 9);
    expect(chargeColumnM(8, 0.089, 'dynatomics')).toBeCloseTo(2, 9);
    expect(chargeColumnM(8, 0.089, 'pop_rock')).toBeCloseTo(8 / chargeKgPerMetre(0.089, 'pop_rock'), 9);
    expect(chargeColumnM(8, 0.089, 'pop_rock')).toBeGreaterThan(chargeColumnM(8, 0.089, 'boomite'));
  });

  it('chargeColumnM: no explosive, or an unknown one, reads the reference density', () => {
    expect(chargeColumnM(8, 0.089)).toBe(chargeColumnM(8, 0.089, 'boomite'));
    expect(chargeColumnM(8, 0.089, 'nonexistent')).toBe(chargeColumnM(8, 0.089));
  });

  it('maxChargeKgForHole and maxFittingChargeKg scale with density', () => {
    expect(maxChargeKgForHole(8, 2, 0.089, 'dynatomics')).toBeCloseTo(24, 9);
    expect(maxFittingChargeKg(8, 2, 0.089, 'dynatomics')).toBe(24);
    // pop_rock: 6 m x 1.375 kg/m = 8.25 kg, floored to the 0.1 kg the panel shows.
    expect(maxFittingChargeKg(8, 2, 0.089, 'pop_rock')).toBe(8.2);
    expect(maxFittingChargeKg(8, 2, 0.089, 'krackle')).toBeGreaterThan(maxFittingChargeKg(8, 2, 0.089, 'boomite'));
  });

  it('chargeFitsHole reads the density: 20 kg fits an 8 m hole as dynatomics, not as boomite', () => {
    expect(chargeFitsHole(20, 2, 8, 0.089, 'dynatomics')).toBe(true);
    expect(chargeFitsHole(20, 2, 8, 0.089, 'boomite')).toBe(false);
    expect(chargeFitsHole(20, 2, 8, 0.089)).toBe(false);
  });

  it('boundary: zero room under the stemming holds nothing of any explosive', () => {
    expect(maxChargeKgForHole(8, 8, 0.089, 'dynatomics')).toBe(0);
    expect(maxChargeKgForHole(8, 9, 0.165, 'dynatomics')).toBe(0);
  });

  it('createCharge names the explosive\'s own maximum when its column overflows', () => {
    const result = createCharge('dynatomics', 30, 2, 8);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/\b24(\.0)?\b/);
  });
});

// ── fill mode: a hole is filled from the bottom up to the stemming ─────────────

describe('fillChargeKg', () => {
  it('is the kg a hole holds under the stemming: (depth - stemming) x kg/m', () => {
    expect(fillChargeKg(8, 2.5, 0.089, 'boomite')).toBe(11);
    expect(fillChargeKg(8, 2.5, 0.089, 'dynatomics')).toBe(22);
  });

  it('is floored to 0.1 kg, so the fill always fits the hole', () => {
    // pop_rock: 5.5 m x 1.375 kg/m = 7.5625 kg -> 7.5
    expect(fillChargeKg(8, 2.5, 0.089, 'pop_rock')).toBe(7.5);
    for (const id of ['pop_rock', 'boomite', 'krackle', 'rumblox', 'dynatomics']) {
      for (const d of [0.089, 0.127, 0.165]) {
        const kg = fillChargeKg(7.3, 2.6, d, id);
        expect(Math.round(kg * 10) / 10, `${id} ${d}`).toBe(kg);
        expect(chargeFitsHole(kg, 2.6, 7.3, d, id), `${id} ${d}`).toBe(true);
        expect(kg, `${id} ${d}`).toBeGreaterThan(maxChargeKgForHole(7.3, 2.6, d, id) - 0.1);
      }
    }
  });

  it('equals the displayed maximum for the hole (maxFittingChargeKg)', () => {
    expect(fillChargeKg(6, 2, 0.127, 'krackle')).toBe(maxFittingChargeKg(6, 2, 0.127, 'krackle'));
    expect(fillChargeKg(6, 2)).toBe(maxFittingChargeKg(6, 2));
  });

  it('defaults to an 89 mm hole at the reference density', () => {
    expect(fillChargeKg(8, 2.5)).toBe(fillChargeKg(8, 2.5, 0.089, 'boomite'));
    expect(fillChargeKg(8, 2.5)).toBe(5.5 * CHARGE_KG_PER_METRE);
  });

  it('more stemming leaves less explosive', () => {
    expect(fillChargeKg(8, 4, 0.089, 'krackle')).toBeLessThan(fillChargeKg(8, 2.5, 0.089, 'krackle'));
  });

  it('a wider bore and a denser explosive both pack more into the same hole', () => {
    expect(fillChargeKg(8, 2.5, 0.127, 'boomite')).toBeGreaterThan(fillChargeKg(8, 2.5, 0.089, 'boomite'));
    expect(fillChargeKg(8, 2.5, 0.089, 'shatternite')).toBeGreaterThan(fillChargeKg(8, 2.5, 0.089, 'krackle'));
  });

  it('boundary: zero, never negative, when the stemming takes the whole hole or more', () => {
    expect(fillChargeKg(6, 6, 0.089, 'boomite')).toBe(0);
    expect(fillChargeKg(6, 9, 0.165, 'dynatomics')).toBe(0);
  });
});

describe('createCharge — fill mode (null amount)', () => {
  it('fills the hole from the bottom up to the stemming', () => {
    const result = createCharge('boomite', null, 2.5, 8);
    expect('charge' in result).toBe(true);
    if ('charge' in result) {
      expect(result.charge).toEqual({ explosiveId: 'boomite', amountKg: fillChargeKg(8, 2.5, 0.089, 'boomite'), stemmingM: 2.5 });
      expect(result.charge.amountKg).toBe(11);
    }
  });

  it('fills with the explosive\'s own density and the hole\'s own bore', () => {
    const dense = createCharge('dynatomics', null, 2.5, 8, 0.127);
    expect('charge' in dense && dense.charge.amountKg).toBe(fillChargeKg(8, 2.5, 0.127, 'dynatomics'));
    const light = createCharge('pop_rock', null, 2.5, 8, 0.127);
    expect('charge' in light && light.charge.amountKg).toBe(fillChargeKg(8, 2.5, 0.127, 'pop_rock'));
  });

  it('the filled column plus the stemming fits the hole', () => {
    for (const id of ['pop_rock', 'krackle', 'dynatomics']) {
      const result = createCharge(id, null, 3.3, 7.7, 0.165);
      expect('charge' in result, id).toBe(true);
      if ('charge' in result) expect(chargeFitsHole(result.charge.amountKg, 3.3, 7.7, 0.165, id), id).toBe(true);
    }
  });

  it('refuses with mining.charge.no_room when the stemming takes the whole hole', () => {
    const result = createCharge('boomite', null, 6, 6);
    expect(result).toEqual({ error: t('mining.charge.no_room', { stemming: 6, depth: 6 }) });
  });

  it('refuses with no_room when the space under the stemming holds less than 0.1 kg', () => {
    // 0.03 m x 2 kg/m = 0.06 kg, floored to 0.
    const result = createCharge('boomite', null, 5.97, 6);
    expect(result).toEqual({ error: t('mining.charge.no_room', { stemming: 5.97, depth: 6 }) });
  });

  it('refuses an explicit amount that is not a positive number of kg, naming it, rather than claiming no room', () => {
    for (const amount of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createCharge('boomite', amount, 2.5, 8), String(amount)).toEqual({
        error: t('mining.charge.invalid_amount', { amount: String(amount) }),
      });
    }
    // A real partial charge is still accepted.
    expect(createCharge('boomite', 4, 2.5, 8)).toEqual({ charge: { explosiveId: 'boomite', amountKg: 4, stemmingM: 2.5 } });
  });

  it('keeps the unknown-explosive and stemming refusals ahead of the fill', () => {
    expect(createCharge('nonexistent', null, 2, 8)).toEqual({ error: expect.stringContaining('Unknown explosive') });
    const shallowStem = createCharge('boomite', null, 0.2, 8);
    expect('error' in shallowStem && shallowStem.error).toContain('below minimum');
    const deepStem = createCharge('boomite', null, 9, 8);
    expect('error' in deepStem && deepStem.error).toContain('exceeds hole depth');
  });

  it('batchCharge fills every hole to its own depth and refuses only the one with no room', () => {
    const { charges, errors } = batchCharge(['H1', 'H2', 'H3'], { H1: 8, H2: 6, H3: 2.5 }, 'krackle', null, 2.5);
    expect(charges['H1']!.amountKg).toBe(fillChargeKg(8, 2.5, 0.089, 'krackle'));
    expect(charges['H2']!.amountKg).toBe(fillChargeKg(6, 2.5, 0.089, 'krackle'));
    expect(charges['H1']!.amountKg).toBeGreaterThan(charges['H2']!.amountKg);
    expect(charges['H3']).toBeUndefined();
    expect(errors).toEqual([{ holeId: 'H3', message: t('mining.charge.no_room', { stemming: 2.5, depth: 2.5 }) }]);
  });
});

describe('no per-explosive kg range (fill mode)', () => {
  it('the module no longer exports explosiveHoleLimits', () => {
    expect(Object.keys(chargePlan)).not.toContain('explosiveHoleLimits');
  });

  it('accepts any positive amount that fits: 0.5 kg of dynatomics, under its old 3 kg minimum', () => {
    expect('charge' in createCharge('dynatomics', 0.5, 2, 8)).toBe(true);
  });

  it('only the column limits a wide hole: boomite 17 kg fits at 127 mm (past its old scaled 16.3 kg cap), 25 kg does not', () => {
    expect('charge' in createCharge('boomite', 17, 2, 8, 0.127)).toBe(true);
    expect('error' in createCharge('boomite', 25, 2, 8, 0.127)).toBe(true);
  });
});

// ── powder factor (#2203) ────────────────────────────────────────────────────

const pt = (id: string, x: number, z: number) => ({ id, x, z });
const drilled = (id: string, x: number, z: number, depth = 8): DrillHole => ({ id, x, z, depth, diameter: 0.089 });

describe('holeSpacingM (#2203 C1)', () => {
  it('is the distance to the nearest other hole', () => {
    const a = pt('H1', 10, 10);
    expect(holeSpacingM(a, [a, pt('H2', 13, 10), pt('H3', 10, 18)])).toBe(3);
  });

  it('picks the nearest of several, whichever side it sits on', () => {
    const a = pt('H1', 10, 10);
    expect(holeSpacingM(a, [pt('H2', 20, 10), a, pt('H3', 10, 6)])).toBe(4);
  });

  it('measures straight-line distance, not a grid step', () => {
    const a = pt('H1', 0, 0);
    expect(holeSpacingM(a, [a, pt('H2', 3, 4)])).toBeCloseTo(5, 10);
  });

  it('a lone hole gets the default grid spacing', () => {
    const a = pt('H1', 10, 10);
    expect(holeSpacingM(a, [a])).toBe(DRILL_GRID_DEFAULT_SPACING_M);
    expect(holeSpacingM(a, [])).toBe(DRILL_GRID_DEFAULT_SPACING_M);
  });

  it('does not count the hole itself as its own neighbour', () => {
    const a = pt('H1', 10, 10);
    expect(holeSpacingM(a, [a, pt('H2', 17, 10)])).toBe(7);
  });

  it('is symmetric for a pair', () => {
    const a = pt('H1', 2, 3);
    const b = pt('H2', 6, 6);
    expect(holeSpacingM(a, [a, b])).toBe(holeSpacingM(b, [a, b]));
  });

  it('is capped at HOLE_CELL_MAX_SIDE_M: a hole far from the others does not work a field it cannot reach', () => {
    const a = pt('H1', 0, 0);
    expect(holeSpacingM(a, [a, pt('H2', 20, 0)])).toBe(HOLE_CELL_MAX_SIDE_M);
    expect(holeSpacingM(a, [a, pt('H2', 300, 400)])).toBe(HOLE_CELL_MAX_SIDE_M);
  });

  it('boundary: a neighbour exactly at the cap reads the cap, one just inside reads its distance', () => {
    const a = pt('H1', 0, 0);
    expect(holeSpacingM(a, [a, pt('H2', HOLE_CELL_MAX_SIDE_M, 0)])).toBe(HOLE_CELL_MAX_SIDE_M);
    expect(holeSpacingM(a, [a, pt('H2', HOLE_CELL_MAX_SIDE_M - 1, 0)])).toBe(HOLE_CELL_MAX_SIDE_M - 1);
  });
});

describe('holeCellSize', () => {
  it('is the grid cell (spacing along the row x burden between rows) of a hole drilled as part of a grid', () => {
    const holes = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 3, 3, 8, 0.089, 5);
    for (const h of holes) expect(holeCellSize(h, holes), h.id).toEqual({ spacingM: 3, burdenM: 5 });
  });

  it('keeps the grid cell even when a neighbour sits nearer than the spacing (staggered rows)', () => {
    const holes = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 2, 4, 8, 0.089, 2, 'staggered');
    for (const h of holes) expect(holeCellSize(h, holes), h.id).toEqual({ spacingM: 4, burdenM: 2 });
  });

  it('a hole placed on its own is given a square as wide as the distance to its nearest neighbour', () => {
    const a = drilled('H1', 10, 10);
    const holes = [a, drilled('H2', 13, 10), drilled('H3', 10, 18)];
    expect(holeCellSize(a, holes)).toEqual({ spacingM: 3, burdenM: 3 });
  });

  it('a lone hand-placed hole gets the default grid square', () => {
    const a = drilled('H1', 10, 10);
    expect(holeCellSize(a, [a])).toEqual({ spacingM: DRILL_GRID_DEFAULT_SPACING_M, burdenM: DRILL_GRID_DEFAULT_SPACING_M });
  });

  it('a hand-placed hole far from the others is capped at HOLE_CELL_MAX_SIDE_M', () => {
    const a = drilled('H1', 0, 0);
    expect(holeCellSize(a, [a, drilled('H2', 30, 0)])).toEqual({ spacingM: HOLE_CELL_MAX_SIDE_M, burdenM: HOLE_CELL_MAX_SIDE_M });
  });

  it('rejection: half a cell, or a zero or negative one, falls back to the nearest-neighbour square', () => {
    const others = [drilled('H2', 12, 10)];
    for (const cell of [{ spacingM: 3 }, { burdenM: 3 }, { spacingM: 0, burdenM: 3 }, { spacingM: 3, burdenM: -1 }]) {
      const a = { ...drilled('H1', 10, 10), ...cell };
      expect(holeCellSize(a, [a, ...others]), JSON.stringify(cell)).toEqual({ spacingM: 2, burdenM: 2 });
    }
  });
});

describe('patternAreaM2', () => {
  it('is rows x cols x spacing x burden for a grid pattern', () => {
    const holes = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 3, 4, 4, 8, 0.089, 3);
    expect(patternAreaM2(holes)).toBeCloseTo(3 * 4 * 4 * 3, 9);
  });

  it('measures the ground, not the holes: the same ground drilled finer reads the same area', () => {
    const coarse = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 3, 3, 4, 8, 0.089);
    const fine = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 4, 4, 3, 8, 0.089);
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(patternAreaM2(fine)).toBeCloseTo(patternAreaM2(coarse), 9);
  });

  it('sums the cells of hand-placed holes from their nearest-neighbour squares', () => {
    const holes = [drilled('H1', 10, 10), drilled('H2', 13, 10), drilled('H3', 10, 15)];
    // H1 and H2 are 3 m apart; H3 is 5 m from H1.
    expect(patternAreaM2(holes)).toBeCloseTo(3 * 3 + 3 * 3 + 5 * 5, 9);
  });

  it('a lone hand-placed hole works the default grid square', () => {
    expect(patternAreaM2([drilled('H1', 10, 10)])).toBe(DRILL_GRID_DEFAULT_SPACING_M ** 2);
  });

  it('two holes far apart each count at most the capped cell', () => {
    expect(patternAreaM2([drilled('H1', 0, 0), drilled('H2', 40, 0)])).toBe(2 * HOLE_CELL_MAX_SIDE_M ** 2);
  });

  it('is 0 for no holes', () => {
    expect(patternAreaM2([])).toBe(0);
  });
});

describe('powderFactor (#2203 C1)', () => {
  it('is kg over the cell volume spacing x spacing x depth', () => {
    expect(powderFactor(10, 8, 4)).toBeCloseTo(10 / (4 * 4 * 8), 12);
    expect(powderFactor(6, 6, 2)).toBeCloseTo(0.25, 12);
  });

  it('with a burden, is kg over spacing x burden x depth', () => {
    expect(powderFactor(12, 8, 4, 3)).toBeCloseTo(12 / (4 * 3 * 8), 12);
    expect(powderFactor(12, 8, 3, 4)).toBeCloseTo(powderFactor(12, 8, 4, 3), 12);
  });

  it('the burden defaults to the spacing (a square cell)', () => {
    expect(powderFactor(10, 8, 4)).toBe(powderFactor(10, 8, 4, 4));
  });

  it('a tighter burden raises the powder factor in proportion', () => {
    expect(powderFactor(10, 8, 4, 2)).toBeCloseTo(2 * powderFactor(10, 8, 4, 4), 12);
  });

  it('is 0, not Infinity or NaN, for a zero or negative burden', () => {
    expect(powderFactor(5, 8, 4, 0)).toBe(0);
    expect(powderFactor(5, 8, 4, -1)).toBe(0);
  });

  it('doubles with the charge', () => {
    expect(powderFactor(8, 6, 3)).toBeCloseTo(2 * powderFactor(4, 6, 3), 12);
  });

  it('falls with the square of the spacing', () => {
    expect(powderFactor(6, 6, 6)).toBeCloseTo(powderFactor(6, 6, 3) / 4, 12);
  });

  it('is 0 for no charge', () => {
    expect(powderFactor(0, 8, 4)).toBe(0);
  });

  it('is 0, not Infinity or NaN, for a zero or negative depth', () => {
    expect(powderFactor(5, 0, 4)).toBe(0);
    expect(powderFactor(5, -2, 4)).toBe(0);
  });

  it('is 0, not Infinity or NaN, for a zero or negative spacing', () => {
    expect(powderFactor(5, 8, 0)).toBe(0);
    expect(powderFactor(5, 8, -1)).toBe(0);
  });
});

describe('holePowderFactors (#2203 C1)', () => {
  const holes = [drilled('H1', 10, 10, 8), drilled('H2', 14, 10, 8), drilled('H3', 10, 12, 6)];

  it('keys every charged hole by id', () => {
    const charges = {
      H1: { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 },
      H2: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    };
    expect(Object.keys(holePowderFactors(holes, charges)).sort()).toEqual(['H1', 'H2']);
  });

  it('computes amount / (spacing^2 x depth) with the hole\'s own nearest-neighbour spacing', () => {
    const charges = {
      H1: { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 },
      H3: { explosiveId: 'krackle', amountKg: 3, stemmingM: 1 },
    };
    const pf = holePowderFactors(holes, charges);
    // H1 and H3 are 2 m apart; H2 is 4 m from H1.
    expect(pf['H1']).toBeCloseTo(4 / (2 * 2 * 8), 12);
    expect(pf['H3']).toBeCloseTo(3 / (2 * 2 * 6), 12);
  });

  it('leaves an uncharged hole out', () => {
    const pf = holePowderFactors(holes, { H2: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 } });
    expect(pf['H1']).toBeUndefined();
    expect(pf['H3']).toBeUndefined();
    expect(pf['H2']).toBeCloseTo(5 / (4 * 4 * 8), 12);
  });

  it('is empty with no charges', () => {
    expect(holePowderFactors(holes, {})).toEqual({});
    expect(holePowderFactors([], {})).toEqual({});
  });

  it('a single charged hole uses the default grid spacing', () => {
    const pf = holePowderFactors([drilled('H9', 5, 5, 8)], { H9: { explosiveId: 'boomite', amountKg: 8, stemmingM: 2 } });
    expect(pf['H9']).toBeCloseTo(8 / (DRILL_GRID_DEFAULT_SPACING_M ** 2 * 8), 12);
  });

  it('ignores a charge for a hole that is not in the list', () => {
    const pf = holePowderFactors([drilled('H1', 0, 0)], { GHOST: { explosiveId: 'boomite', amountKg: 4, stemmingM: 2 } });
    expect(pf).toEqual({});
  });

  it('reads a grid hole\'s own cell: spacing x burden x depth', () => {
    const grid = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 2, 4, 8, 0.089, 3);
    const charges = Object.fromEntries(grid.map(h => [h.id, { explosiveId: 'boomite', amountKg: 9, stemmingM: 2.5 }]));
    const pf = holePowderFactors(grid, charges);
    for (const h of grid) expect(pf[h.id], h.id).toBeCloseTo(9 / (4 * 3 * 8), 12);
  });
});
