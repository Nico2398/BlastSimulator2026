// The join between the playable mesh and the landscape, checked from BOTH
// sheets at once (#907). Every earlier seam pass shipped green because each
// mesher was only ever checked against its own input; nothing compared them.
//
// #1153 replaced the eager, single-resolution landscape with a per-chunk lazy
// ladder (LADDER_STEPS = [1, 2, 4, 8, 16]). This file now covers two distinct
// joins:
//
//   1. Claim boundary — playable mesh vs. landscape, pinned to level 0
//      (finest, step 1m) chunks so claim-boundary behaviour (ownership,
//      T-junctions, live vs. theoretical height) is verified independent of
//      the ladder. The fixture height field is deliberately curved at a
//      wavelength shorter than a single coarse step, so a flat chord across
//      it is measurably wrong — every earlier continuity fixture used a
//      constant or exactly-linear field, on which that error class could not
//      show up.
//
//   2. Ladder rung joins — two real buildChunkMesh outputs at adjacent (and
//      one non-adjacent) ladder steps, side by side, proving the chord makes
//      them meet exactly and a dropped chord would not.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid, CompositionPalette } from '../../../../src/core/world/VoxelGrid.js';
import { surfaceDensityAt } from '../../../../src/core/world/TerrainGen.js';
import { NODES_PER_CHUNK, type LandscapeChunk, type LandscapeChunkId } from '../../../../src/core/world/LandscapeMap.js';
import { TerrainMesh } from '../../../../src/renderer/TerrainMesh.js';
import { buildChunkMesh, uniformNeighbourSteps, type PlayableCut, type NeighbourSteps } from '../../../../src/renderer/terrain/LandscapeMesh.js';
import { playableCut } from '../../../../src/renderer/GameRendererTerrain.js';
import { measureSeam } from '../../../helpers/landscapeSeam.js';

const SITE = 32;

/** How far apart the two sheets' normals may be at a node they share, degrees.
 *  Float32 vertex attributes are only good to ~0.02 degrees, and a step this
 *  small is ~0.0005 of a lambert term — invisible. A crease is degrees. */
const NORMAL_AGREEMENT_DEG = 0.05;

/**
 * Ridged and curved at 3-6 m wavelengths — shorter than a 4m coarse step, so
 * no chord through it is exact and any node that takes one is measurably off.
 */
function heightField(x: number, z: number): number {
  return 11
    + 1.8 * Math.sin(x * 0.9)
    + 1.4 * Math.cos(z * 1.1)
    + 0.7 * Math.sin((x + z) * 1.7)
    + 0.06 * x - 0.04 * z;
}

/** A site generated from `heightField` exactly the way TerrainGen fills a real one. */
function buildGrid(): VoxelGrid {
  const grid = new VoxelGrid(SITE, 24, SITE);
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  for (let x = 0; x < SITE; x++) {
    for (let z = 0; z < SITE; z++) {
      const h = heightField(x, z);
      for (let y = 0; y <= Math.ceil(h + 1); y++) {
        const density = surfaceDensityAt(y, h);
        if (density > 0) grid.fillVoxel(x, y, z, compId, {}, density);
      }
    }
  }
  return grid;
}

/** One level-0 (step 1m) LandscapeChunk, sampled from `heightField`. */
function makeLevel0Chunk(id: LandscapeChunkId, originX: number, originZ: number, compId: number): LandscapeChunk {
  const n = NODES_PER_CHUNK;
  const heights = new Float32Array(n * n);
  const biomeIds = new Uint8Array(n * n);
  const surfCompIds = new Uint16Array(n * n).fill(compId);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) heights[row * n + col] = heightField(originX + col, originZ + row);
  }
  return { id, step: 1, originX, originZ, heights, biomeIds, surfCompIds };
}

/**
 * Four level-0 chunks tiling a ring around the 32m site with 16m margin on
 * every side (a single 32m-span step-1 chunk can't both cover the site AND
 * carry margin past its edge) — same ladder step throughout, so there is no
 * inter-chunk LOD seam to reason about, only the claim boundary.
 */
function buildLevel0ChunkRing(compId: number): LandscapeChunk[] {
  const offsets: Array<[number, number]> = [[-16, -16], [16, -16], [-16, 16], [16, 16]];
  return offsets.map(([ox, oz], i) =>
    makeLevel0Chunk({ level: 0, cx: i % 2, cz: Math.floor(i / 2) }, ox, oz, compId));
}

/** The production cut itself — never a copy of it: a second derivation of the
 *  same rule beside the one that ships is how every earlier pass at this seam
 *  shipped green (#907). */
function cutFor(grid: VoxelGrid, sampleColumn: (x: number, z: number) => { height: number }): PlayableCut {
  return playableCut(grid, (x, z) => sampleColumn(x, z).height);
}

function buildLandscapeMeshes(
  grid: VoxelGrid,
  palette: CompositionPalette,
  compId: number,
  sampleColumn: (x: number, z: number) => { height: number; biomeId: number; surfCompId: number },
): THREE.Mesh[] {
  const cut = cutFor(grid, sampleColumn);
  const meshes: THREE.Mesh[] = [];
  for (const chunk of buildLevel0ChunkRing(compId)) {
    const mesh = buildChunkMesh(chunk, uniformNeighbourSteps(1), palette, cut, sampleColumn);
    if (mesh) meshes.push(mesh);
  }
  return meshes;
}

function buildBoth(grid: VoxelGrid): { playable: TerrainMesh; landscapeMeshes: THREE.Mesh[] } {
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  const sampleColumn = (x: number, z: number) => ({ height: heightField(x, z), biomeId: 0, surfCompId: compId });
  const playable = new TerrainMesh(new THREE.Scene(), grid);
  playable.setEdgeHeightSampler((x, z) => sampleColumn(x, z).height);
  playable.buildAll();
  const landscapeMeshes = buildLandscapeMeshes(grid, grid.palette, compId, sampleColumn);
  return { playable, landscapeMeshes };
}

describe('Playable/landscape seam — one continuous ground (#907, pinned to level-0 chunks per #1153)', () => {
  it('every square metre along the boundary is covered by exactly one sheet', () => {
    const grid = buildGrid();
    const { playable, landscapeMeshes } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscapeMeshes, grid, 1, 1);
    expect(seam.doubleCovered, 'cells drawn by both sheets').toEqual([]);
    expect(seam.uncovered, 'cells drawn by neither sheet').toEqual([]);
  });

  it('both sheets place every shared ring node at the same height, to floating-point exactness', () => {
    const grid = buildGrid();
    const { playable, landscapeMeshes } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscapeMeshes, grid, 1, 1);
    expect(seam.sharedNodes).toBeGreaterThan(0);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
  });

  it('both sheets light every shared ring node the same way, so no crease traces the site', () => {
    // Positions matching is only half a join. Each sheet derives its own
    // normals — the playable mesh from the density field's gradient, the
    // landscape from its height field's slope — and where the two disagree at
    // the node they share, lighting breaks across the edge they share. That
    // reads as a hairline rectangle drawn on open ground around the whole site,
    // corner and all, with no step in the ground anywhere near it (#1077).
    const grid = buildGrid();
    const { playable, landscapeMeshes } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscapeMeshes, grid, 1, 1);
    expect(seam.sharedNodes).toBeGreaterThan(0);
    // NORMAL_AGREEMENT_DEG, not zero: both sheets store normals as float32, and
    // one ulp there is already ~0.02 degrees. What this rules out is a crease —
    // the disagreement was 7.5 degrees on average and 67 at its worst before
    // the two sheets shared one normal.
    expect(seam.worstNormalAngle, `worst at ${seam.worstNormalAt}`).toBeLessThan(NORMAL_AGREEMENT_DEG);
  });

  it('holds after the surface at the boundary drops, as a blast crater does', () => {
    const grid = buildGrid();
    // Carve a crater straddling the west edge of the site, deeper than
    // SKIRT_VISIBILITY_MARGIN_M so the boundary wall is genuinely load-bearing.
    for (let x = 0; x < 6; x++) {
      for (let z = 8; z < 16; z++) {
        for (let y = 4; y < 24; y++) grid.clearVoxel(x, y, z);
      }
    }
    const { playable, landscapeMeshes } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscapeMeshes, grid, 1, 1);
    expect(seam.doubleCovered).toEqual([]);
    expect(seam.uncovered).toEqual([]);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
    expect(seam.worstNormalAngle, `worst at ${seam.worstNormalAt}`).toBeLessThan(NORMAL_AGREEMENT_DEG);
  });

  it('holds on an irregular site whose bounding box is not its shape (#473 D8)', () => {
    const grid = buildGrid();
    grid.addChunk(2, 0); // an L: a chunk east of the site's north half only
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let x = 32; x < 48; x++) {
      for (let z = 0; z < 16; z++) {
        const h = heightField(x, z);
        for (let y = 0; y <= Math.ceil(h + 1); y++) {
          const density = surfaceDensityAt(y, h);
          if (density > 0) grid.fillVoxel(x, y, z, compId, {}, density);
        }
      }
    }
    const { playable, landscapeMeshes } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscapeMeshes, grid, 1, 1);
    expect(seam.doubleCovered).toEqual([]);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
  });
});

// ── Ladder rung joins (#1153) ───────────────────────────────────────────────
//
// Two real buildChunkMesh outputs, side by side at two different ladder
// steps, with neighbourSteps set to reflect each other — proving the chord
// makes the join exact for every adjacent rung pair the real ladder streams
// (1,2), (2,4), (4,8), (8,16), plus one non-adjacent pair (1,4) that the
// codebase does not mesh today but the mechanism must still handle correctly.

describe('buildChunkMesh — ladder rung joins meet exactly when neighbourSteps reflect the neighbour (#1153)', () => {
  const NO_CLAIM: PlayableCut = { rect: { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }, ownsColumn: () => false };

  function makeLadderChunk(id: LandscapeChunkId, originX: number, originZ: number, step: number, compId: number): LandscapeChunk {
    const n = NODES_PER_CHUNK;
    const heights = new Float32Array(n * n);
    const biomeIds = new Uint8Array(n * n);
    const surfCompIds = new Uint16Array(n * n).fill(compId);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) heights[row * n + col] = heightField(originX + col * step, originZ + row * step);
    }
    return { id, step, originX, originZ, heights, biomeIds, surfCompIds };
  }

  function sampleColumnFor(compId: number) {
    return (x: number, z: number) => ({ height: heightField(x, z), biomeId: 0, surfCompId: compId });
  }

  /**
   * Two chunks side by side along x, meeting at x = 0: A (finer, west,
   * spanning [-32*stepA, 0]) and B (coarser, east, spanning [0, 32*stepB]),
   * both anchored at the same originZ so their lattices share nodes at every
   * multiple of stepB along the join.
   */
  function buildJoin(stepA: number, stepB: number, neighboursA: NeighbourSteps, neighboursB: NeighbourSteps) {
    const palette = new CompositionPalette();
    const compId = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    const originZ = -16;
    const chunkA = makeLadderChunk({ level: 0, cx: 0, cz: 0 }, -32 * stepA, originZ, stepA, compId);
    const chunkB = makeLadderChunk({ level: 0, cx: 1, cz: 0 }, 0, originZ, stepB, compId);
    const sampleColumn = sampleColumnFor(compId);
    const meshA = buildChunkMesh(chunkA, neighboursA, palette, NO_CLAIM, sampleColumn);
    const meshB = buildChunkMesh(chunkB, neighboursB, palette, NO_CLAIM, sampleColumn);
    return { meshA, meshB };
  }

  const pairs: ReadonlyArray<readonly [number, number]> = [[1, 2], [2, 4], [4, 8], [8, 16], [1, 4]];

  for (const [stepA, stepB] of pairs) {
    it(`(${stepA}m finer, ${stepB}m coarser): no double coverage, no gap, and agreement at every shared node`, () => {
      const neighboursA: NeighbourSteps = { west: stepA, east: stepB, north: stepA, south: stepA };
      const neighboursB: NeighbourSteps = { west: stepA, east: stepB, north: stepB, south: stepB };
      const { meshA, meshB } = buildJoin(stepA, stepB, neighboursA, neighboursB);
      expect(meshA, `buildChunkMesh returned null for the ${stepA}m chunk`).not.toBeNull();
      expect(meshB, `buildChunkMesh returned null for the ${stepB}m chunk`).not.toBeNull();

      const commonZSpan = 3 * stepB;
      const grid = new VoxelGrid(4, 1, commonZSpan);
      const seam = measureSeam([meshA!], [meshB!], grid, stepA, stepB);

      expect(seam.doubleCovered, `double-covered at ${JSON.stringify(seam.doubleCovered)}`).toEqual([]);
      expect(seam.uncovered, `uncovered at ${JSON.stringify(seam.uncovered)}`).toEqual([]);
      expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
      expect(seam.worstNormalAngle, `worst at ${seam.worstNormalAt}`).toBeLessThan(NORMAL_AGREEMENT_DEG);
    });
  }

  it('negative control: with neighbourSteps left at uniformNeighbourSteps(ownStep) (no chord), the join disagrees clearly on a non-linear field', () => {
    // Neither chunk is told about the other's real step — each assumes a
    // same-resolution neighbour, so the finer side never chords toward the
    // coarser lattice. Proves the test above would catch a regression that
    // dropped the chord, rather than passing regardless of whether it runs.
    //
    // worstDisagreement can't be that proof: a "shared node" only exists at a
    // (x, z) BOTH meshes place an actual vertex at, and the only such
    // positions on this join are exact multiples of the coarser step — where
    // both meshes read the SAME raw field sample whether the chord runs or
    // not (chordHeight's own bracket collapses to that identical sample the
    // moment t = 0). The chord instead fixes the position of the FINE side's
    // extra, in-between vertices — nodes the coarse side never places one at,
    // so no "shared node" comparison ever sees them. What the missing chord
    // does leave visible at an actual shared node is the SLOPE either side
    // measures around it: with the chord, both sides difference across the
    // same (coarser) bracket and get the identical value (< 0.05 degrees
    // apart, the positive cases above); without it, the fine side measures
    // its own tight local curve while the coarse side averages across its
    // whole quad — a difference this ridged fixture makes large.
    const stepA = 1, stepB = 4;
    const { meshA, meshB } = buildJoin(stepA, stepB, uniformNeighbourSteps(stepA), uniformNeighbourSteps(stepB));
    expect(meshA).not.toBeNull();
    expect(meshB).not.toBeNull();

    const commonZSpan = 3 * stepB;
    const grid = new VoxelGrid(4, 1, commonZSpan);
    const seam = measureSeam([meshA!], [meshB!], grid, stepA, stepB);
    expect(seam.sharedNodes).toBeGreaterThan(0);
    expect(seam.worstNormalAngle, `worst at ${seam.worstNormalAt}`).toBeGreaterThan(10);
  });
});

// ── A step pair the real meshers never produce today (#1150) ───────────────
//
// The suite above only ever exercises the pairs the real ladder streams — so
// a helper hardcoded to one pair could still pass every test above it. This
// proves the parameterised helper works on a different rung (2 m / 8 m), on a
// synthetic fixture built directly from two flat lattice sheets rather than
// through the real meshers, so it stands on its own regardless of what the
// real meshers do.
//
// The grid's z-bound is deliberately set short of the sheets' own z=16 shared
// node, by 3 m — inside `Math.max(2, 8) / 2 = 4` but outside a hardcoded or
// `min`-derived band of 2. That node's inclusion in `sharedNodes` therefore
// depends on `band` being derived correctly: a wrong band (hardcoded 2, or
// `min` instead of `max`) drops it and the count reads 2, not 3.

/**
 * A flat lattice sheet at a constant height: every quad between adjacent
 * `xs`/`zs` values, as two triangles, non-indexed so every vertex counts.
 */
function buildFlatSheet(xs: readonly number[], zs: readonly number[], height: number): THREE.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i]!, x1 = xs[i + 1]!;
      const z0 = zs[j]!, z1 = zs[j + 1]!;
      const corners: Array<[number, number]> = [
        [x0, z0], [x1, z0], [x0, z1],
        [x1, z0], [x1, z1], [x0, z1],
      ];
      for (const [x, z] of corners) {
        positions.push(x, height, z);
        normals.push(0, 1, 0);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

describe('measureSeam generalizes to a step pair the codebase does not mesh today (2 m / 8 m, #1150)', () => {
  const FINE_STEP_SYNTHETIC = 2;
  const COARSE_STEP_SYNTHETIC = 8;
  const HEIGHT_OFFSET = 0.4;
  // Grid z-bound stops 3 m short of the sheets' z = 16 shared node — inside
  // the correctly-derived band (max(2, 8) / 2 = 4) but outside a hardcoded or
  // min-derived one (2 or 1), so that node's count depends on the derivation.
  const GRID_MAX_Z = 13;

  it('measures the known height gap and counts shared nodes at the lcm(2, 8) spacing', () => {
    // "Playable" side: 2 m lattice over x in [0, 4], meeting the "landscape"
    // side along x = 0.
    const xsFine = [0, 2, 4];
    const zsFine = [0, 2, 4, 6, 8, 10, 12, 14, 16];
    // "Landscape" side: 8 m lattice over x in [-8, 0].
    const xsCoarse = [-8, 0];
    const zsCoarse = [0, 8, 16];

    const fine = buildFlatSheet(xsFine, zsFine, 10.0);
    const coarse = buildFlatSheet(xsCoarse, zsCoarse, 10.0 + HEIGHT_OFFSET);
    // West edge (x = 0) is exactly the line the two sheets meet along, same
    // as the fine sheet's own extent. The z-bound is short of the sheets' own
    // z = 16, on purpose — see GRID_MAX_Z above.
    const grid = new VoxelGrid(4, 1, GRID_MAX_Z);

    const seam = measureSeam([fine], [coarse], grid, FINE_STEP_SYNTHETIC, COARSE_STEP_SYNTHETIC);

    // Both lattices place a node at x = 0 only where z is a multiple of
    // lcm(2, 8) = 8: z = 0, 8, 16 across a 0..16 span — 3 nodes, but the
    // z = 16 one only counts when the scan window reaches it, i.e. only when
    // band is derived as max(2, 8) / 2 = 4 rather than hardcoded or min'd.
    expect(seam.sharedNodes).toBe(3);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeCloseTo(HEIGHT_OFFSET, 6);
  });
});
