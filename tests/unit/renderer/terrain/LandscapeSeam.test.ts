// The join between the playable mesh and the landscape, checked from BOTH
// sheets at once (#907). Every earlier seam pass shipped green because each
// mesher was only ever checked against its own input; nothing compared them.
//
// The fixture height field is deliberately curved at a wavelength shorter than
// the landscape's 4 m coarse step. That is the second half of the blind spot:
// every previous continuity fixture used a constant or exactly-linear field, on
// which the flat-edge rule's 4 m chord is exact — so the one error class that
// opens a gap on real sloped terrain could not show up.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import { surfaceDensityAt } from '../../../../src/core/world/TerrainGen.js';
import type { LandscapeMap, LandscapeTile } from '../../../../src/core/world/LandscapeMap.js';
import type { LandscapeHandle } from '../../../../src/console/commands/world.js';
import { TerrainMesh } from '../../../../src/renderer/TerrainMesh.js';
import { LandscapeMesh, type PlayableCut } from '../../../../src/renderer/terrain/LandscapeMesh.js';
import { playableCut } from '../../../../src/renderer/GameRendererTerrain.js';
import { measureSeam } from '../../../helpers/landscapeSeam.js';

const COARSE_STEP = 4;
const FINE_STEP = 1;
const SITE = 32;

/** How far apart the two sheets' normals may be at a node they share, degrees.
 *  Float32 vertex attributes are only good to ~0.02 degrees, and a step this
 *  small is ~0.0005 of a lambert term — invisible. A crease is degrees. */
const NORMAL_AGREEMENT_DEG = 0.05;

/**
 * Ridged and curved at 3-6 m wavelengths — shorter than COARSE_STEP, so no 4 m
 * chord can reproduce it and any node that takes one is measurably off.
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

/** Landscape tiles sampled from the same field, on a lattice aligned to the site's centre — the real LandscapeMap layout. */
function buildHandle(compId: number): LandscapeHandle {
  const originX = SITE / 2 - 128 * COARSE_STEP / 2;
  const originZ = SITE / 2 - 128 * COARSE_STEP / 2;
  const n = 129;
  const heights = new Float32Array(n * n);
  const surfCompIds = new Uint16Array(n * n).fill(compId);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      heights[row * n + col] = heightField(originX + col * COARSE_STEP, originZ + row * COARSE_STEP);
    }
  }
  const tile: LandscapeTile = {
    tileX: 0, tileZ: 0, originX, originZ, heights,
    biomeIds: new Uint8Array(n * n), surfCompIds,
  };
  const map: LandscapeMap = {
    tiles: [tile], extentHalf: 256, tileSpan: 128 * COARSE_STEP, coarseStep: COARSE_STEP, samplesPerTile: n,
  };
  return {
    map,
    playableRect: { minX: 0, minZ: 0, maxX: SITE, maxZ: SITE },
    sampleColumn: (x, z) => ({ height: heightField(x, z), biomeId: 0, surfCompId: compId }),
    groundLevelY: 0,
    structureSet: { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] },
  };
}

/** The production cut itself — never a copy of it: a second derivation of the
 *  same rule beside the one that ships is how every earlier pass at this seam
 *  shipped green (#907). */
function cutFor(grid: VoxelGrid, handle: LandscapeHandle): PlayableCut {
  return playableCut(grid, (x, z) => handle.sampleColumn(x, z).height);
}

function buildBoth(grid: VoxelGrid): { playable: TerrainMesh; landscape: LandscapeMesh; handle: LandscapeHandle } {
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  const handle = buildHandle(compId);
  const playable = new TerrainMesh(new THREE.Scene(), grid);
  playable.setEdgeHeightSampler((x, z) => handle.sampleColumn(x, z).height);
  playable.buildAll();
  const landscape = new LandscapeMesh(new THREE.Scene(), new THREE.MeshBasicMaterial());
  landscape.build(handle, grid.palette, cutFor(grid, handle));
  return { playable, landscape, handle };
}

describe('Playable/landscape seam — one continuous ground (#907)', () => {
  it('the claim edge falls exactly on the landscape lattice, as every real level\'s does', () => {
    // LandscapeMap tiles the world from the playable rect's centre at
    // COARSE_STEP, so a rect whose span is a multiple of 2 * COARSE_STEP puts
    // its own edge on a lattice line. That is the arrangement in which no quad
    // straddles the boundary at all, and the one every level lands in.
    const originX = SITE / 2 - 128 * COARSE_STEP / 2;
    expect((0 - originX) % COARSE_STEP).toBe(0);
    expect((SITE - originX) % COARSE_STEP).toBe(0);
  });

  it('every square metre along the boundary is covered by exactly one sheet', () => {
    const grid = buildGrid();
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid, FINE_STEP, COARSE_STEP);
    expect(seam.doubleCovered, 'cells drawn by both sheets').toEqual([]);
    expect(seam.uncovered, 'cells drawn by neither sheet').toEqual([]);
  });

  it('both sheets place every shared ring node at the same height, to floating-point exactness', () => {
    const grid = buildGrid();
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid, FINE_STEP, COARSE_STEP);
    // The full perimeter ring of a 32 m site: 4 * 33 nodes.
    expect(seam.sharedNodes).toBe(132);
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
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid, FINE_STEP, COARSE_STEP);
    expect(seam.sharedNodes).toBe(132);
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
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid, FINE_STEP, COARSE_STEP);
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
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid, FINE_STEP, COARSE_STEP);
    expect(seam.doubleCovered).toEqual([]);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
  });

  it('the landscape\'s ring node is the sampled ground, not a 4 m chord through it', () => {
    // The assertion above is only meaningful if the chord is a different
    // number. On the flat and linear fixtures every earlier continuity test
    // used, it is not — which is why they all passed while the seam was open.
    const chordErrors: number[] = [];
    for (let z = 1; z < 4; z++) {
      const chord = heightField(0, 0) + (z / COARSE_STEP) * (heightField(0, COARSE_STEP) - heightField(0, 0));
      chordErrors.push(Math.abs(chord - heightField(0, z)));
    }
    expect(Math.max(...chordErrors)).toBeGreaterThan(0.5);
  });
});

// ── A step pair the real meshers never produce today (#1150) ───────────────
//
// The suite above only ever exercises the one pair the game actually meshes,
// FINE_STEP (1 m) against COARSE_STEP (4 m) — so a helper hardcoded to that
// pair could still pass every test above it. This proves the parameterised
// helper works on a different rung of the same LOD ladder (2 m / 8 m), on a
// synthetic fixture built directly from two flat lattice sheets rather than
// through TerrainMesh/LandscapeMesh, so it stands on its own regardless of
// what the real meshers do.

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
  const STEP_FINE = 2;
  const STEP_COARSE = 8;
  const HEIGHT_OFFSET = 0.4;
  const Z_MAX = 16;

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
    // Bounding box matches the fine sheet's own extent, so its west edge
    // (x = 0) is exactly the line the two sheets meet along.
    const grid = new VoxelGrid(4, 1, Z_MAX);

    const seam = measureSeam([fine], [coarse], grid, STEP_FINE, STEP_COARSE);

    // Both lattices place a node at x = 0 only where z is a multiple of
    // lcm(2, 8) = 8: z = 0, 8, 16 across a 0..16 span — 3 nodes.
    expect(seam.sharedNodes).toBe(3);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeCloseTo(HEIGHT_OFFSET, 6);
  });
});
