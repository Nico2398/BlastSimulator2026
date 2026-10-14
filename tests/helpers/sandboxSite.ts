// BlastSimulator2026 — shared sandbox-site terrain fixtures (#1680, #1734).
//
// The terrain config the game builds for a sandbox site and the flat-pad
// measurement of the #1680 guarantee, shared by the sandbox and terrain suites.

import { sandboxLevelDef, SANDBOX_DEFAULTS } from '../../src/core/campaign/Sandbox.js';
import { SANDBOX_FLAT_PAD_SIZE, SANDBOX_FLAT_PAD_MAX_SPREAD } from '../../src/core/config/balance.js';
import type { TerrainConfig } from '../../src/core/world/TerrainGen.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';

/** The terrain config the game builds for a sandbox site (sandbox start -> regenerateGrid). */
export function sandboxTerrainConfig(biome: string, seed: number): TerrainConfig {
  const level = sandboxLevelDef({ ...SANDBOX_DEFAULTS, biome, seed });
  return {
    seed: level.terrainSeed,
    climateBias: level.climateBias,
    sizeX: level.gridX,
    datum: level.datum,
    sizeZ: level.gridZ,
    mixedRockHardness: level.mixedRockHardness,
    ...(level.oreDeposits ? { oreDeposits: true } : {}),
    ...(level.pitMask ? { pitMask: level.pitMask } : {}),
  };
}

/** Share of SIZE x SIZE pads (origin step 3, fully inside the grid) whose surface spread is within the cap. */
export function flatPadShare(grid: VoxelGrid): number {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let flat = 0, total = 0;
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      total++;
      if (hi - lo <= SANDBOX_FLAT_PAD_MAX_SPREAD) flat++;
    }
  }
  return flat / total;
}
