// BlastSimulator2026 — Anisotropic ore veins (#458 T1.3/A12)
// Replaces TerrainGen's old shared-noise-field hash-offset scheme. Each ore
// gets its own sub-seeded 3D ridged field, rotated into a per-ore strike
// direction and stretched along it (6.7x lower frequency along strike than
// across it) so veins read as elongated seams rather than isotropic blobs.
// With deposits on, hosting and windows come from SandboxDeepOre and density is graded by depth (#1933) before the site grade scale (#1932).
// Gated by a per-ore depth window and weighted by how strongly the voxel's
// actual rock blend hosts that ore — honours the composition weighting the
// old scheme only approximated.

import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import {
  ORE_DEPOSIT_CORE_GAIN, ORE_DEPTH_BLEND_M, ORE_DEPTH_MULTIPLIER_BANDS, ORE_GRADE_SCALE_DEFAULT, ORE_DEPOSIT_EDGE_WIDTH, ORE_DEPOSIT_FREQ, ORE_DEPOSIT_RARITY_COVERAGE,
} from '../config/balance.js';
import { Random } from '../math/Random.js';
import { subSeed, cellRand } from '../math/Hash.js';
import { getAllOres, type OreType } from './OreCatalog.js';
import { getRock } from './RockCatalog.js';
import { sandboxHostProbability, sandboxOreWindow } from './SandboxDeepOre.js';
import type { VoxelRockComposition } from './VoxelGrid.js';

/** Along-strike frequency; 6.7x lower than across-strike elongates veins along the strike axis. */
const STRIKE_FREQ = 0.015;
const CROSS_FREQ = 0.10;
const RICHNESS_WEIGHT = 0.9;
const DENSITY_GAIN = 4;
/** Sparse storage cutoff — densities at or below this are dropped, not stored as ~0 entries. */
const MIN_STORED_DENSITY = 0.05;

interface OreField {
  readonly noise: NoiseFunction3D;
  /** cos/sin of -strikeAngle, precomputed once so densitiesAt never recomputes trig per voxel. */
  readonly cosAngle: number;
  readonly sinAngle: number;
  /** Deposit gating (#1682); absent when deposits are off, leaving continuous veins. */
  readonly deposit?: {
    /** Horizontal low-frequency field deciding where this ore has a deposit. */
    readonly noise: NoiseFunction3D;
    /** Field value below which this ore's rarity tier has no deposit. */
    readonly cutoff: number;
  };
}

/** Σ coefficient_i * rock_i.oreProbabilities[oreId] — how strongly this voxel's rock blend hosts oreId. */
function hostRockAffinity(composition: VoxelRockComposition, oreId: string, sandbox: boolean): number {
  let sum = 0;
  for (const part of composition.rocks) {
    const rock = getRock(part.rockId);
    if (!rock) continue;
    sum += part.coefficient * (sandbox ? sandboxHostProbability(part.rockId, oreId) : rock.oreProbabilities[oreId] ?? 0);
  }
  return sum;
}

/** 0 below the rarity cutoff, smoothstepping up to ORE_DEPOSIT_CORE_GAIN over ORE_DEPOSIT_EDGE_WIDTH above it (#1682). */
function depositGain(depositValue: number, cutoff: number): number {
  const t = Math.min(1, (depositValue - cutoff) / ORE_DEPOSIT_EDGE_WIDTH);
  if (t <= 0) return 0;
  return ORE_DEPOSIT_CORE_GAIN * t * t * (3 - 2 * t);
}

/** The per-ore deposit field and its rarity cutoff; each ore's deposits are independent (own noise). */
function depositLayer(seed: number, ore: OreType): NonNullable<OreField['deposit']> {
  const rng = new Random(subSeed(seed, `ore-deposit:${ore.id}`));
  // Every catalog rarity has a coverage entry (unit-tested); a missing one would
  // read as cutoff 0, i.e. near-continuous veins, rather than crash the game.
  return { noise: createNoise3D(() => rng.next()), cutoff: ORE_DEPOSIT_RARITY_COVERAGE[ore.rarity] ?? 0 };
}

/**
 * Ore grade multiplier for a depth below the natural surface in metres (#1933).
 * Bands start at `fromDepth`; a smoothstep ramp of ORE_DEPTH_BLEND_M metres
 * begins at each band boundary and rises to the next band's multiplier.
 */
export function oreDepthMultiplier(depth: number): number {
  const bands = ORE_DEPTH_MULTIPLIER_BANDS;
  let i = 0;
  for (let b = 1; b < bands.length; b++) {
    if (depth >= bands[b]!.fromDepth) i = b;
  }
  const band = bands[i]!;
  if (i === 0) return band.multiplier;
  const t = Math.min(1, (depth - band.fromDepth) / ORE_DEPTH_BLEND_M);
  const previous = bands[i - 1]!.multiplier;
  return previous + (band.multiplier - previous) * t * t * (3 - 2 * t);
}

/** Depth-graded stored density, clamped at 1 and re-rounded to 2 decimals; untouched at multiplier 1 (#1933). */
function depthGraded(stored: number, depth: number): number {
  const mult = oreDepthMultiplier(depth);
  return mult === 1 ? stored : Math.round(Math.min(1, stored * mult) * 100) / 100;
}

/** Sampler options (#1682). */
interface OreVeinOptions {
  /** Ore grade scale (#1932): multiplies every stored density; absent or 1 leaves output untouched. */
  readonly gradeScale?: number;
  /** Gate veins to discrete deposits by rarity tier; off keeps the legacy continuous veins. */
  readonly deposits?: boolean;
}

/** Samples per-ore anisotropic vein density from rock composition + a depth window (#458 A12). */
export class OreVeinSampler {
  private readonly fields = new Map<string, OreField>();
  private readonly gradeScale: number;

  constructor(seed: number, options: OreVeinOptions = {}) {
    this.gradeScale = options.gradeScale ?? ORE_GRADE_SCALE_DEFAULT;
    for (const ore of getAllOres()) {
      const rng = new Random(subSeed(seed, `ore:${ore.id}`));
      const noise = createNoise3D(() => rng.next());
      const angle = cellRand(seed, 0, 0, subSeed(0, ore.id)) * Math.PI * 2;
      const field = { noise, cosAngle: Math.cos(-angle), sinAngle: Math.sin(-angle) };
      this.fields.set(ore.id, options.deposits ? { ...field, deposit: depositLayer(seed, ore) } : field);
    }
  }

  /** Ore densities at one voxel. `depth` is metres below surface (surfaceY - y, unwarped). */
  densitiesAt(
    x: number, y: number, z: number,
    depth: number,
    composition: VoxelRockComposition,
    oreRichness: number,
  ): Record<string, number> {
    const result: Record<string, number> = {};

    for (const ore of getAllOres()) {
      const field = this.fields.get(ore.id);
      if (!field) continue;
      const sandbox = field.deposit !== undefined;
      const [depthMin, depthMax] = sandbox ? sandboxOreWindow(ore) : [ore.depthMin, ore.depthMax];
      if (depth < depthMin || depth > depthMax) continue;

      const affinity = hostRockAffinity(composition, ore.id, sandbox);
      if (affinity <= 0) continue;

      const gain = field.deposit
        ? depositGain(field.deposit.noise(x * ORE_DEPOSIT_FREQ, 0, z * ORE_DEPOSIT_FREQ), field.deposit.cutoff)
        : 1;
      if (gain <= 0) continue;
      const u = x * field.cosAngle - z * field.sinAngle;
      const v = x * field.sinAngle + z * field.cosAngle;
      const n = 1 - Math.abs(field.noise(u * STRIKE_FREQ, y * CROSS_FREQ, v * CROSS_FREQ));

      const threshold = 1 - affinity * oreRichness * gain * RICHNESS_WEIGHT;
      if (n > threshold) {
        const density = Math.min(1, (n - threshold) * DENSITY_GAIN);
        if (density > MIN_STORED_DENSITY) {
          const rounded = Math.round(density * 100) / 100;
          // Depth pays (#1933): sandbox deposits only, before the site grade scale.
          const stored = field.deposit ? depthGraded(rounded, depth) : rounded;
          result[ore.id] = this.gradeScale === ORE_GRADE_SCALE_DEFAULT ? stored : stored * this.gradeScale;
        }
      }
    }

    return result;
  }
}
