import { describe, it, expect } from 'vitest';
import { getOre, getAllOres } from '../../../src/core/world/OreCatalog.js';
import { getAllRocks, getRock } from '../../../src/core/world/RockCatalog.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { ORE_RARITY_TIERS } from '../../helpers/oreRarity.js';

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

  // --- depth-window invariants the biome ore progression relies on (#1677) ---

  it('every ore has a non-empty depth window (depthMin < depthMax)', () => {
    for (const ore of getAllOres()) {
      expect(ore.depthMin, ore.id).toBeLessThan(ore.depthMax);
    }
  });

  it('every ore rarity is a known tier', () => {
    for (const ore of getAllOres()) expect(ORE_RARITY_TIERS, ore.id).toContain(ore.rarity);
  });

  it('the shallowest depthMin of a tier never decreases as rarity rises', () => {
    const minByTier = ORE_RARITY_TIERS.map(t => {
      const mins = getAllOres().filter(o => o.rarity === t).map(o => o.depthMin);
      return mins.length ? Math.min(...mins) : undefined;
    });
    const present = minByTier.filter((m): m is number => m !== undefined);
    for (let i = 1; i < present.length; i++) {
      expect(present[i]).toBeGreaterThanOrEqual(present[i - 1]);
    }
  });

  it('every ore is hosted by at least one rock', () => {
    for (const ore of getAllOres()) {
      const hosts = getAllRocks().filter(r => (r.oreProbabilities[ore.id] ?? 0) > 0);
      expect(hosts.length, ore.id).toBeGreaterThan(0);
    }
  });

  it('every rock hosts only ores that exist in the catalog', () => {
    for (const rock of getAllRocks()) {
      for (const oreId of Object.keys(rock.oreProbabilities)) {
        expect(getOre(oreId), `${rock.id} -> ${oreId}`).toBeDefined();
      }
    }
  });

  for (const [from, to] of [[0, 8], [24, 32]] as const) {
    for (const biome of getAllBiomes()) {
      it(`${biome.id}: the ores its dominant rocks host have depth windows that cover ${from}-${to} m`, () => {
        const windows = biome.dominantRocks
          .flatMap(id => Object.entries(getRock(id)!.oreProbabilities).filter(([, p]) => p > 0).map(([oreId]) => getOre(oreId)!))
          .map(o => [o.depthMin, o.depthMax] as const)
          .sort((a, b) => a[0] - b[0]);
        // Walk the union of the windows from `from`; it must reach `to` without a gap.
        let reach = from;
        for (const [lo, hi] of windows) {
          if (lo <= reach && hi > reach) reach = hi;
        }
        expect(reach).toBeGreaterThanOrEqual(to);
      });
    }
  }
});
