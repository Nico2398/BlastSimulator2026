// BlastSimulator2026 — deterministic terrain fingerprint for regression tests
// (#1190, terrain-edit-storage series).
//
// A byte-identity guard against `main`: this hashes a strided sample of a
// `TerrainConfig`'s generated columns so a later refactor of the generator
// plumbing (WorldGen/TerrainGen/VoxelGrid) that accidentally changes real
// output — not just its shape — fails loudly against a baseline captured on
// `main` before the change.
//
// Pure function of `config` only: no mutable global state, no randomness of
// its own (every noise field the generator touches is itself seeded from
// `config.seed`), so the same config always hashes identically, on any
// machine, any run.
//
// To regenerate a baseline after a genuinely intentional generation change:
//   git checkout main -- src/core/world/TerrainGen.ts src/core/world/WorldGen.ts \
//     src/core/world/VoxelGrid.ts src/core/world/Strata.ts src/core/world/OreVeins.ts
//   npx vitest run tests/integration/terrain-datum-identity.integration.test.ts
//   # then read the printed/failed "Expected"/"Received" hash for each case
//   # and update the case table in that test file — never weaken the test
//   # itself to make a diverging hash pass.

import { createHash } from 'crypto';
import { buildTerrainContext, surfaceDensityAt, type TerrainConfig } from '../../src/core/world/TerrainGen.js';
import { sampleSurfaceHeightY } from '../../src/core/world/WorldGen.js';
import { getDominantRockId } from '../../src/core/world/VoxelGrid.js';

/** Depths (relative to each sampled column's own continuous surface) probed at every sampled column. */
const SAMPLE_OFFSETS = [-5, -2, -1, 0, 1, 2, 5, 50, 500] as const;

/** Serializes an ore-density record into a stable, key-order-independent string. */
function serializeOres(ores: Record<string, number>): string {
  return Object.keys(ores).sort().map(k => `${k}=${ores[k]}`).join(',');
}

/**
 * True when column (x, z) falls in the generator's neutral border zone, where
 * ore veins are cleared (mirrors `TerrainGen.ts`'s private `isInBorderZone`,
 * which isn't exported — reimplemented here from the same public
 * `biome.borderWidth`/`config.sizeX`/`config.sizeZ` inputs it uses).
 */
function isInBorderZone(x: number, z: number, sizeX: number, sizeZ: number, borderWidth: number): boolean {
  return x < borderWidth || x >= sizeX - borderWidth || z < borderWidth || z >= sizeZ - borderWidth;
}

/**
 * SHA-256 over a strided column sample of `config`'s generated terrain.
 *
 * Iterates x/z at `step` across `config.sizeX`/`config.sizeZ`; for each
 * sampled column, samples density/dominant-rock/ore composition at
 * `SAMPLE_OFFSETS` depths relative to that column's own continuous surface —
 * so the fingerprint tracks real generated content at a fixed set of
 * physically meaningful depths (just above/at/below the surface, and deep
 * underground) rather than a fixed absolute y that would land in a
 * differently-shaped part of the terrain depending on `config.datum`.
 *
 * Reuses the exact same public sampling calls `generateColumnRange`
 * (`TerrainGen.ts`) makes internally — `sampleSurfaceHeightY`,
 * `strata.boundariesAt`/`compositionAt`, `oreVeins.densitiesAt`,
 * `surfaceDensityAt` — so this is a query against the real generator
 * pipeline, not a reimplementation of it.
 */
export function fingerprintTerrainConfig(config: TerrainConfig, step = 8): string {
  const hash = createHash('sha256');
  const { worldGen, biome, strata, oreVeins } = buildTerrainContext(config);
  const { sizeX, sizeZ } = config;

  for (let z = 0; z < sizeZ; z += step) {
    for (let x = 0; x < sizeX; x += step) {
      const surfaceH = sampleSurfaceHeightY(worldGen, x, z);
      const surfaceY = Math.round(surfaceH);
      const boundaries = strata.boundariesAt(x, z);
      const inBorder = isInBorderZone(x, z, sizeX, sizeZ, biome.borderWidth);

      for (const offset of SAMPLE_OFFSETS) {
        const y = surfaceY + offset;
        const density = surfaceDensityAt(y, surfaceH);
        const depth = Math.max(0, surfaceY - y);
        const composition = strata.compositionAt(x, y, z, depth, boundaries);
        const dominantRockId = getDominantRockId(composition);
        const ores = inBorder ? {} : oreVeins.densitiesAt(x, y, z, depth, composition, biome.oreRichness);

        hash.update(`${x},${y},${z}:${density}:${dominantRockId}:${serializeOres(ores)}`);
      }
    }
  }

  return hash.digest('hex');
}
