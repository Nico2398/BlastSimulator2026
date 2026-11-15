// BlastSimulator2026 — Tier perks: one small bonus per ladder step, cumulative (#2277)

import { describe, it, expect } from 'vitest';
import { tierPerksAt } from '../../../src/core/economy/TierPerks.js';
import { MINE_GRADES } from '../../../src/core/config/balance.js';
import { RUNGS, TIERS, NAMED_GRADES, perkTotals } from '../../helpers/gradeLadder.js';

describe('MINE_GRADES perks (#2277)', () => {
  it('the first step (grade 0, tier 1) has no perk; every other tier has exactly one', () => {
    for (const g of NAMED_GRADES) {
      for (const tier of TIERS) {
        const perk = MINE_GRADES[g]!.tiers[tier - 1]!.perk;
        if (g === 0 && tier === 1) expect(perk).toBeNull();
        else expect(perk, `grade ${g} tier ${tier}`).not.toBeNull();
      }
    }
  });

  it('every perk has a positive value of a known kind', () => {
    for (const g of NAMED_GRADES) {
      for (const tier of TIERS) {
        const perk = MINE_GRADES[g]!.tiers[tier - 1]!.perk;
        if (!perk) continue;
        expect(['notification_fee_pct', 'processing_pct', 'inspection_pct', 'contract_offers']).toContain(perk.kind);
        expect(perk.value).toBeGreaterThan(0);
      }
    }
  });

  it('the ladder offers every perk kind at least once', () => {
    const kinds = new Set<string>();
    for (const g of NAMED_GRADES) for (const tier of TIERS) {
      const perk = MINE_GRADES[g]!.tiers[tier - 1]!.perk;
      if (perk) kinds.add(perk.kind);
    }
    expect(kinds).toEqual(new Set(['notification_fee_pct', 'processing_pct', 'inspection_pct', 'contract_offers']));
  });
});

describe('tierPerksAt (#2277)', () => {
  it('rung 0 (grade 0 tier 1) has no perks at all', () => {
    expect(tierPerksAt(0)).toEqual({
      notificationFeeDiscountPct: 0, processingDiscountPct: 0, inspectionDiscountPct: 0, extraContractOffers: 0,
    });
  });

  it.each(RUNGS)('rung %i sums the table perks of rungs 1..rung', (rung) => {
    const want = perkTotals(rung);
    expect(tierPerksAt(rung)).toEqual({
      notificationFeeDiscountPct: want.notification_fee_pct,
      processingDiscountPct: want.processing_pct,
      inspectionDiscountPct: want.inspection_pct,
      extraContractOffers: want.contract_offers,
    });
  });

  it('every field never falls along the ladder', () => {
    for (let rung = 1; rung <= 11; rung++) {
      const a = tierPerksAt(rung - 1);
      const b = tierPerksAt(rung);
      expect(b.notificationFeeDiscountPct).toBeGreaterThanOrEqual(a.notificationFeeDiscountPct);
      expect(b.processingDiscountPct).toBeGreaterThanOrEqual(a.processingDiscountPct);
      expect(b.inspectionDiscountPct).toBeGreaterThanOrEqual(a.inspectionDiscountPct);
      expect(b.extraContractOffers).toBeGreaterThanOrEqual(a.extraContractOffers);
    }
  });

  it('each step above rung 0 raises exactly one field (one perk per tier)', () => {
    for (let rung = 1; rung <= 11; rung++) {
      const a = Object.values(tierPerksAt(rung - 1));
      const b = Object.values(tierPerksAt(rung));
      expect(b.filter((v, i) => v > a[i]!)).toHaveLength(1);
    }
  });

  it('the last named step holds a perk of every kind', () => {
    const top = tierPerksAt(11);
    expect(top.notificationFeeDiscountPct).toBeGreaterThan(0);
    expect(top.processingDiscountPct).toBeGreaterThan(0);
    expect(top.inspectionDiscountPct).toBeGreaterThan(0);
    expect(top.extraContractOffers).toBeGreaterThan(0);
  });

  it.each([12, 13, 40, 500])('an endless class rung %i keeps the perks of the last named step', (rung) => {
    expect(tierPerksAt(rung)).toEqual(tierPerksAt(11));
  });

  it('no discount reaches 100 percent: a fee, a delay and a chance never vanish', () => {
    const top = tierPerksAt(11);
    expect(top.notificationFeeDiscountPct).toBeLessThan(100);
    expect(top.processingDiscountPct).toBeLessThan(100);
    expect(top.inspectionDiscountPct).toBeLessThan(100);
  });

  it('returns a fresh object each call', () => {
    const a = tierPerksAt(5);
    a.extraContractOffers = 99;
    expect(tierPerksAt(5).extraContractOffers).not.toBe(99);
  });
});
