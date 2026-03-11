import { describe, it, expect } from 'vitest';
import { getOre, getAllOres } from '../../../src/core/world/OreCatalog.js';

describe('OreCatalog', () => {
  it('getOre returns valid data for treranium', () => {
    const ore = getOre('treranium');
    expect(ore).toBeDefined();
    expect(ore!.id).toBe('treranium');
    expect(ore!.nameKey).toBe('ore.treranium.name');
    expect(ore!.valuePerKg).toBe(2000);
    expect(ore!.rarity).toBe('legendary');
  });

  it('all ore IDs are unique', () => {
    const ores = getAllOres();
    const ids = ores.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ores span a wide value range (cheap to very expensive)', () => {
    const ores = getAllOres();
    const values = ores.map(o => o.valuePerKg);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // At least 100x spread between cheapest and most expensive
    expect(max / min).toBeGreaterThanOrEqual(100);
  });

  it('at least 6 ores defined', () => {
    expect(getAllOres().length).toBeGreaterThanOrEqual(6);
  });

  it('dirtite is the cheapest ore', () => {
    const dirtite = getOre('dirtite');
    const allValues = getAllOres().map(o => o.valuePerKg);
    expect(dirtite!.valuePerKg).toBe(Math.min(...allValues));
  });
});
