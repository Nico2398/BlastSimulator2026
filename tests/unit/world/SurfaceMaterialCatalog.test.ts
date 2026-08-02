// SurfaceMaterialCatalog — unit tests

import { describe, it, expect } from 'vitest';
import {
  SURFACE_MATERIALS, SURFACE_MATERIAL_SLOTS, MaterialRecipe,
  getSurfaceMaterial, surfaceMaterialIndexOf, biomeAffinities,
} from '../../../src/core/world/SurfaceMaterialCatalog.js';
import { getAllRocks } from '../../../src/core/world/RockCatalog.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';

describe('SurfaceMaterialCatalog', () => {
  it('covers the ground types the terrain needs', () => {
    const ids = SURFACE_MATERIALS.map((m) => m.id);
    for (const expected of ['dirt', 'grass', 'moss', 'gravel', 'sand', 'clay', 'mud', 'marble', 'ice', 'snow']) {
      expect(ids, `missing surface material "${expected}"`).toContain(expected);
    }
  });

  it('fits inside the shader uniform arrays', () => {
    expect(SURFACE_MATERIALS.length).toBeLessThanOrEqual(SURFACE_MATERIAL_SLOTS);
  });

  it('has unique ids', () => {
    const ids = SURFACE_MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every material its own 3D texture, not a shared formula with a tint', () => {
    // The defect this catalog replaced: ten rocks sharing one albedo formula,
    // separated only by colour. Two materials with the same recipe AND the
    // same frequencies are the same texture painted twice.
    const signatures = SURFACE_MATERIALS.map((m) => `${m.recipe}|${m.freq}|${m.freqAlt}|${m.warp}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('uses more than one kind of noise composition across the catalog', () => {
    const recipes = new Set(SURFACE_MATERIALS.map((m) => m.recipe));
    expect(recipes.size).toBeGreaterThanOrEqual(5);
  });

  it('names a recipe the shader actually implements', () => {
    const known = new Set(Object.values(MaterialRecipe).filter((v) => typeof v === 'number'));
    for (const m of SURFACE_MATERIALS) {
      expect(known, `${m.id} has an unknown recipe`).toContain(m.recipe);
    }
  });

  it('keeps every tunable inside the range the shader assumes', () => {
    for (const m of SURFACE_MATERIALS) {
      expect(m.freq, m.id).toBeGreaterThan(0);
      expect(m.contrast, m.id).toBeGreaterThan(0);
      expect(m.contrast, m.id).toBeLessThanOrEqual(1);
      expect(m.bump, m.id).toBeGreaterThanOrEqual(0);
      expect(m.bump, m.id).toBeLessThanOrEqual(1);
      expect(Math.abs(m.roughness), m.id).toBeLessThanOrEqual(0.3);
      expect(m.slopeCenter, m.id).toBeGreaterThanOrEqual(0);
      expect(m.slopeCenter, m.id).toBeLessThanOrEqual(1);
      expect(m.slopeWidth, m.id).toBeGreaterThan(0);
      expect(m.altitudeWidth, m.id).toBeGreaterThan(0);
      expect(m.patchScale, m.id).toBeGreaterThan(0);
      expect(m.color, m.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.colorAlt, m.id).toMatch(/^#[0-9a-f]{6}$/i);
      // A material whose two colours are identical has no range to vary over.
      expect(m.color.toLowerCase(), m.id).not.toBe(m.colorAlt.toLowerCase());
    }
  });

  it('lookup by id works, and misses return undefined', () => {
    expect(getSurfaceMaterial('snow')?.id).toBe('snow');
    expect(getSurfaceMaterial('unobtainium')).toBeUndefined();
    expect(surfaceMaterialIndexOf('snow')).toBe(SURFACE_MATERIALS.findIndex((m) => m.id === 'snow'));
    expect(surfaceMaterialIndexOf('unobtainium')).toBe(-1);
  });

  describe('biome affinities', () => {
    it('returns one weight per material, in catalog order', () => {
      const a = biomeAffinities('desert_badlands');
      expect(a).toHaveLength(SURFACE_MATERIALS.length);
    });

    it('gives every biome something to cover itself with', () => {
      for (const biome of getAllBiomes()) {
        const total = biomeAffinities(biome.id).reduce((n, w) => n + w, 0);
        expect(total, `biome ${biome.id} has no surface cover at all`).toBeGreaterThan(0);
      }
    });

    it('keeps wet growth out of the desert and sand out of the alpine', () => {
      const idx = (id: string) => surfaceMaterialIndexOf(id);
      const desert = biomeAffinities('desert_badlands');
      expect(desert[idx('moss')]).toBe(0);
      expect(desert[idx('snow')]).toBe(0);
      expect(desert[idx('sand')]).toBeGreaterThan(0);

      const alpine = biomeAffinities('alpine_granite');
      expect(alpine[idx('snow')]).toBeGreaterThan(0);
      expect(alpine[idx('ice')]).toBeGreaterThan(0);
      expect(alpine[idx('sand')] ?? 0).toBe(0);
    });

    it('scores 0 for every material on an unknown biome rather than throwing', () => {
      expect(biomeAffinities('not_a_biome').every((w) => w === 0)).toBe(true);
    });
  });
});

describe('RockCatalog procedural identity', () => {
  it('gives every rock its own recipe fields', () => {
    for (const rock of getAllRocks()) {
      expect(typeof rock.recipe, rock.id).toBe('number');
      expect(rock.freqAlt, rock.id).toBeGreaterThan(0);
      expect(rock.warp, rock.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not build every rock the same way', () => {
    // Before this, all ten shared one formula and differed only by colour,
    // which is why they read as the same stone repainted.
    const recipes = new Set(getAllRocks().map((r) => r.recipe));
    expect(recipes.size).toBeGreaterThanOrEqual(4);
  });
});
