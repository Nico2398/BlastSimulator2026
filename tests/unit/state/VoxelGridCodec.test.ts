// BlastSimulator2026 — VoxelGridCodec unit tests (#1181)
//
// A save no longer embeds dense chunk data. It embeds the complete generator
// identity terrain was produced from (`SerializedTerrainGen` — seed,
// climateBias, base size, mixedRockHardness, TERRAIN_GENERATOR_VERSION) plus
// the edit record (#1180's `grid.edits`) of everything play changed since
// generation. `decodeVoxelGrid` regenerates pristine terrain from the
// generator identity, then replays the edit record on top — reproducing the
// live grid voxel for voxel without ever storing every voxel's full state.

import { describe, it, expect } from 'vitest';
import { generateTerrain, TERRAIN_GENERATOR_VERSION, MAX_TERRAIN_GEN_DIMENSION, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  encodeVoxelGrid, decodeVoxelGrid, TerrainGenVersionMismatchError,
  type SerializedTerrainGen, type SerializedVoxels,
} from '../../../src/core/state/VoxelGridCodec.js';
import type { EditSegment } from '../../../src/core/world/TerrainEdits.js';

/** A small, fast-to-generate generator identity, overridable per test. */
function makeGen(overrides: Partial<SerializedTerrainGen> = {}): SerializedTerrainGen {
  return {
    version: TERRAIN_GENERATOR_VERSION,
    seed: 42,
    climateBias: [0, 0],
    sizeX: 32,
    datum: 16,
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
    datum: gen.datum,
    sizeZ: gen.sizeZ,
    ...(gen.mixedRockHardness !== undefined ? { mixedRockHardness: gen.mixedRockHardness } : {}),
  };
}

/**
 * A generous, test-only vertical scan range for voxel-for-voxel comparisons
 * (#1190) — a generated grid is height-free now, so there is no declared
 * sizeY to read a footprint's height range off any more. Any range wide
 * enough to cover every fixture's own generated surface in this file works
 * equally well: correctness here is two grids agreeing at every sampled
 * (x, y, z), not matching a real bound.
 */
const TEST_HEIGHT_RANGE = 40;

/** Walks every voxel of `gen`'s x/z footprint (and a fixed test-only height range) and compares `a` against `b` — density, dominant rock, ores, fracture. Fails on the first mismatch, naming the voxel. */
function assertGridsMatchVoxelForVoxel(
  a: VoxelGrid, b: VoxelGrid,
  gen: Pick<SerializedTerrainGen, 'sizeX' | 'sizeZ'>,
  heightRange = TEST_HEIGHT_RANGE,
): void {
  for (let x = 0; x < gen.sizeX; x++) {
    for (let z = 0; z < gen.sizeZ; z++) {
      for (let y = 0; y < heightRange; y++) {
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
    expect(payload.gen.datum).toBe(gen.datum);
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
    expect(digY).not.toBeNull();
    expect(digY, 'expected solid ground at the dig column').toBeGreaterThanOrEqual(0);
    expect(grid.densityAt(digX, digY!, digZ)).toBeGreaterThan(0);
    grid.clearVoxel(digX, digY!, digZ);
    expect(grid.densityAt(digX, digY!, digZ)).toBe(0);

    // ── Add, with an ore composition distinct from anything generation produced here ──
    const addX = 10, addZ = 10;
    const addSurfaceY = computeVoxelColumnSurfaceY(grid, addX, addZ);
    expect(addSurfaceY).not.toBeNull();
    expect(addSurfaceY, 'expected solid ground at the add column').toBeGreaterThanOrEqual(0);
    const addY = Math.min(TEST_HEIGHT_RANGE - 1, addSurfaceY! + 2); // above the natural surface — genuinely "added"
    const addedComposition = { rocks: [{ rockId: 'cruite', coefficient: 0.7 }, { rockId: 'sandite', coefficient: 0.3 }] };
    const addedOres = { dirtite: 0.42 };
    const addedCompId = grid.palette.intern(addedComposition);
    grid.fillVoxel(addX, addY, addZ, addedCompId, addedOres, 1.0);
    expect(grid.densityAt(addX, addY, addZ)).toBe(1.0);
    expect(grid.oresAt(addX, addY, addZ)).toEqual(addedOres);

    // ── Fracture ──
    const fractureX = 15, fractureZ = 15;
    const fractureY = computeVoxelColumnSurfaceY(grid, fractureX, fractureZ);
    expect(fractureY).not.toBeNull();
    expect(fractureY, 'expected solid ground at the fracture column').toBeGreaterThanOrEqual(0);
    grid.setFractureAt(fractureX, fractureY!, fractureZ, 0.37);
    expect(grid.fractureAt(fractureX, fractureY!, fractureZ)).toBeCloseTo(0.37, 10);

    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid, gen));

    // Every touched voxel matches exactly, not just "close enough".
    expect(decoded.densityAt(digX, digY!, digZ)).toBe(0);

    expect(decoded.densityAt(addX, addY, addZ)).toBe(1.0);
    expect(decoded.compositionAt(addX, addY, addZ).rocks).toEqual(addedComposition.rocks);
    expect(decoded.oresAt(addX, addY, addZ)).toEqual(addedOres);

    expect(decoded.fractureAt(fractureX, fractureY!, fractureZ)).toBeCloseTo(0.37, 10);

    // And the whole footprint reproduces the live grid voxel for voxel — the
    // edits above plus everything generation alone produced.
    assertGridsMatchVoxelForVoxel(decoded, grid, gen);
  });
});

describe('encodeVoxelGrid / decodeVoxelGrid — mixedRockHardness', () => {
  it('round-trips mixedRockHardness through gen and reproduces the interleaved strata exactly', () => {
    const baseParams = { seed: 99, climateBias: [0.6, 0.7] as [number, number], sizeX: 32, datum: 24, sizeZ: 32 };
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
    for (let y = 0; y < TEST_HEIGHT_RANGE; y++) {
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

    // (21, 15), not (21, 5): #1189 removed the WorldGen clamp that used to
    // force every column's surface into [1, sizeY - 1]. At this seed/config
    // (sizeY=16, a 32x32 site — too small for the pit mask's 24 m margin to
    // ever fully saturate) raw relief legitimately pushes (21, 5)'s surface
    // to about y=-5.6, outside the grid's declared height band, so no solid
    // ground exists there to dig. (21, 15) stays in range at this seed.
    const digColumns: Array<[number, number]> = [[3, 3], [9, 9], [21, 15]];
    for (const [x, z] of digColumns) {
      const y = computeVoxelColumnSurfaceY(grid, x, z);
      expect(y).not.toBeNull();
      expect(y, `expected solid ground at (${x}, ${z})`).toBeGreaterThanOrEqual(0);
      grid.clearVoxel(x, y!, z);
    }

    const payloadBeforeFracture = encodeVoxelGrid(grid, gen);
    expect(payloadBeforeFracture.editColumns).toHaveLength(digColumns.length);
    expect(payloadBeforeFracture.editFractures).toHaveLength(0);

    const fractureX = 25, fractureZ = 25;
    const fractureY = computeVoxelColumnSurfaceY(grid, fractureX, fractureZ);
    expect(fractureY).not.toBeNull();
    expect(fractureY, 'expected solid ground at the fracture column').toBeGreaterThanOrEqual(0);
    grid.setFractureAt(fractureX, fractureY!, fractureZ, 0.3);

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
    const gen = makeGen({ sizeX: 16, datum: 4, sizeZ: 16 });
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

// #1181 review: an unvalidated, enormous `gen.datum`/`sizeX`/`sizeZ` either
// makes the yLo/yHi clamp below a no-op (turning `replayTerrainEdits`'s loop
// unbounded) or crashes `VoxelGrid`'s `allocateChunk` with a raw
// `RangeError: Invalid typed array length` before any clamp even runs.
// `requireValidGenDimension` rejects outright instead, with a clean `Error`.
describe('decodeVoxelGrid — requireValidGenDimension rejects a malformed gen.size* (#1181 review)', () => {
  it('rejects a datum far past MAX_TERRAIN_GEN_DIMENSION with a clean Error, not a RangeError from allocateChunk', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);

    // Safely over MAX_TERRAIN_GEN_DIMENSION (4096) — large enough to be
    // rejected, nowhere near large enough to risk actually allocating.
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: 1e9 } };

    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
    // Never a bare RangeError escaping from VoxelGrid's typed-array allocation.
    let caught: unknown;
    try {
      decodeVoxelGrid(corrupted);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RangeError);
  });

  it('rejects a sizeX far past MAX_TERRAIN_GEN_DIMENSION', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, sizeX: 1e9 } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.sizeX/);
  });

  it('rejects a sizeZ far past MAX_TERRAIN_GEN_DIMENSION', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, sizeZ: 1e9 } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.sizeZ/);
  });

  it('rejects a value exactly one past MAX_TERRAIN_GEN_DIMENSION', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = {
      ...payload,
      gen: { ...payload.gen, datum: MAX_TERRAIN_GEN_DIMENSION + 1 },
    };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });

  it('rejects a non-integer datum', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: 3.7 } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });

  it('rejects NaN datum', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: NaN } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });

  it('rejects Infinity datum', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: Infinity } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });

  it('rejects a zero datum', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: 0 } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });

  it('rejects a negative datum', () => {
    const gen = makeGen();
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = { ...payload, gen: { ...payload.gen, datum: -16 } };
    expect(() => decodeVoxelGrid(corrupted)).toThrow(/corrupt save: gen\.datum/);
  });
});

// #1181 review: `CompositionPalette.intern` dereferences `.rocks`
// unconditionally, so a malformed `'added'` segment's composition (or a
// malformed boundary's composition) must never reach it — `isValidComposition`
// / `requireValidBoundary` must turn that into a clean `Error` refusal instead
// of a raw `TypeError`.
describe('decodeVoxelGrid — isValidComposition / requireValidBoundary reject malformed edit data (#1181 review)', () => {
  const gen = makeGen({ sizeX: 16, datum: 8, sizeZ: 16 });

  function payloadWithSegment(segment: EditSegment): SerializedVoxels {
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    return { ...payload, editColumns: [{ x: 5, z: 5, segments: [segment] }] };
  }

  it('rejects an "added" segment with no composition field at all, with a clean Error not a TypeError', () => {
    const payload = payloadWithSegment({ yLo: 0, yHi: 0, kind: 'added' });

    expect(() => decodeVoxelGrid(payload)).toThrow(/corrupt save: added edit segment/);
    let caught: unknown;
    try {
      decodeVoxelGrid(payload);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
  });

  it('rejects an "added" segment whose composition.rocks is not an array', () => {
    const payload = payloadWithSegment({
      yLo: 0, yHi: 0, kind: 'added',
      composition: { rocks: 'not-an-array' },
    } as unknown as EditSegment);

    expect(() => decodeVoxelGrid(payload)).toThrow(/corrupt save: added edit segment/);
  });

  it('rejects a bottomBoundary with a non-finite density', () => {
    const payload = payloadWithSegment({
      yLo: 0, yHi: 0, kind: 'dug',
      bottomBoundary: { density: NaN, composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] } },
    });

    expect(() => decodeVoxelGrid(payload)).toThrow(/corrupt save: bottom boundary/);
  });

  it('rejects a topBoundary with a missing/malformed composition', () => {
    const payload = payloadWithSegment({
      yLo: 0, yHi: 0, kind: 'dug',
      topBoundary: { density: 1, composition: { rocks: undefined } },
    } as unknown as EditSegment);

    expect(() => decodeVoxelGrid(payload)).toThrow(/corrupt save: top boundary/);
  });
});

// #1181 review: an unclamped `yLo`/`yHi` from a tampered/corrupted save (e.g.
// `1e15`) would turn `replayTerrainEdits`'s per-voxel loop into an unbounded
// scan. `clampSavePosition`/`clampAxis` must clamp both into
// `[0, MAX_TERRAIN_GEN_DIMENSION - 1]` instead — a grid is height-free now
// (#1190), so `MAX_TERRAIN_GEN_DIMENSION - 1` (not a per-grid `sizeY - 1`) is
// the only ceiling left to clamp against. Proven here by asserting on the
// RESULT (the decode completes and the decoded grid's edited range sits
// inside real bounds), not by trusting that a bad value merely "didn't hang".
describe('decodeVoxelGrid — clampSavePosition clamps a corrupted yLo/yHi into [0, MAX_TERRAIN_GEN_DIMENSION - 1] (#1181 review)', () => {
  it('clamps a NaN yLo/yHi pair to the fallback row 0, rather than leaving them unbounded', () => {
    const gen = makeGen({ sizeX: 16, datum: 8, sizeZ: 16 });
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = {
      ...payload,
      editColumns: [{ x: 5, z: 5, segments: [{ yLo: NaN, yHi: NaN, kind: 'dug' }] }],
    };

    const decoded = decodeVoxelGrid(corrupted);

    // Clamped to row 0 only — not every row, not a crash.
    expect(decoded.densityAt(5, 0, 5)).toBe(0);
  });

  it('clamps a wildly out-of-range yHi (1e15) into MAX_TERRAIN_GEN_DIMENSION - 1, completing the decode instead of scanning to 1e15', () => {
    const gen = makeGen({ sizeX: 16, datum: 8, sizeZ: 16 });
    const grid = generateTerrain(genToConfig(gen));
    const payload = encodeVoxelGrid(grid, gen);
    const corrupted: SerializedVoxels = {
      ...payload,
      editColumns: [{ x: 6, z: 6, segments: [{ yLo: 0, yHi: 1e15, kind: 'dug' }] }],
    };

    const decoded = decodeVoxelGrid(corrupted);

    // The real column, over a generous test-only height range, is dug — the
    // segment's own dig genuinely applied, not just a no-op decode.
    for (let y = 0; y < TEST_HEIGHT_RANGE; y++) {
      expect(decoded.densityAt(6, y, 6), `expected row ${y} of column (6,6) to be dug (clamped)`).toBe(0);
    }
    // And separately: the clamp genuinely reached MAX_TERRAIN_GEN_DIMENSION - 1
    // itself (the new ceiling), not merely some row well short of it — this is
    // what tells the clamp apart from a yHi that silently stayed small.
    expect(
      decoded.densityAt(6, MAX_TERRAIN_GEN_DIMENSION - 1, 6),
      'expected the clamp ceiling itself to be dug',
    ).toBe(0);
  });
});
