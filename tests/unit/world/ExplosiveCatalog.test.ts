import { describe, it, expect } from 'vitest';
import { getExplosive, getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
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

  it('carries exactly the fields id, nameKey, descKey, energyPerKg, costPerKg, waterSensitive, density, vibrationMod (#2197)', () => {
    const expected = [
      'costPerKg', 'density', 'descKey', 'energyPerKg', 'id', 'nameKey', 'vibrationMod', 'waterSensitive',
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
