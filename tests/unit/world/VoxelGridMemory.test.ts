// #1182 — cubic 16×16×16 slab storage: memory proof.
//
// A dense sizeY-tall array per owned (cx,cz) column allocates storage
// proportional to the grid's DECLARED height, even when only a thin surface
// crust was ever generated into it. Cubic slabs allocate storage
// proportional to how deep the column was actually generated/dug instead —
// this file proves that at the scale of a real campaign level
// (`treranium_depths`, #458 D13's 160x160 biggest-level figure), not just a
// synthetic small grid.
//
// Keep this file's runtime bounded: exactly the two generateTerrain calls
// described below, nothing more (a 160x160 generation is not free).

import { describe, it, expect } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { generateTerrain, buildTerrainContext, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getLevel } from '../../../src/core/campaign/Level.js';

const treraniumDepths = getLevel('treranium_depths');
if (!treraniumDepths) {
  throw new Error("VoxelGridMemory.test.ts: campaign level 'treranium_depths' not found — has it been renamed?");
}

const BASE_SIZE_Y = treraniumDepths.gridY;

function treraniumConfig(sizeY: number): TerrainConfig {
  return {
    sizeX: treraniumDepths!.gridX,
    sizeY,
    sizeZ: treraniumDepths!.gridZ,
    seed: treraniumDepths!.terrainSeed,
    climateBias: treraniumDepths!.climateBias,
    mixedRockHardness: treraniumDepths!.mixedRockHardness,
  };
}

describe('VoxelGrid — cubic slab storage at treranium_depths scale (#1182)', () => {
  const gridBase = generateTerrain(treraniumConfig(BASE_SIZE_Y));
  const gridTall = generateTerrain(treraniumConfig(BASE_SIZE_Y * 4));

  it('raising the declared sizeY to 4x allocates no extra storage chunks — allocatedChunkCount is unchanged', () => {
    expect(gridBase.allocatedChunkCount).toBe(gridTall.allocatedChunkCount);
  });

  it('allocatedChunkCount is materially smaller than the old dense-model equivalent (genuine sparsity, not a tautology)', () => {
    const denseModelEquivalent = gridBase.chunkCount * Math.ceil(gridBase.sizeY / VoxelGrid.CHUNK_SIZE);
    expect(gridBase.allocatedChunkCount).toBeLessThan(denseModelEquivalent / 2);
  });

  it('the taller grid\'s dense-model equivalent would have been even larger, yet its real allocation matches the shorter grid\'s', () => {
    const denseModelEquivalentTall = gridTall.chunkCount * Math.ceil(gridTall.sizeY / VoxelGrid.CHUNK_SIZE);
    const denseModelEquivalentBase = gridBase.chunkCount * Math.ceil(gridBase.sizeY / VoxelGrid.CHUNK_SIZE);
    expect(denseModelEquivalentTall).toBeGreaterThan(denseModelEquivalentBase);
    expect(gridTall.allocatedChunkCount).toBe(gridBase.allocatedChunkCount);
  });

  // NOTE (#1182, @test-writer): the planner's own acceptance criteria describe
  // this check as the two grids' surface reading IDENTICALLY at every sampled
  // column. That is not literally true of this codebase's existing generator:
  // WorldGen's `createWorldGenContext` computes a `groundOffset` from
  // `Math.floor(sizeY * 0.55) - centerHeight`, so raising the declared sizeY
  // deliberately shifts the whole generated crust upward by a fixed, known
  // amount (measured 105 rows for 64 -> 256 here) — unrelated to #1182's
  // storage change, and true on `main` today. A literal equality assertion
  // would never pass under a correct implementation, so it would lock in
  // behaviour @implementer could never satisfy without changing WorldGen,
  // which is out of this issue's scope. What genuinely proves "the same
  // terrain, regardless of declared height" is that BOTH grids' surface
  // shifts by that exact same constant at every sampled column — i.e. the
  // storage model change these tests exist for has zero effect on generation
  // shape. See this run's final report for the full measurement.
  it('both grids generate the same terrain shape, offset by the exact known ground-offset shift the taller declared sizeY produces — sampled at a handful of interior columns', () => {
    const ctxBase = buildTerrainContext(treraniumConfig(BASE_SIZE_Y));
    const ctxTall = buildTerrainContext(treraniumConfig(BASE_SIZE_Y * 4));
    const expectedShift = ctxTall.worldGen.groundOffset - ctxBase.worldGen.groundOffset;
    expect(expectedShift).toBeGreaterThan(0); // sanity: the two configs really do use a different vertical datum

    // Interior columns, clear of the pit-mask/border edge where the shorter
    // grid's surface can clamp against its own sizeY - 1 ceiling (a real edge
    // case, not something this test is about).
    const samples: Array<[number, number]> = [
      [10, 10],
      [79, 79],
      [150, 150],
      [10, 150],
      [150, 10],
      [40, 120],
    ];
    for (const [x, z] of samples) {
      const surfaceBase = computeVoxelColumnSurfaceY(gridBase, x, z);
      const surfaceTall = computeVoxelColumnSurfaceY(gridTall, x, z);
      expect(surfaceTall - surfaceBase, `surface shift at (${x},${z}) should equal the known ground-offset delta`).toBe(expectedShift);
      expect(gridTall.densityAt(x, surfaceTall, z), `density at the shifted surface (${x},${z}) should match`)
        .toBeCloseTo(gridBase.densityAt(x, surfaceBase, z), 10);
    }
  });
});
