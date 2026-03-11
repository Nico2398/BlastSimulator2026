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

  it('explosives sorted by tier have increasing energy per kg', () => {
    const sorted = [...getAllExplosives()].sort(
      (a, b) => a.minRockTier - b.minRockTier || a.energyPerKg - b.energyPerKg,
    );
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.energyPerKg).toBeGreaterThanOrEqual(sorted[i - 1]!.energyPerKg);
    }
  });

  it('dynatomics can fracture hardness tier 5 rocks', () => {
    const dyn = getExplosive('dynatomics');
    expect(dyn).toBeDefined();
    expect(dyn!.maxRockTier).toBeGreaterThanOrEqual(5);
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
