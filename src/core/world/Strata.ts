// BlastSimulator2026 — Depth-stratified rock composition (#458 T1.3/A11)
// Replaces TerrainGen's old per-voxel 3D-noise rock blend with an ordered,
// depth-layered profile: shallow layers favour a biome's softer dominant
// rocks, deep layers favour its harder ones. Layer boundaries tilt per
// column via one sub-seeded 2D field per layer, then jitter per-voxel via a
// shared 3D warp field, so a blast cross-section shows wavy bands rather
// than flat lines. Profiles are derived programmatically from a biome's
// `dominantRocks` (sorted by hardness tier) instead of 6 hand-authored
// profiles, so each biome's own tier range — e.g. tropical_karst's 4-5
// versus desert_badlands' 1-2 — still produces a sensible soft-to-hard
// gradient with depth.

import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from 'simplex-noise';
import { Random } from '../math/Random.js';
import { subSeed } from '../math/Hash.js';
import { fbm2 } from './NoiseFields.js';
import { getRock, type RockType } from './RockCatalog.js';
import type { VoxelRockComposition } from './VoxelGrid.js';

export interface StratumDef {
  readonly blend: ReadonlyArray<{ rockId: string; coefficient: number }>;
  /** Metres. */
  readonly meanThickness: number;
  /** Metres; scales the per-column tilt noise contribution to thickness. */
  readonly thicknessVariance: number;
}

/** Default profile shape: topsoil -> overburden -> bedded -> deep (#458 A11). */
const LAYER_SHAPE: ReadonlyArray<{ meanThickness: number; thicknessVariance: number }> = [
  { meanThickness: 1.5, thicknessVariance: 0.5 },
  { meanThickness: 4.5, thicknessVariance: 1.5 },
  { meanThickness: 14, thicknessVariance: 6 },
  { meanThickness: 40, thicknessVariance: 15 },
];

const MIXED_LAYER_COUNT = 6;
const MIXED_MEAN_THICKNESS = 5;
const MIXED_THICKNESS_VARIANCE = 1;

/** Metres either side of a layer boundary that linearly blend the two layers' compositions. */
const BOUNDARY_BLEND_RANGE = 0.75;

function resolveSortedRocks(dominantRockIds: readonly string[]): RockType[] {
  const rocks = dominantRockIds
    .map(id => getRock(id))
    .filter((r): r is RockType => r !== undefined);
  return rocks.sort((a, b) => a.hardnessTier - b.hardnessTier);
}

/** Coefficients sum to exactly 1 (rounding remainder dumped onto the first entry). */
function normalizeBlend(rocks: readonly RockType[]): Array<{ rockId: string; coefficient: number }> {
  const raw = 1 / rocks.length;
  const blend = rocks.map(r => ({ rockId: r.id, coefficient: Math.round(raw * 100) / 100 }));
  const sum = blend.reduce((s, b) => s + b.coefficient, 0);
  const first = blend[0];
  if (first) first.coefficient = Math.round((first.coefficient + (1 - sum)) * 100) / 100;
  return blend;
}

/**
 * Derive a 4-layer strata profile from a biome's dominant rocks, sliced by
 * relative position in the sorted (softest-first) list so it works
 * regardless of the biome's absolute tier range. Returns [] if none of the
 * biome's dominantRocks resolve to a known rock (caller falls back to air).
 */
export function buildStrataProfile(dominantRockIds: readonly string[]): StratumDef[] {
  const rocks = resolveSortedRocks(dominantRockIds);
  if (rocks.length === 0) return [];
  const n = rocks.length;
  return LAYER_SHAPE.map((shape, i) => {
    const lo = Math.floor((i / LAYER_SHAPE.length) * n);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / LAYER_SHAPE.length) * n));
    const window = rocks.slice(lo, Math.min(hi, n));
    return {
      blend: normalizeBlend(window.length > 0 ? window : rocks),
      meanThickness: shape.meanThickness,
      thicknessVariance: shape.thicknessVariance,
    };
  });
}

/**
 * `mixedRockHardness: true` variant (#458 D4/A11): alternates the biome's
 * softest and hardest dominant rock in ~5 m bands instead of a soft-to-hard
 * gradient, so projections keep flipping between easy and hard rock.
 */
export function buildMixedHardnessStrata(dominantRockIds: readonly string[]): StratumDef[] {
  const rocks = resolveSortedRocks(dominantRockIds);
  if (rocks.length === 0) return [];
  const soft = rocks[0]!;
  const hard = rocks[rocks.length - 1]!;
  const layers: StratumDef[] = [];
  for (let i = 0; i < MIXED_LAYER_COUNT; i++) {
    layers.push({
      blend: normalizeBlend([i % 2 === 0 ? soft : hard]),
      meanThickness: MIXED_MEAN_THICKNESS,
      thicknessVariance: MIXED_THICKNESS_VARIANCE,
    });
  }
  return layers;
}

function layerIndexFor(d: number, boundaries: readonly number[]): number {
  for (let i = 0; i < boundaries.length; i++) {
    if (d < boundaries[i]!) return i;
  }
  return boundaries.length - 1;
}

/** Linearly blend two layers' compositions by t in [0, 1] (0 = all a, 1 = all b). */
function blendLayers(a: StratumDef, b: StratumDef, t: number): VoxelRockComposition {
  const coeffs = new Map<string, number>();
  for (const r of a.blend) coeffs.set(r.rockId, (coeffs.get(r.rockId) ?? 0) + r.coefficient * (1 - t));
  for (const r of b.blend) coeffs.set(r.rockId, (coeffs.get(r.rockId) ?? 0) + r.coefficient * t);
  const rocks = Array.from(coeffs.entries())
    .filter(([, c]) => c > 0.01)
    .map(([rockId, c]) => ({ rockId, coefficient: Math.round(c * 100) / 100 }));
  return { rocks };
}

/** Samples ordered strata layers into a per-voxel rock composition (#458 A11). */
export class StrataSampler {
  private readonly tiltFields: NoiseFunction2D[];
  private readonly warpField: NoiseFunction3D;

  constructor(seed: number, private readonly profile: readonly StratumDef[]) {
    this.tiltFields = profile.map((_, i) => {
      const rng = new Random(subSeed(seed, `strata:${i}`));
      return createNoise2D(() => rng.next());
    });
    const warpRng = new Random(subSeed(seed, 'strataWarp'));
    this.warpField = createNoise3D(() => warpRng.next());
  }

  /** Cumulative boundary depths for one column (metres below surface) — compute once per (x, z), reuse across y. */
  boundariesAt(x: number, z: number): number[] {
    const boundaries: number[] = [];
    let prev = 0;
    for (let i = 0; i < this.profile.length; i++) {
      const layer = this.profile[i]!;
      const tilt = fbm2(this.tiltFields[i]!, x, z, 2, 1 / 120);
      prev += Math.max(0.5, layer.meanThickness + layer.thicknessVariance * tilt);
      boundaries.push(prev);
    }
    return boundaries;
  }

  /** Rock composition at one voxel. `depth` is metres below surface (surfaceY - y); `boundaries` from boundariesAt(x, z). */
  compositionAt(x: number, y: number, z: number, depth: number, boundaries: readonly number[]): VoxelRockComposition {
    if (this.profile.length === 0) return { rocks: [] };

    const warp = 1.5 * this.warpField(x * 0.06, y * 0.06, z * 0.06);
    const d = Math.max(0, depth + warp);
    const idx = layerIndexFor(d, boundaries);
    const layer = this.profile[idx]!;

    if (idx > 0) {
      const boundary = boundaries[idx - 1]!;
      const dist = d - boundary;
      if (Math.abs(dist) < BOUNDARY_BLEND_RANGE) {
        const t = (dist + BOUNDARY_BLEND_RANGE) / (2 * BOUNDARY_BLEND_RANGE);
        return blendLayers(this.profile[idx - 1]!, layer, t);
      }
    }
    if (idx < this.profile.length - 1) {
      const boundary = boundaries[idx]!;
      const dist = d - boundary;
      if (Math.abs(dist) < BOUNDARY_BLEND_RANGE) {
        const t = (dist + BOUNDARY_BLEND_RANGE) / (2 * BOUNDARY_BLEND_RANGE);
        return blendLayers(layer, this.profile[idx + 1]!, t);
      }
    }

    return { rocks: layer.blend.map(r => ({ ...r })) };
  }
}
