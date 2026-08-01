// BlastSimulator2026 — Biome catalog (#458 T1.2)
// Replaces the three flat MinePreset entries. A biome is selected by climate
// (temperature/humidity noise, WorldNoiseFields), not chosen directly by the
// player — level definitions bias climate toward their intended biome
// (LevelDef.climateBias) so the four campaign levels still look distinct,
// while the surrounding world (once the landscape zone exists, T2.1) blends
// naturally between neighbouring biomes.

import type { Spline } from './HeightSpline.js';

export interface BiomeDef {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  /** Climate-space centre this biome is selected near: [temperature, humidity], each in [-1, 1]. */
  readonly climateCenter: readonly [number, number];
  readonly climateRadius: number;
  readonly baseSpline: Spline;
  readonly reliefSpline: Spline;
  readonly pvAmplitude: number;
  /** Rock IDs that dominate this biome's terrain, in decreasing probability. */
  readonly dominantRocks: readonly string[];
  /** Ore richness multiplier (1.0 = normal). */
  readonly oreRichness: number;
  /** Border zone width in voxels (neutral, ore-free zone). */
  readonly borderWidth: number;
  /** Forest placement density base, 0-1 (#458 T1.4/A15) — scaled further by per-point noise. */
  readonly forestDensity: number;
}

const BIOMES: readonly BiomeDef[] = [
  {
    id: 'desert_badlands',
    nameKey: 'biome.desert_badlands.name',
    descKey: 'biome.desert_badlands.desc',
    climateCenter: [0.7, -0.6],
    climateRadius: 0.55,
    baseSpline: [[-1, -6], [-0.4, 2], [0, 8], [0.4, 15], [0.7, 22], [1, 30]],
    reliefSpline: [[-1, 0.9], [-0.3, 0.65], [0.2, 0.35], [0.7, 0.2], [1, 0.1]],
    pvAmplitude: 18,
    dominantRocks: ['cruite', 'sandite', 'molite'],
    oreRichness: 0.8,
    borderWidth: 5,
    forestDensity: 0.06,
  },
  {
    id: 'red_canyon',
    nameKey: 'biome.red_canyon.name',
    descKey: 'biome.red_canyon.desc',
    climateCenter: [0.5, -0.2],
    climateRadius: 0.55,
    baseSpline: [[-1, -8], [-0.4, 3], [0, 12], [0.4, 24], [0.7, 36], [1, 48]],
    reliefSpline: [[-1, 1.2], [-0.3, 1.0], [0.2, 0.7], [0.7, 0.45], [1, 0.3]],
    pvAmplitude: 35,
    dominantRocks: ['sandite', 'molite', 'cruite'],
    oreRichness: 0.9,
    borderWidth: 5,
    forestDensity: 0.04,
  },
  {
    id: 'alpine_granite',
    nameKey: 'biome.alpine_granite.name',
    descKey: 'biome.alpine_granite.desc',
    climateCenter: [-0.7, 0.1],
    climateRadius: 0.55,
    baseSpline: [[-1, 4], [-0.4, 14], [0, 26], [0.4, 40], [0.7, 55], [1, 75]],
    reliefSpline: [[-1, 1.4], [-0.3, 1.1], [0.2, 0.7], [0.7, 0.4], [1, 0.2]],
    pvAmplitude: 55,
    dominantRocks: ['grumpite', 'clunkite', 'stubite', 'obstiite'],
    oreRichness: 1.0,
    borderWidth: 5,
    forestDensity: 0.35,
  },
  {
    id: 'green_foothills',
    nameKey: 'biome.green_foothills.name',
    descKey: 'biome.green_foothills.desc',
    climateCenter: [-0.1, 0.4],
    climateRadius: 0.55,
    baseSpline: [[-1, -2], [-0.4, 6], [0, 12], [0.4, 20], [0.7, 28], [1, 38]],
    reliefSpline: [[-1, 1.0], [-0.3, 0.75], [0.2, 0.5], [0.7, 0.3], [1, 0.15]],
    pvAmplitude: 25,
    dominantRocks: ['grumpite', 'clunkite', 'sandite'],
    oreRichness: 0.9,
    borderWidth: 5,
    forestDensity: 0.55,
  },
  {
    id: 'tropical_karst',
    nameKey: 'biome.tropical_karst.name',
    descKey: 'biome.tropical_karst.desc',
    climateCenter: [0.6, 0.7],
    climateRadius: 0.55,
    baseSpline: [[-1, -4], [-0.4, 6], [0, 16], [0.4, 28], [0.7, 40], [1, 55]],
    reliefSpline: [[-1, 1.3], [-0.3, 1.05], [0.2, 0.65], [0.7, 0.4], [1, 0.25]],
    pvAmplitude: 40,
    dominantRocks: ['obstiite', 'gnarlite', 'absurdite', 'titanite'],
    oreRichness: 1.5,
    borderWidth: 5,
    forestDensity: 0.7,
  },
  {
    id: 'volcanic_flats',
    nameKey: 'biome.volcanic_flats.name',
    descKey: 'biome.volcanic_flats.desc',
    climateCenter: [0.1, -0.8],
    climateRadius: 0.55,
    baseSpline: [[-1, -10], [-0.4, -2], [0, 5], [0.4, 12], [0.7, 20], [1, 40]],
    reliefSpline: [[-1, 0.8], [-0.3, 0.55], [0.2, 0.3], [0.7, 0.2], [1, 0.15]],
    pvAmplitude: 15,
    dominantRocks: ['obstiite', 'gnarlite', 'titanite'],
    oreRichness: 1.2,
    borderWidth: 5,
    forestDensity: 0.03,
  },
] as const;

const BIOME_MAP = new Map<string, BiomeDef>(BIOMES.map(b => [b.id, b]));

/**
 * Back-compat aliases for the pre-#458 MinePreset ids. Dozens of existing
 * tests and console-command call sites hardcode `mine_type:desert` /
 * `mountain` / `tropical` as plain string arguments — they never referenced
 * the MineType module directly, so renaming it couldn't update them by
 * construction. Each maps onto its spiritual successor biome.
 */
const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  desert: 'desert_badlands',
  mountain: 'alpine_granite',
  tropical: 'tropical_karst',
};

export function getBiome(id: string): BiomeDef | undefined {
  return BIOME_MAP.get(id) ?? BIOME_MAP.get(LEGACY_ALIASES[id] ?? '');
}

export function getAllBiomes(): readonly BiomeDef[] {
  return BIOMES;
}

export interface BiomeWeight {
  biome: BiomeDef;
  weight: number;
}

/**
 * Weight every biome by climate-space proximity: quadratic falloff inside
 * each biome's climateRadius, normalized to sum to 1. Falls back to the
 * single nearest-centre biome (weight 1) if every biome's radius excludes
 * this point (#458 A6).
 */
export function computeBiomeWeights(temperature: number, humidity: number): BiomeWeight[] {
  const raw = BIOMES.map(b => {
    const dt = temperature - b.climateCenter[0];
    const dh = humidity - b.climateCenter[1];
    const dist = Math.sqrt(dt * dt + dh * dh);
    const w = Math.max(0, 1 - dist / b.climateRadius);
    return { biome: b, weight: w * w };
  });

  const total = raw.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) {
    let best = BIOMES[0]!;
    let bestDistSq = Infinity;
    for (const b of BIOMES) {
      const dt = temperature - b.climateCenter[0];
      const dh = humidity - b.climateCenter[1];
      const distSq = dt * dt + dh * dh;
      if (distSq < bestDistSq) { bestDistSq = distSq; best = b; }
    }
    return [{ biome: best, weight: 1 }];
  }

  return raw
    .filter(r => r.weight > 0)
    .map(r => ({ biome: r.biome, weight: r.weight / total }));
}

/** The single highest-weighted biome — used for categorical (non-blendable) choices like rock lists. */
export function dominantBiome(weights: readonly BiomeWeight[]): BiomeDef {
  let best = weights[0]!;
  for (const w of weights) {
    if (w.weight > best.weight) best = w;
  }
  return best.biome;
}

/**
 * Bias the raw climate fields toward a level's intended biome before
 * weighting. `fade` is 1 inside a playable rect, 0 by 300m outside it (once
 * the landscape zone exists, T2.1) — every caller today passes 1, since
 * there is no "outside" yet.
 */
export function selectBiomeWeights(
  rawTemperature: number,
  rawHumidity: number,
  climateBias: readonly [number, number],
  fade: number,
): BiomeWeight[] {
  const t = Math.max(-1, Math.min(1, rawTemperature + climateBias[0] * fade));
  const h = Math.max(-1, Math.min(1, rawHumidity + climateBias[1] * fade));
  return computeBiomeWeights(t, h);
}
