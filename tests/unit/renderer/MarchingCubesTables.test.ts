// MarchingCubesTables — regression tests
// Guards the Lorensen & Cline lookup tables against hand-edits. A single
// wrong EDGE_TABLE entry makes marchCube read an edge vertex that was never
// interpolated and crash with "edgeVerts[e] is not iterable" — but only when
// terrain carving reaches that corner configuration, which unit tests on
// small grids never did (#481 CI: level1 win scenarios, interaction mode).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EDGE_TABLE, TRI_TABLE } from '../../../src/renderer/MarchingCubesTables.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { TerrainMesh } from '../../../src/renderer/TerrainMesh.js';

describe('MarchingCubesTables', () => {
  it('has 256 entries in each table', () => {
    expect(EDGE_TABLE).toHaveLength(256);
    expect(TRI_TABLE).toHaveLength(256);
  });

  it('EDGE_TABLE is symmetric: complementary cube configurations cut the same edges', () => {
    for (let i = 0; i < 256; i++) {
      expect(EDGE_TABLE[i], `EDGE_TABLE[${i}] vs EDGE_TABLE[${255 - i}]`).toBe(EDGE_TABLE[255 - i]);
    }
  });

  it('every edge referenced by TRI_TABLE is present in EDGE_TABLE, and vice versa', () => {
    for (let i = 0; i < 256; i++) {
      const maskEdges = new Set<number>();
      for (let e = 0; e < 12; e++) {
        if (EDGE_TABLE[i]! & (1 << e)) maskEdges.add(e);
      }
      const triEdges = new Set(TRI_TABLE[i]!.filter((e) => e >= 0));
      expect([...triEdges].sort(), `cube index ${i} (0x${i.toString(16)})`).toEqual(
        [...maskEdges].sort(),
      );
    }
  });

  it('marchCube survives all 256 corner configurations without throwing', () => {
    // Corner i of the cube at (0,0,0) sits at CORNER_OFFSETS[i] — same order
    // as TerrainMesh's cubeIndex bits.
    const CORNER_OFFSETS: readonly [number, number, number][] = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ];
    for (let config = 0; config < 256; config++) {
      const grid = new VoxelGrid(2, 2, 2);
      for (let i = 0; i < 8; i++) {
        if (!(config & (1 << i))) continue;
        const [x, y, z] = CORNER_OFFSETS[i]!;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
      }
      const mesh = new TerrainMesh(new THREE.Scene(), grid);
      expect(() => mesh.buildAll(), `corner configuration 0x${config.toString(16)}`).not.toThrow();
      mesh.dispose();
    }
  });
});
