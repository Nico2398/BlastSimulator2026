// BlastSimulator2026 — Surface material catalog
//
// What covers the ground, as opposed to what the ground is made of. Rock types
// (RockCatalog) are the body of the terrain and show wherever it has been cut;
// these are the loose, living, weathered layer that settles on top of it —
// dirt, grass, gravel, snow and the rest.
//
// Each entry carries its own procedural recipe rather than a shared formula
// with a different tint. A material is a composition of 3D noise fields
// evaluated at the world position, and which composition it uses is as much a
// part of its identity as its colour: marble is banding pushed sideways by a
// second field, gravel is packed cells, snow is drifted ridges. Two materials
// with the same recipe and different colours read as the same substance
// painted twice, which is exactly what the terrain used to look like.
//
// Selection is spatial and soft. Every material states where it belongs — how
// flat, how high, how wet — and the shader scores all of them per pixel and
// blends the strongest few. Nothing is assigned per-vertex or per-cell, so
// there is no seam anywhere for a hard edge to appear along.

/** Which composition of noise fields builds this material's surface. */
export enum MaterialRecipe {
  /** f(p) + f'(p) at a different frequency — granular, unstructured. */
  Sum = 0,
  /** f(f'(p)) — one field re-sampled through another; soft organic blotches. */
  Compose = 1,
  /** f(p + k·f'(p)) — domain warping. Banding dragged sideways: marble, gneiss. */
  Warp = 2,
  /** Worley F1 — packed grains and pebbles. */
  Cell = 3,
  /** Worley F2−F1 — the seams between cells: cracked clay, ice, columnar basalt. */
  CellEdge = 4,
  /** Ridged multifractal — sharp crests: strata, wind-drifted snow. */
  Ridged = 5,
  /** Broad field plus fine cellular speckle — granite, moss, lichen. */
  Speckle = 6,
}

export interface SurfaceMaterial {
  readonly id: string;
  readonly nameKey: string;
  /** Dominant colour. */
  readonly color: string;
  /** Secondary colour the recipe mixes toward — the two define the material's range. */
  readonly colorAlt: string;
  readonly recipe: MaterialRecipe;
  /** Feature size of the primary field, in cycles per metre. */
  readonly freq: number;
  /** Frequency of the secondary field, relative to the primary. */
  readonly freqAlt: number;
  /** Domain-warp / composition strength. Unused by Sum and Cell. */
  readonly warp: number;
  /** How far the two colours separate. 0 = flat colour, 1 = full range. */
  readonly contrast: number;
  /** Surface relief the normal perturbation applies, 0–1. */
  readonly bump: number;
  /** Roughness offset applied to the material, −0.3..+0.3. Ice and marble are glossy. */
  readonly roughness: number;

  // ---- where it belongs ----
  /** Preferred surface flatness, 0 = vertical face, 1 = level ground. */
  readonly slopeCenter: number;
  /** Tolerance around slopeCenter. Wider = appears across more of the range. */
  readonly slopeWidth: number;
  /** Preferred altitude within the site's own height range, 0–1. */
  readonly altitudeCenter: number;
  readonly altitudeWidth: number;
  /** Preferred wetness, 0 = arid, 1 = saturated. */
  readonly moisture: number;
  /** Size of the patches this material forms, in metres. */
  readonly patchScale: number;
  /** Per-biome likelihood, 0 = never appears there. Biomes absent from the map score 0. */
  readonly biomeAffinity: Readonly<Record<string, number>>;
}

const ALL_ARID = { desert_badlands: 1.0, red_canyon: 1.0, volcanic_flats: 0.9 };
const ALL_TEMPERATE = { green_foothills: 1.0, tropical_karst: 0.9, alpine_granite: 0.6 };

/**
 * Ordered list. The shader receives these as uniform arrays, so the index of
 * an entry is its identity on the GPU — append rather than reorder.
 */
export const SURFACE_MATERIALS: readonly SurfaceMaterial[] = [
  {
    id: 'dirt', nameKey: 'material.dirt',
    color: '#6b5138', colorAlt: '#8a6d4a',
    recipe: MaterialRecipe.Sum, freq: 0.55, freqAlt: 4.1, warp: 0.0,
    contrast: 0.42, bump: 0.5, roughness: 0.06,
    slopeCenter: 0.86, slopeWidth: 0.34, altitudeCenter: 0.4, altitudeWidth: 0.9,
    moisture: 0.5, patchScale: 34,
    biomeAffinity: { ...ALL_TEMPERATE, desert_badlands: 0.5, red_canyon: 0.5, volcanic_flats: 0.6 },
  },
  {
    id: 'grass', nameKey: 'material.grass',
    color: '#5d7a3a', colorAlt: '#87a154',
    recipe: MaterialRecipe.Speckle, freq: 1.6, freqAlt: 7.0, warp: 0.0,
    contrast: 0.5, bump: 0.35, roughness: 0.1,
    slopeCenter: 0.95, slopeWidth: 0.26, altitudeCenter: 0.35, altitudeWidth: 0.6,
    moisture: 0.72, patchScale: 42,
    biomeAffinity: { green_foothills: 1.0, tropical_karst: 0.85, alpine_granite: 0.4 },
  },
  {
    id: 'moss', nameKey: 'material.moss',
    color: '#41603a', colorAlt: '#6d8f4e',
    recipe: MaterialRecipe.Compose, freq: 2.4, freqAlt: 0.5, warp: 1.4,
    contrast: 0.46, bump: 0.42, roughness: 0.12,
    slopeCenter: 0.62, slopeWidth: 0.42, altitudeCenter: 0.3, altitudeWidth: 0.55,
    moisture: 0.92, patchScale: 16,
    biomeAffinity: { tropical_karst: 1.0, green_foothills: 0.8, alpine_granite: 0.3 },
  },
  {
    id: 'gravel', nameKey: 'material.gravel',
    color: '#7d7568', colorAlt: '#a9a094',
    recipe: MaterialRecipe.Cell, freq: 3.4, freqAlt: 1.2, warp: 0.0,
    contrast: 0.55, bump: 0.8, roughness: 0.04,
    slopeCenter: 0.8, slopeWidth: 0.36, altitudeCenter: 0.5, altitudeWidth: 1.0,
    moisture: 0.3, patchScale: 24,
    biomeAffinity: { ...ALL_ARID, ...ALL_TEMPERATE, alpine_granite: 0.9 },
  },
  {
    id: 'scree', nameKey: 'material.scree',
    color: '#6f6a63', colorAlt: '#938c81',
    recipe: MaterialRecipe.Cell, freq: 1.5, freqAlt: 0.8, warp: 0.0,
    contrast: 0.62, bump: 1.0, roughness: 0.02,
    slopeCenter: 0.5, slopeWidth: 0.3, altitudeCenter: 0.68, altitudeWidth: 0.6,
    moisture: 0.2, patchScale: 30,
    biomeAffinity: { alpine_granite: 1.0, red_canyon: 0.7, volcanic_flats: 0.6, desert_badlands: 0.5 },
  },
  {
    id: 'sand', nameKey: 'material.sand',
    color: '#c8ad78', colorAlt: '#e0cb9c',
    recipe: MaterialRecipe.Ridged, freq: 0.28, freqAlt: 3.0, warp: 0.0,
    contrast: 0.3, bump: 0.45, roughness: 0.08,
    slopeCenter: 0.97, slopeWidth: 0.22, altitudeCenter: 0.28, altitudeWidth: 0.7,
    moisture: 0.06, patchScale: 60,
    biomeAffinity: { desert_badlands: 1.0, red_canyon: 0.7, volcanic_flats: 0.4 },
  },
  {
    id: 'clay', nameKey: 'material.clay',
    color: '#9c6b4f', colorAlt: '#c08f68',
    recipe: MaterialRecipe.CellEdge, freq: 1.1, freqAlt: 2.0, warp: 0.0,
    contrast: 0.5, bump: 0.55, roughness: -0.06,
    slopeCenter: 0.93, slopeWidth: 0.2, altitudeCenter: 0.22, altitudeWidth: 0.5,
    moisture: 0.42, patchScale: 28,
    biomeAffinity: { red_canyon: 1.0, desert_badlands: 0.7, green_foothills: 0.5, tropical_karst: 0.5 },
  },
  {
    id: 'mud', nameKey: 'material.mud',
    color: '#4a3a2a', colorAlt: '#6a5540',
    recipe: MaterialRecipe.Compose, freq: 0.9, freqAlt: 0.35, warp: 2.1,
    contrast: 0.38, bump: 0.3, roughness: -0.14,
    slopeCenter: 0.98, slopeWidth: 0.16, altitudeCenter: 0.12, altitudeWidth: 0.4,
    moisture: 1.0, patchScale: 22,
    biomeAffinity: { tropical_karst: 1.0, green_foothills: 0.7 },
  },
  {
    id: 'marble', nameKey: 'material.marble',
    color: '#d8d4cc', colorAlt: '#8d8b96',
    recipe: MaterialRecipe.Warp, freq: 0.7, freqAlt: 0.45, warp: 2.6,
    contrast: 0.6, bump: 0.2, roughness: -0.24,
    slopeCenter: 0.55, slopeWidth: 0.45, altitudeCenter: 0.5, altitudeWidth: 0.8,
    moisture: 0.25, patchScale: 46,
    biomeAffinity: { tropical_karst: 0.9, alpine_granite: 0.6 },
  },
  {
    id: 'ice', nameKey: 'material.ice',
    color: '#bcd6e4', colorAlt: '#8fb6cf',
    recipe: MaterialRecipe.CellEdge, freq: 0.8, freqAlt: 2.6, warp: 0.0,
    contrast: 0.34, bump: 0.25, roughness: -0.3,
    slopeCenter: 0.9, slopeWidth: 0.3, altitudeCenter: 0.88, altitudeWidth: 0.4,
    moisture: 0.6, patchScale: 38,
    biomeAffinity: { alpine_granite: 1.0 },
  },
  {
    id: 'snow', nameKey: 'material.snow',
    color: '#eef3f7', colorAlt: '#c4d3e0',
    recipe: MaterialRecipe.Ridged, freq: 0.42, freqAlt: 2.2, warp: 0.0,
    contrast: 0.22, bump: 0.4, roughness: 0.05,
    slopeCenter: 0.92, slopeWidth: 0.34, altitudeCenter: 0.95, altitudeWidth: 0.5,
    moisture: 0.5, patchScale: 52,
    biomeAffinity: { alpine_granite: 1.0, green_foothills: 0.25 },
  },
  {
    id: 'ash', nameKey: 'material.ash',
    color: '#3f3b39', colorAlt: '#615c58',
    recipe: MaterialRecipe.Sum, freq: 0.8, freqAlt: 6.0, warp: 0.0,
    contrast: 0.34, bump: 0.3, roughness: 0.14,
    slopeCenter: 0.9, slopeWidth: 0.3, altitudeCenter: 0.4, altitudeWidth: 0.9,
    moisture: 0.1, patchScale: 40,
    biomeAffinity: { volcanic_flats: 1.0 },
  },
  {
    id: 'salt', nameKey: 'material.salt',
    color: '#e6e2d6', colorAlt: '#c3bda9',
    recipe: MaterialRecipe.CellEdge, freq: 0.5, freqAlt: 1.6, warp: 0.0,
    contrast: 0.4, bump: 0.35, roughness: 0.0,
    slopeCenter: 0.99, slopeWidth: 0.12, altitudeCenter: 0.08, altitudeWidth: 0.3,
    moisture: 0.15, patchScale: 44,
    biomeAffinity: { desert_badlands: 0.8, volcanic_flats: 0.7 },
  },
];

/** Uniform-array slot count. Sized with headroom, matching the rock convention. */
export const SURFACE_MATERIAL_SLOTS = 16;

export function getSurfaceMaterial(id: string): SurfaceMaterial | undefined {
  return SURFACE_MATERIALS.find((m) => m.id === id);
}

export function surfaceMaterialIndexOf(id: string): number {
  return SURFACE_MATERIALS.findIndex((m) => m.id === id);
}

/**
 * How strongly each material should appear on a given biome, in catalog order.
 *
 * Resolved on the CPU because it is per-level and never changes during play —
 * the shader only does the part that varies per pixel. A biome nobody declared
 * an affinity for scores 0 and is simply absent, which is how a desert avoids
 * growing moss.
 */
export function biomeAffinities(biomeId: string): number[] {
  return SURFACE_MATERIALS.map((m) => m.biomeAffinity[biomeId] ?? 0);
}
