import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import { TerrainMesh } from '../../../../src/renderer/TerrainMesh.js';
import {
  meshedCellRect,
  meshClaimsCell,
  nodeTouchesMeshedCell,
  haloSurfaceHeight,
} from '../../../../src/renderer/terrain/PlayableCoverage.js';

/** A single-chunk site, filled solid to `surfaceY` so the mesher has a surface to march. */
function solidGrid(sizeX = 16, sizeZ = 16, sizeY = 16, surfaceY = 6): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= surfaceY; y++) grid.fillVoxel(x, y, z, compId, {}, 1);
    }
  }
  return grid;
}

/**
 * An L: chunks (0,0) and (1,1) owned, (0,1) and (1,0) not — the same #473 shape
 * the VoxelGrid suite uses, and the one whose per-chunk halos sit inside the
 * grid's own bounding box.
 */
function lShapedGrid(): VoxelGrid {
  const grid = new VoxelGrid(16, 8, 16);
  grid.addChunk(1, 1);
  return grid;
}

describe('PlayableCoverage.meshedCellRect (#907)', () => {
  it('extends one cell west and north where no owned chunk lies beyond that side', () => {
    const grid = solidGrid();
    expect(meshedCellRect(grid, 0, 0)).toEqual({ minX: -1, minZ: -1, maxX: 16, maxZ: 16 });
  });

  it('does not extend into a side an owned neighbour marches itself', () => {
    const grid = solidGrid(32, 32);
    // Chunk (1,1) has owned neighbours west and north, so it starts at its own rect.
    expect(meshedCellRect(grid, 1, 1)).toEqual({ minX: 16, minZ: 16, maxX: 32, maxZ: 32 });
    // Chunk (0,0) has neither, so it takes both halos.
    expect(meshedCellRect(grid, 0, 0)).toEqual({ minX: -1, minZ: -1, maxX: 16, maxZ: 16 });
  });

  it('is null for a chunk the site does not own', () => {
    expect(meshedCellRect(solidGrid(), 5, 5)).toBeNull();
  });
});

describe('PlayableCoverage.meshClaimsCell (#907)', () => {
  const grid = solidGrid();

  it('is true for every owned cell', () => {
    expect(meshClaimsCell(grid, 0, 0)).toBe(true);
    expect(meshClaimsCell(grid, 15, 15)).toBe(true);
    expect(meshClaimsCell(grid, 8, 3)).toBe(true);
  });

  it('is true for the west and north halo cells the march reaches into', () => {
    expect(meshClaimsCell(grid, -1, 5)).toBe(true);
    expect(meshClaimsCell(grid, 5, -1)).toBe(true);
  });

  it('is true for the DIAGONAL corner cell, which a west-only and a north-only rule both miss (#907)', () => {
    // rebuildChunk shifts xStart AND zStart when both sides are unclaimed, so it
    // marches (-1, -1). The pre-#907 predicate answered false here, and the
    // landscape kept the cell as well: two sheets over the site's own corner.
    expect(meshClaimsCell(grid, -1, -1)).toBe(true);
  });

  it('is false two cells out, past even the halo', () => {
    expect(meshClaimsCell(grid, -2, 5)).toBe(false);
    expect(meshClaimsCell(grid, 5, -2)).toBe(false);
    expect(meshClaimsCell(grid, -2, -2)).toBe(false);
  });

  it('is false past the east and south edges — the last owned cell already reaches them', () => {
    expect(meshClaimsCell(grid, 16, 5)).toBe(false);
    expect(meshClaimsCell(grid, 5, 16)).toBe(false);
    expect(meshClaimsCell(grid, 16, 16)).toBe(false);
  });

  it('floors a non-integer sample onto its cell', () => {
    expect(meshClaimsCell(grid, -0.5, 5.5)).toBe(true);  // cell (-1, 5)
    expect(meshClaimsCell(grid, 15.99, 5)).toBe(true);   // cell (15, 5)
    expect(meshClaimsCell(grid, 16.01, 5)).toBe(false);  // cell (16, 5)
  });
});

describe('PlayableCoverage — the predicate IS the march footprint (#907)', () => {
  /**
   * The regression this file exists for. Every previous pass at the seam
   * derived the march bounds in TerrainMesh and re-derived "already the
   * playable mesh's ground" somewhere else, and they drifted. Assert the two
   * against each other directly: every cell the mesher put a triangle over is a
   * cell meshClaimsCell answers true for, and vice versa.
   */
  it('every cell the marched mesh emits geometry over is a cell meshClaimsCell claims, and every claimed cell is marched', () => {
    const grid = solidGrid();
    const mesh = new TerrainMesh(new THREE.Scene(), grid);
    mesh.setEdgeHeightSampler(() => 6.5); // neighbouring ground level with the site's own surface
    mesh.buildAll();

    const emitted = new Set<string>();
    for (const m of mesh.meshes) {
      const pos = m.geometry.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        // The cube a triangle came from is the cell its centroid falls in;
        // a triangle lying exactly in a boundary plane has no footprint at all.
        const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        const ax = pos.getX(i + 1) - pos.getX(i), az = pos.getZ(i + 1) - pos.getZ(i);
        const bx = pos.getX(i + 2) - pos.getX(i), bz = pos.getZ(i + 2) - pos.getZ(i);
        if (Math.abs(ax * bz - az * bx) < 1e-9) continue; // vertical face, zero ground footprint
        emitted.add(`${Math.floor(cx)},${Math.floor(cz)}`);
      }
    }
    expect(emitted.size).toBeGreaterThan(0);

    for (const key of emitted) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      expect(meshClaimsCell(grid, x, z), `emitted geometry over unclaimed cell ${key}`).toBe(true);
    }
    for (let x = -2; x <= 17; x++) {
      for (let z = -2; z <= 17; z++) {
        if (!meshClaimsCell(grid, x, z)) continue;
        expect(emitted.has(`${x},${z}`), `claimed cell ${x},${z} has no marched geometry`).toBe(true);
      }
    }
  });
});

describe('PlayableCoverage.nodeTouchesMeshedCell (#907)', () => {
  const grid = solidGrid();

  it('is true on the shared ring, where the landscape meets the playable mesh', () => {
    expect(nodeTouchesMeshedCell(grid, -1, 5)).toBe(true);  // west ring node
    expect(nodeTouchesMeshedCell(grid, 16, 5)).toBe(true);  // east ring node
    expect(nodeTouchesMeshedCell(grid, 5, -1)).toBe(true);
    expect(nodeTouchesMeshedCell(grid, 5, 16)).toBe(true);
    expect(nodeTouchesMeshedCell(grid, -1, -1)).toBe(true); // ring corner
    expect(nodeTouchesMeshedCell(grid, 16, 16)).toBe(true);
  });

  it('is false one node further out, where the landscape is on its own', () => {
    expect(nodeTouchesMeshedCell(grid, -2, 5)).toBe(false);
    expect(nodeTouchesMeshedCell(grid, 17, 5)).toBe(false);
    expect(nodeTouchesMeshedCell(grid, 5, -2)).toBe(false);
    expect(nodeTouchesMeshedCell(grid, 5, 17)).toBe(false);
  });
});

describe('PlayableCoverage.haloSurfaceHeight (#907)', () => {
  const grid = solidGrid(16, 16, 20);

  it('passes an ordinary height through untouched', () => {
    expect(haloSurfaceHeight(grid, 7.25)).toBeCloseTo(7.25, 12);
  });

  it('clamps to the same bound TerrainGen generates the site\'s own columns through', () => {
    // heightToVoxelYContinuous is Math.max(1, Math.min(sizeY - 1, h)). Clamping
    // to 0 instead would put the shared ring node a metre below the site's own
    // clamped edge column and kink the ground at the claim line.
    expect(haloSurfaceHeight(grid, -3)).toBe(1);
    expect(haloSurfaceHeight(grid, 0.5)).toBe(1);
    expect(haloSurfaceHeight(grid, 999)).toBe(19);
  });

  it('passes NaN through, so "no ground here" stays distinguishable from "ground at the floor"', () => {
    expect(Number.isNaN(haloSurfaceHeight(grid, NaN))).toBe(true);
  });
});

describe('PlayableCoverage — irregular sites (#473 D8)', () => {
  it('claims every cell either chunk owns', () => {
    const grid = lShapedGrid();
    expect(meshClaimsCell(grid, 5, 5)).toBe(true);
    expect(meshClaimsCell(grid, 20, 20)).toBe(true);
  });

  it('gives chunk (0,0) its own west/north halo', () => {
    const grid = lShapedGrid();
    expect(meshClaimsCell(grid, -1, 5)).toBe(true);
    expect(meshClaimsCell(grid, 5, -1)).toBe(true);
  });

  it('gives chunk (1,1) its own halo one cell outside its rect — inside the grid\'s overall bounding box', () => {
    const grid = lShapedGrid();
    expect(meshedCellRect(grid, 1, 1)).toEqual({ minX: 15, minZ: 15, maxX: 32, maxZ: 32 });
    expect(meshClaimsCell(grid, 15, 20)).toBe(true); // west halo of (1,1)
    expect(meshClaimsCell(grid, 20, 15)).toBe(true); // north halo of (1,1)
    expect(meshClaimsCell(grid, 15, 15)).toBe(true); // its diagonal corner (#907)
  });

  it('leaves the notch to the landscape', () => {
    const grid = lShapedGrid();
    expect(meshClaimsCell(grid, 16, 5)).toBe(false);
    expect(meshClaimsCell(grid, 5, 16)).toBe(false);
  });

  it('adds no halo past a chunk\'s own east/south edges — those are self-sealed', () => {
    const grid = lShapedGrid();
    expect(meshClaimsCell(grid, 32, 20)).toBe(false);
    expect(meshClaimsCell(grid, 20, 32)).toBe(false);
  });
});
