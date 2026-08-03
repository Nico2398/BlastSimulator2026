// BlastSimulator2026 — Anisotropic ore veins (#458 T1.3/A12)
// Replaces TerrainGen's old shared-noise-field hash-offset scheme. Each ore
// gets its own sub-seeded 3D ridged field, rotated into a per-ore strike
// direction and stretched along it (6.7x lower frequency along strike than
// across it) so veins read as elongated seams rather than isotropic blobs.
// Gated by a per-ore depth window and weighted by how strongly the voxel's
// actual rock blend hosts that ore — honours the composition weighting the
// old scheme only approximated.

import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { Random } from '../math/Random.js';
import { subSeed, cellRand } from '../math/Hash.js';
import { getAllOres } from './OreCatalog.js';
import { getRock } from './RockCatalog.js';
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
}

/** Σ coefficient_i * rock_i.oreProbabilities[oreId] — how strongly this voxel's rock blend hosts oreId. */
function hostRockAffinity(composition: VoxelRockComposition, oreId: string): number {
  let sum = 0;
  for (const part of composition.rocks) {
    const rock = getRock(part.rockId);
    if (!rock) continue;
    sum += part.coefficient * (rock.oreProbabilities[oreId] ?? 0);
  }
  return sum;
}

/** Samples per-ore anisotropic vein density from rock composition + a depth window (#458 A12). */
export class OreVeinSampler {
  private readonly fields = new Map<string, OreField>();

  constructor(seed: number) {
    for (const ore of getAllOres()) {
      const rng = new Random(subSeed(seed, `ore:${ore.id}`));
      const noise = createNoise3D(() => rng.next());
      const angle = cellRand(seed, 0, 0, subSeed(0, ore.id)) * Math.PI * 2;
      this.fields.set(ore.id, { noise, cosAngle: Math.cos(-angle), sinAngle: Math.sin(-angle) });
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
      if (depth < ore.depthMin || depth > ore.depthMax) continue;

      const affinity = hostRockAffinity(composition, ore.id);
      if (affinity <= 0) continue;

      const field = this.fields.get(ore.id);
      if (!field) continue;
      const u = x * field.cosAngle - z * field.sinAngle;
      const v = x * field.sinAngle + z * field.cosAngle;
      const n = 1 - Math.abs(field.noise(u * STRIKE_FREQ, y * CROSS_FREQ, v * CROSS_FREQ));

      const threshold = 1 - affinity * oreRichness * RICHNESS_WEIGHT;
      if (n > threshold) {
        const density = Math.min(1, (n - threshold) * DENSITY_GAIN);
        if (density > MIN_STORED_DENSITY) {
          result[ore.id] = Math.round(density * 100) / 100;
        }
      }
    }

    return result;
  }
}
