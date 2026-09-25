// BlastSimulator2026 — VoxelGridCodec unit tests (#1181)
//
// A save no longer embeds dense chunk data. It embeds the complete generator
// identity terrain was produced from (`SerializedTerrainGen` — seed,
// climateBias, base size, mixedRockHardness, TERRAIN_GENERATOR_VERSION) plus
// the edit record (#1180's `grid.edits`) of everything play changed since
// generation. `decodeVoxelGrid` regenerates pristine terrain from the
// generator identity, then replays the edit record on top — reproducing the
// live grid voxel for voxel without ever storing every voxel's full state.
//
// RED phase: `encodeVoxelGrid`/`decodeVoxelGrid` are still
// `throw new Error('not implemented')` stubs, so every test below fails.

import { describe, it, expect } from 'vitest';
import { generateTerrain, TERRAIN_GENERATOR_VERSION, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  encodeVoxelGrid, decodeVoxelGrid, TerrainGenVersionMismatchError,
  type SerializedTerrainGen, type SerializedVoxels,
} from '../../../src/core/state/VoxelGridCodec.js';

/** A small, fast-to-generate generator identity, overridable per test. */
function makeGen(overrides: Partial<SerializedTerrainGen> = {}): SerializedTerrainGen {
  return {
    version: TERRAIN_GENERATOR_VERSION,
    seed: 42,
    climateBias: [0, 0],
    sizeX: 32,
    sizeY: 16,
    sizeZ: 32,
    ...overrides,
  };
}

/** The `TerrainConfig` `generateTerrain` expects, built from a `SerializedTerrainGen`. */
function genToConfig(gen: SerializedTerrainGen): TerrainConfig {
  return {
    seed: gen.seed,
    climateBias: gen.climateBias,
    sizeX: gen.sizeX,
    sizeY: gen.sizeY,
    sizeZ: gen.sizeZ,
    ...(gen.mixedRockHardness !== undefined ? { mixedRockHardness: gen.mixedRockHardness } : {}),
  };
}

/** Walks every voxel of `gen`'s footprint and compares `a` against `b` — density, dominant rock, ores, fracture. Fails on the first mismatch, naming the voxel. */
function assertGridsMatchVoxelForVoxel(a: VoxelGrid, b: VoxelGrid, gen: SerializedTerrainGen): void {
  for (let x = 0; x < gen.sizeX; x++) {
    for (let z = 0; z < gen.sizeZ; z++) {
      for (let y = 0; y < gen.sizeY; y++) {
        const aDensity = a.densityAt(x, y, z);
        const bDensity = b.densityAt(x, y, z);
        expect(aDensity, `density mismatch at (${x},${y},${z}): a=${aDensity} b=${bDensity}`).toBe(bDensity);

        const aRock = a.dominantRockAt(x, y, z);
        const bRock = b.dominantRockAt(x, y, z);
        expect(aRock, `dominant rock mismatch at (${x},${y},${z}): a=${aRock} b=${bRock}`).toBe(bRock);

        const aOres = a.oresAt(x, y, z);
        const bOres = b.oresAt(x, y, z);
        expect(aOres, `ore mismatch at (${x},${y},${z}): a=${JSON.stringify(aOres)} b=${JSON.stringify(bOres)}`).toEqual(bOres);

        const aFracture = a.fractureAt(x, y, z);
        const bFracture = b.fractureAt(x, y, z);
        expect(aFracture, `fracture mismatch at (${x},${y},${z}): a=${aFracture} b=${bFracture}`).toBeCloseTo(bFracture, 10);
      }
    }
  }
}

describe('encodeVoxelGrid / decodeVoxelGrid — untouched grid', () => {
  it('round-trips claimed chunks and the generator identity for a freshly generated, never-edited grid', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));

    const payload = encodeVoxelGrid(grid, gen);

    expect(payload.gen.version).toBe(TERRAIN_GENERATOR_VERSION);
    expect(payload.gen.seed).toBe(gen.seed);
    expect(payload.gen.climateBias).toEqual(gen.climateBias);
    expect(payload.gen.sizeX).toBe(gen.sizeX);
    expect(payload.gen.sizeY).toBe(gen.sizeY);
    expect(payload.gen.sizeZ).toBe(gen.sizeZ);

    const payloadChunks = payload.claimed.map(([cx, cz]) => `${cx},${cz}`).sort();
    const gridChunks = grid.ownedChunks().map(({ cx, cz }) => `${cx},${cz}`).sort();
    expect(payloadChunks).toEqual(gridChunks);

    const decoded = decodeVoxelGrid(payload);
    assertGridsMatchVoxelForVoxel(decoded, grid, gen);
  });

  it('carries no voxel edit data at all for a freshly generated, never-edited grid', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));

    const payload = encodeVoxelGrid(grid, gen);

    expect(payload.editColumns).toHaveLength(0);
    expect(payload.editFractures).toHaveLength(0);
  });
});

describe('encodeVoxelGrid / decodeVoxelGrid — edited grid', () => {
  it('round-trips a dig, an add with ore composition, and a fracture write exactly', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));

    // ── Dig ──
    const digX = 5, digZ = 5;
    const digY = computeVoxelColumnSurfaceY(grid, digX, digZ);
    expect(digY, 'expected solid ground at the dig column').toBeGreaterThanOrEqual(0);
    expect(grid.densityAt(digX, digY, digZ)).toBeGreaterThan(0);
    grid.clearVoxel(digX, digY, digZ);
    expect(grid.densityAt(digX, digY, digZ)).toBe(0);

    // ── Add, with an ore composition distinct from anything generation produced here ──
    const addX = 10, addZ = 10;
    const addSurfaceY = computeVoxelColumnSurfaceY(grid, addX, addZ);
    expect(addSurfaceY, 'expected solid ground at the add column').toBeGreaterThanOrEqual(0);
    const addY = Math.min(gen.sizeY - 1, addSurfaceY + 2); // above the natural surface — genuinely "added"
    const addedComposition = { rocks: [{ rockId: 'cruite', coefficient: 0.7 }, { rockId: 'sandite', coefficient: 0.3 }] };
    const addedOres = { dirtite: 0.42 };
    const addedCompId = grid.palette.intern(addedComposition);
    grid.fillVoxel(addX, addY, addZ, addedCompId, addedOres, 1.0);
    expect(grid.densityAt(addX, addY, addZ)).toBe(1.0);
    expect(grid.oresAt(addX, addY, addZ)).toEqual(addedOres);

    // ── Fracture ──
    const fractureX = 15, fractureZ = 15;
    const fractureY = computeVoxelColumnSurfaceY(grid, fractureX, fractureZ);
    expect(fractureY, 'expected solid ground at the fracture column').toBeGreaterThanOrEqual(0);
    grid.setFractureAt(fractureX, fractureY, fractureZ, 0.37);
    expect(grid.fractureAt(fractureX, fractureY, fractureZ)).toBeCloseTo(0.37, 10);

    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid, gen));

    // Every touched voxel matches exactly, not just "close enough".
    expect(decoded.densityAt(digX, digY, digZ)).toBe(0);

    expect(decoded.densityAt(addX, addY, addZ)).toBe(1.0);
    expect(decoded.compositionAt(addX, addY, addZ).rocks).toEqual(addedComposition.rocks);
    expect(decoded.oresAt(addX, addY, addZ)).toEqual(addedOres);

    expect(decoded.fractureAt(fractureX, fractureY, fractureZ)).toBeCloseTo(0.37, 10);

    // And the whole footprint reproduces the live grid voxel for voxel — the
    // edits above plus everything generation alone produced.
    assertGridsMatchVoxelForVoxel(decoded, grid, gen);
  });
});

describe('encodeVoxelGrid / decodeVoxelGrid — mixedRockHardness', () => {
  it('round-trips mixedRockHardness through gen and reproduces the interleaved strata exactly', () => {
    const baseParams = { seed: 99, climateBias: [0.6, 0.7] as [number, number], sizeX: 32, sizeY: 24, sizeZ: 32 };
    const mixedGen = makeGen({ ...baseParams, mixedRockHardness: true });
    const mixedGrid = generateTerrain(genToConfig(mixedGen));

    const payload = encodeVoxelGrid(mixedGrid, mixedGen);
    expect(payload.gen.mixedRockHardness).toBe(true);

    const decoded = decodeVoxelGrid(payload);

    // Sanity: the mixed-hardness profile genuinely differs from the normal
    // (non-mixed) profile somewhere along depth at this seed/column — proving
    // mixedRockHardness actually reached generation through the codec, rather
    // than the codec silently falling back to the default strata (which would
    // also happen to "round-trip" against a grid built the same wrong way).
    const normalGrid = generateTerrain(baseParams);
    let differsSomewhere = false;
    for (let y = 0; y < baseParams.sizeY; y++) {
      if (decoded.dominantRockAt(10, y, 10) !== normalGrid.dominantRockAt(10, y, 10)) {
        differsSomewhere = true;
        break;
      }
    }
    expect(differsSomewhere, 'expected mixedRockHardness to produce a different strata profile than the default at this seed/column').toBe(true);

    // And matches an independently-built mixed-hardness grid at the same config exactly.
    assertGridsMatchVoxelForVoxel(decoded, mixedGrid, mixedGen);
  });
});

describe('decodeVoxelGrid — generator version mismatch', () => {
  it('throws TerrainGenVersionMismatchError when the payload\'s generator version does not match the current build', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);

    const mismatchedVersion = gen.version + 1;
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, version: mismatchedVersion } };

    expect(() => decodeVoxelGrid(corrupted)).toThrow(TerrainGenVersionMismatchError);

    let caught: unknown;
    try {
      decodeVoxelGrid(corrupted);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TerrainGenVersionMismatchError);
    const err = caught as TerrainGenVersionMismatchError;
    expect(err.savedVersion).toBe(mismatchedVersion);
    expect(err.currentVersion).toBe(TERRAIN_GENERATOR_VERSION);
  });
});

describe('encodeVoxelGrid — payload size tracks edited volume, not chunk/voxel count', () => {
  it('editColumns has exactly one entry per distinct edited column, and one extra fracture write adds exactly one editFractures entry', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));

    const digColumns: Array<[number, number]> = [[3, 3], [9, 9], [21, 5]];
    for (const [x, z] of digColumns) {
      const y = computeVoxelColumnSurfaceY(grid, x, z);
      expect(y, `expected solid ground at (${x}, ${z})`).toBeGreaterThanOrEqual(0);
      grid.clearVoxel(x, y, z);
    }

    const payloadBeforeFracture = encodeVoxelGrid(grid, gen);
    expect(payloadBeforeFracture.editColumns).toHaveLength(digColumns.length);
    expect(payloadBeforeFracture.editFractures).toHaveLength(0);

    const fractureX = 25, fractureZ = 25;
    const fractureY = computeVoxelColumnSurfaceY(grid, fractureX, fractureZ);
    expect(fractureY, 'expected solid ground at the fracture column').toBeGreaterThanOrEqual(0);
    grid.setFractureAt(fractureX, fractureY, fractureZ, 0.3);

    const payloadAfterFracture = encodeVoxelGrid(grid, gen);
    expect(payloadAfterFracture.editFractures).toHaveLength(1);
    // The fracture write alone must not fabricate a new edited column entry.
    expect(payloadAfterFracture.editColumns).toHaveLength(digColumns.length);
  });
});

// #609: a corrupted/hand-edited save must not reach chunk-iteration loops
// unclamped. Under the pre-#1181 dense format this was `chunks[].r`; under
// #1181's generator-identity format the equivalent corruptible rect data is
// `claimed` — decodeVoxelGrid must clamp it to the chunk's real tile via
// VoxelGrid's own save-facing entry point rather than trusting it verbatim.
describe('decodeVoxelGrid — corrupted claimed rects are clamped, not trusted verbatim (#609)', () => {
  it('a corrupted claimed rect is clamped to the chunk\'s real tile', () => {
    const gen = makeGen({ sizeX: 16, sizeY: 4, sizeZ: 16 });
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    expect(payload.claimed).toEqual([[0, 0, 0, 0, 16, 16]]);

    // Bounded out-of-tile magnitude, not the issue's literal 1e12 — a
    // magnitude anywhere near that would make decodeVoxelGrid's pristine
    // column loop genuinely un-interruptible (no vitest timeout preempts a
    // running for-loop). Large enough to prove the corruption reached the
    // pristine path and that VoxelGrid's own state ends up clamped either
    // way, small enough to never risk hanging the suite.
    const corrupted: SerializedVoxels = {
      ...payload,
      claimed: [[0, 0, 0, 0, 40, 40]],
    };

    const decoded = decodeVoxelGrid(corrupted);

    expect(decoded.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: 16, maxZ: 16 });
  });
});
