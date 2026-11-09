import { describe, it, expect } from 'vitest';
import { getExplosive, getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';

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

  it('carries exactly the fields id, nameKey, descKey, energyPerKg, costPerKg, waterSensitive, minChargeKg, maxChargeKg, vibrationMod (#2197)', () => {
    const expected = [
      'costPerKg', 'descKey', 'energyPerKg', 'id', 'maxChargeKg', 'minChargeKg', 'nameKey', 'vibrationMod', 'waterSensitive',
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

  it('all explosives have valid charge ranges', () => {
    for (const e of getAllExplosives()) {
      expect(e.minChargeKg).toBeGreaterThan(0);
      expect(e.maxChargeKg).toBeGreaterThan(e.minChargeKg);
    }
  });
});
