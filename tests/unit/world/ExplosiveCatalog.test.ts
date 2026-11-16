import { describe, it, expect } from 'vitest';
import { getExplosive, getAllExplosives, explosivesOfTier } from '../../../src/core/world/ExplosiveCatalog.js';
import { CHARGE_REFERENCE_DENSITY } from '../../../src/core/config/balance.js';

describe('ExplosiveCatalog', () => {
  it('getExplosive returns valid data for pop_rock', () => {
    const e = getExplosive('pop_rock');
    expect(e).toBeDefined();
    expect(e!.id).toBe('pop_rock');
    expect(e!.nameKey).toBe('explosive.pop_rock.name');
    expect(e!.energyPerKg).toBe(200);
    expect(e!.costPerKg).toBe(5);
    expect(e!.waterSensitive).toBe(true);
  });

  it('all explosive IDs are unique', () => {
    const explosives = getAllExplosives();
    const ids = explosives.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries exactly the fields id, nameKey, descKey, tier, energyPerKg, costPerKg, waterSensitive, density, vibrationMod (#2197, #2280)', () => {
    const expected = [
      'costPerKg', 'density', 'descKey', 'energyPerKg', 'id', 'nameKey', 'tier', 'vibrationMod', 'waterSensitive',
    ];
    for (const e of getAllExplosives()) {
      expect(Object.keys(e).sort(), e.id).toEqual(expected);
    }
  });

  it('no explosive declares a rock tier or a projection-risk multiplier (#2197)', () => {
    for (const e of getAllExplosives()) {
      expect(e).not.toHaveProperty('minRockTier');
      expect(e).not.toHaveProperty('projectionRiskMod');
    }
  });

  it('every explosive keeps a positive vibration multiplier', () => {
    for (const e of getAllExplosives()) expect(e.vibrationMod).toBeGreaterThan(0);
  });

  it('a pricier explosive carries more energy per kg', () => {
    const byCost = [...getAllExplosives()].sort((a, b) => a.costPerKg - b.costPerKg);
    for (let i = 1; i < byCost.length; i++) {
      expect(byCost[i]!.energyPerKg).toBeGreaterThanOrEqual(byCost[i - 1]!.energyPerKg);
    }
  });

  it('dynatomics is the most energetic explosive', () => {
    const dyn = getExplosive('dynatomics');
    expect(dyn).toBeDefined();
    for (const e of getAllExplosives()) expect(dyn!.energyPerKg).toBeGreaterThanOrEqual(e.energyPerKg);
  });

  it('at least 6 explosives defined', () => {
    expect(getAllExplosives().length).toBeGreaterThanOrEqual(6);
  });

  // A charge fills its hole up to the stemming: density, not a per-explosive kg range, sets how much a hole holds.
  it('has no per-explosive kg range any more', () => {
    for (const e of getAllExplosives()) {
      expect(e, e.id).not.toHaveProperty('minChargeKg');
      expect(e, e.id).not.toHaveProperty('maxChargeKg');
    }
  });

  it('every explosive has a finite, positive loaded density within the range of real explosives (about 0.5 to 1.7 g/cm3)', () => {
    for (const e of getAllExplosives()) {
      expect(Number.isFinite(e.density), e.id).toBe(true);
      expect(e.density, e.id).toBeGreaterThanOrEqual(0.5);
      expect(e.density, e.id).toBeLessThanOrEqual(1.7);
    }
  });

  it('boomite, the ANFO-like default, sits at the reference density the per-metre charge is written for', () => {
    expect(getExplosive('boomite')!.density).toBe(CHARGE_REFERENCE_DENSITY);
  });

  it('pop_rock, the black-powder knockoff, is the lightest explosive', () => {
    const pop = getExplosive('pop_rock')!;
    for (const e of getAllExplosives().filter(x => x.id !== pop.id)) expect(pop.density, e.id).toBeLessThan(e.density);
  });

  it('dynatomics, the endgame explosive, is the densest', () => {
    const dyn = getExplosive('dynatomics')!;
    for (const e of getAllExplosives().filter(x => x.id !== dyn.id)) expect(dyn.density, e.id).toBeGreaterThan(e.density);
  });

  it('every explosive pricier than boomite loads denser than it: the cheap ones are the light ones', () => {
    const boomite = getExplosive('boomite')!;
    const pricier = getAllExplosives().filter(e => e.costPerKg > boomite.costPerKg);
    expect(pricier.length).toBeGreaterThan(0);
    for (const e of pricier) expect(e.density, e.id).toBeGreaterThan(boomite.density);
  });
});

describe('explosive tiers (#2280)', () => {
  const TIERS: Record<string, 1 | 2 | 3> = {
    pop_rock: 1, boomite: 1, krackle: 1,
    big_bada_boom: 2, shatternite: 2, rumblox: 2,
    obliviax: 3, dynatomics: 3,
  };

  it.each(Object.entries(TIERS))('%s is tier %i', (id, tier) => {
    expect(getExplosive(id)!.tier).toBe(tier);
  });

  it('every explosive has a tier of 1, 2 or 3, and the table covers the whole catalog', () => {
    for (const e of getAllExplosives()) expect([1, 2, 3], e.id).toContain(e.tier);
    expect(getAllExplosives().map(e => e.id).sort()).toEqual(Object.keys(TIERS).sort());
  });

  it('explosivesOfTier lists each tier\'s explosives in catalog order', () => {
    expect(explosivesOfTier(1).map(e => e.id)).toEqual(['pop_rock', 'boomite', 'krackle']);
    expect(explosivesOfTier(2).map(e => e.id)).toEqual(['big_bada_boom', 'shatternite', 'rumblox']);
    expect(explosivesOfTier(3).map(e => e.id)).toEqual(['obliviax', 'dynatomics']);
  });

  it('the three tiers partition the catalog', () => {
    const all = [1, 2, 3].flatMap(t => explosivesOfTier(t as 1 | 2 | 3).map(e => e.id));
    expect(all.sort()).toEqual(getAllExplosives().map(e => e.id).sort());
  });

  it('a higher tier carries more energy per kg than any explosive of a lower tier', () => {
    for (const hi of getAllExplosives()) {
      for (const lo of getAllExplosives().filter(e => e.tier < hi.tier)) {
        expect(hi.energyPerKg, `${hi.id} vs ${lo.id}`).toBeGreaterThan(lo.energyPerKg);
      }
    }
  });

  it.each([
    [1, 200, 400],
    [2, 550, 850],
    [3, 1000, 1300],
  ] as const)('tier %i energy stays within %i-%i per kg', (tier, lo, hi) => {
    for (const e of explosivesOfTier(tier)) {
      expect(e.energyPerKg, e.id).toBeGreaterThanOrEqual(lo);
      expect(e.energyPerKg, e.id).toBeLessThanOrEqual(hi);
    }
  });
});
