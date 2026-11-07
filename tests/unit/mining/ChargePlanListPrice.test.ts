// BlastSimulator2026 — Unit tests: a charge plan carries no stock split; its cost is the list-price total (#2153)

import { describe, it, expect } from 'vitest';
import * as ChargePlan from '../../../src/core/mining/ChargePlan.js';
import {
  createCharge, batchCharge, landLoadedCharge, plannedChargesCost, chargeOrderCost,
  type HoleCharge, type PlannedCharge,
} from '../../../src/core/mining/ChargePlan.js';

describe('ChargePlan has no stock API (#2153)', () => {
  it('no longer exports the stock-aware cost helpers', () => {
    expect('stockAwareChargesCost' in ChargePlan).toBe(false);
    expect('recordedChargesCost' in ChargePlan).toBe(false);
  });

  it('keeps the list-price helpers', () => {
    expect(typeof ChargePlan.plannedChargesCost).toBe('function');
    expect(typeof ChargePlan.chargeOrderCost).toBe('function');
  });
});

describe('HoleCharge carries no fromStockKg (#2153)', () => {
  it('createCharge returns exactly explosive, amount and stemming', () => {
    const r = createCharge('boomite', 5, 2, 8);
    if (!('charge' in r)) throw new Error(r.error);
    expect(Object.keys(r.charge).sort()).toEqual(['amountKg', 'explosiveId', 'stemmingM']);
  });

  it('batchCharge charges carry no stock field', () => {
    const { charges } = batchCharge(['H1', 'H2'], { H1: 8, H2: 8 }, 'boomite', 5, 2);
    for (const c of Object.values(charges)) expect(Object.keys(c).sort()).toEqual(['amountKg', 'explosiveId', 'stemmingM']);
  });

  it('landLoadedCharge lands explosive, amount and stemming only', () => {
    const planned: PlannedCharge = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    expect(landLoadedCharge(planned)).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
  });

  it('landLoadedCharge drops a stray fromStockKg a legacy plan might still carry', () => {
    const legacy = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2, fromStockKg: 3 } as unknown as PlannedCharge;
    const landed = landLoadedCharge(legacy);
    expect('fromStockKg' in landed).toBe(false);
    expect(Object.keys(landed).sort()).toEqual(['amountKg', 'explosiveId', 'stemmingM']);
  });
});

describe('plannedChargesCost is the list-price total (#2153)', () => {
  const charge = (explosiveId: string, amountKg: number): HoleCharge => ({ explosiveId, amountKg, stemmingM: 2 });

  it('sums costPerKg x kg across holes', () => {
    const byHole = { H1: charge('boomite', 5), H2: charge('krackle', 3) };
    expect(plannedChargesCost(byHole)).toBeCloseTo(5 * 12 + 3 * 20, 10);
  });

  it('equals the sum of chargeOrderCost over the holes', () => {
    const byHole = { H1: charge('boomite', 6), H2: charge('boomite', 4), H3: charge('krackle', 2.5) };
    const expected = chargeOrderCost('boomite', 6) + chargeOrderCost('boomite', 4) + chargeOrderCost('krackle', 2.5);
    expect(plannedChargesCost(byHole)).toBeCloseTo(expected, 10);
  });

  it('ignores a stray fromStockKg on a legacy charge: the full kg is still priced', () => {
    const legacy = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2, fromStockKg: 5 } as unknown as HoleCharge;
    expect(plannedChargesCost({ H1: legacy })).toBeCloseTo(60, 10);
  });

  it('is 0 for no holes (boundary)', () => {
    expect(plannedChargesCost({})).toBe(0);
  });

  it('prices an unknown explosive at 0 without throwing', () => {
    expect(plannedChargesCost({ H1: charge('no_such_explosive', 5) })).toBe(0);
  });
});
