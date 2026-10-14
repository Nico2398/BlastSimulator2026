// Ore deposits on sandbox sites, through the real console runner (#1682).
//
// A sandbox site generates ore as discrete deposits; a saved game regenerates
// the same deposits, including on ground claimed past the base footprint.
// Authored levels keep legacy veins.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { saveCommand, loadCommand } from '../../src/console/commands/saveload.js';
import { claimForAction } from '../../src/console/commands/siteExpansion.js';
import { sandboxLevelDef, SANDBOX_DEFAULTS } from '../../src/core/campaign/Sandbox.js';
import type { TerrainConfig } from '../../src/core/world/TerrainGen.js';
import { MAX_TERRAIN_GEN_DIMENSION, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { fingerprintTerrainConfig } from '../helpers/terrainFingerprint.js';

const BIOME = 'green_foothills';
const SEED = 42;
/** East of the 64-wide base footprint: claiming here only succeeds if the site genuinely grows. */
const EXPANSION_X = 65;

function startSandbox(biome = BIOME, seed = SEED): GameContext {
  const { runner, ctx } = createRunner();
  const result = runner.run(`sandbox start biome:${biome} seed:${seed}`);
  expect(result.success, result.output).toBe(true);
  return ctx;
}

function expandEast(ctx: GameContext): void {
  const cells: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < 16; z++) cells.push({ x: EXPANSION_X, z });
  const claim = claimForAction(ctx, cells, 'test expansion');
  expect(claim.ok, `site expansion refused: ${claim.output}`).toBe(true);
  expect(claim.expanded).toBe(true);
}

function assertChunkOresMatch(a: VoxelGrid, b: VoxelGrid, cx: number, cz: number): number {
  const rect = b.chunkRect(cx, cz);
  expect(rect, `chunk (${cx}, ${cz}) not owned by the reference grid`).not.toBeNull();
  expect(a.hasChunk(cx, cz), `chunk (${cx}, ${cz}) not owned by the reloaded grid`).toBe(true);
  let oreVoxels = 0;
  for (let x = rect!.minX; x < rect!.maxX; x++) {
    for (let z = rect!.minZ; z < rect!.maxZ; z++) {
      for (let y = 0; y < MAX_TERRAIN_GEN_DIMENSION; y++) {
        expect(a.densityAt(x, y, z), `density (${x},${y},${z})`).toBe(b.densityAt(x, y, z));
        const bOres = b.oresAt(x, y, z);
        expect(a.oresAt(x, y, z), `ores (${x},${y},${z})`).toEqual(bOres);
        if (bOres && Object.keys(bOres).length > 0) oreVoxels++;
      }
    }
  }
  return oreVoxels;
}

describe('sandbox ore deposits (#1682)', () => {
  it('a sandbox start records oreDeposits on the world state', () => {
    expect(startSandbox().state!.world!.oreDeposits).toBe(true);
  });

  it('an authored campaign level start leaves oreDeposits off the world state', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.state!.world!.oreDeposits).toBeUndefined();
  });

  it('the sandbox terrain config with deposits fingerprints differently from the same config without', () => {
    const level = sandboxLevelDef({ ...SANDBOX_DEFAULTS, biome: BIOME, seed: SEED });
    const base: TerrainConfig = {
      seed: level.terrainSeed, climateBias: level.climateBias, sizeX: level.gridX, datum: level.datum, sizeZ: level.gridZ,
      mixedRockHardness: level.mixedRockHardness, ...(level.pitMask ? { pitMask: level.pitMask } : {}),
    };
    expect(level.oreDeposits).toBe(true);
    expect(fingerprintTerrainConfig({ ...base, oreDeposits: true }, 4)).not.toBe(fingerprintTerrainConfig(base, 4));
  });

  it('save and load regenerate identical ore, in a base chunk and in a chunk claimed past the base size', () => {
    const live = startSandbox();
    expandEast(live);
    expect(saveCommand(live, [], { slot: 'sandbox-deposits' }).success).toBe(true);
    live.grid = null;
    expect(loadCommand(live, [], { slot: 'sandbox-deposits' }).success).toBe(true);
    expect(live.grid).not.toBeNull();
    expect(live.state!.world!.oreDeposits, 'oreDeposits survives the save').toBe(true);

    const reference = startSandbox();
    expandEast(reference);

    let oreVoxels = 0;
    oreVoxels += assertChunkOresMatch(live.grid!, reference.grid!, 2, 2);
    oreVoxels += assertChunkOresMatch(live.grid!, reference.grid!, 4, 0);
    expect(oreVoxels, 'the compared chunks hold some ore').toBeGreaterThan(0);
  }, 60000);

  it('a reload with deposits on does not regenerate legacy veins', () => {
    const live = startSandbox();
    expect(saveCommand(live, [], { slot: 'sandbox-deposits-legacy' }).success).toBe(true);
    live.grid = null;
    expect(loadCommand(live, [], { slot: 'sandbox-deposits-legacy' }).success).toBe(true);

    // Same site started with deposits stripped from the world state regenerates legacy ore, which must differ.
    const legacy = startSandbox();
    legacy.state!.world!.oreDeposits = false;
    const saved = saveCommand(legacy, [], { slot: 'sandbox-deposits-off' });
    expect(saved.success).toBe(true);
    legacy.grid = null;
    expect(loadCommand(legacy, [], { slot: 'sandbox-deposits-off' }).success).toBe(true);

    let differs = false;
    for (let x = 8; x < 56 && !differs; x += 2) for (let z = 8; z < 56 && !differs; z += 2) for (let y = 0; y < 40; y++) {
      if (JSON.stringify(live.grid!.oresAt(x, y, z)) !== JSON.stringify(legacy.grid!.oresAt(x, y, z))) { differs = true; break; }
    }
    expect(differs).toBe(true);
  }, 60000);
});
