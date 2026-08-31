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
import {
  meshClaimsCell,
  haloSurfaceHeight,
  nodeTouchesMeshedCell,
} from '../../../../src/renderer/terrain/PlayableCoverage.js';
import { computeVoxelColumnSurfaceHeight } from '../../../../src/core/world/VoxelGrid.js';
import { measureSeam } from '../../../helpers/landscapeSeam.js';

const COARSE_STEP = 4;
const SITE = 32;

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

/** The production cut, assembled the way GameRendererTerrain.playableCut does. */
function cutFor(grid: VoxelGrid, handle: LandscapeHandle): PlayableCut {
  return {
    rect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
    ownsColumn: (x, z) => grid.containsColumn(x, z),
    boundaryHeightAt: (x, z) => {
      const live = computeVoxelColumnSurfaceHeight(grid, x, z);
      if (!Number.isNaN(live)) return live;
      if (!nodeTouchesMeshedCell(grid, x, z)) return NaN;
      return haloSurfaceHeight(grid, handle.sampleColumn(x, z).height);
    },
    meshClaimsColumn: (x, z) => meshClaimsCell(grid, x, z),
  };
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

    const seam = measureSeam(playable.meshes, landscape.meshes, grid);
    expect(seam.doubleCovered, 'cells drawn by both sheets').toEqual([]);
    expect(seam.uncovered, 'cells drawn by neither sheet').toEqual([]);
  });

  it('both sheets place every shared ring node at the same height, to floating-point exactness', () => {
    const grid = buildGrid();
    const { playable, landscape } = buildBoth(grid);

    const seam = measureSeam(playable.meshes, landscape.meshes, grid);
    // The full perimeter ring of a 32 m site: 4 * 33 nodes.
    expect(seam.sharedNodes).toBe(132);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
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

    const seam = measureSeam(playable.meshes, landscape.meshes, grid);
    expect(seam.doubleCovered).toEqual([]);
    expect(seam.uncovered).toEqual([]);
    expect(seam.worstDisagreement, `worst at ${seam.worstAt}`).toBeLessThan(1e-6);
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

    const seam = measureSeam(playable.meshes, landscape.meshes, grid);
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
