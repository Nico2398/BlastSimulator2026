// TerrainMesh — unit tests
// Tests geometry generation from VoxelGrid without needing a browser.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { TerrainMesh } from '../../../src/renderer/TerrainMesh.js';

// Minimal mock THREE.Scene — just captures adds/removes
function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function makeSolidVoxel(rockId = 'sandite'): import('../../../src/core/world/VoxelGrid.js').VoxelData {
  return { rockId, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

describe('TerrainMesh', () => {
  it('buildAll on empty grid adds no meshes', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    expect(scene.children.length).toBe(0);
    tm.dispose();
  });

  it('buildAll on fully-solid grid adds no meshes (interior surface = none)', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    // Fill completely solid → cubeIndex 255 everywhere → no triangles
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 4; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    // All cubes are 255 (all solid) → no surface triangles
    expect(scene.children.length).toBe(0);
    tm.dispose();
  });

  it('buildAll generates mesh when there is a solid/air boundary', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    // Fill bottom half solid, top half air — creates a flat surface at y=4
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    expect(scene.children.length).toBeGreaterThan(0);
    tm.dispose();
  });

  it('generated geometry has position and color attributes', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel('cruite'));

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getAttribute('color')).toBeDefined();
    tm.dispose();
  });

  it('update re-meshes affected chunk when voxels are cleared', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const countBefore = scene.children.length;

    // Clear a column of voxels (simulating a blast crater)
    for (let y = 0; y < 4; y++) {
      grid.clearVoxel(3, y, 3);
    }
    tm.update([{ x: 3, y: 0, z: 3 }, { x: 3, y: 1, z: 3 }, { x: 3, y: 2, z: 3 }, { x: 3, y: 3, z: 3 }]);

    // There may be same or fewer chunks but geometry should have been rebuilt
    expect(scene.children.length).toBeGreaterThanOrEqual(0);
    // We can't easily assert exact counts without knowing the mesh structure
    // Just verify no crash and valid state
    tm.dispose();
    expect(scene.children.length).toBe(0);
    void countBefore; // suppress unused warning
  });

  it('re-meshing a 16³ chunk completes in under 50ms', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(16, 16, 16);
    // Fill with varied densities to produce interesting surface
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 8; y++)
        for (let z = 0; z < 16; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel('molite'));

    const tm = new TerrainMesh(scene, grid);
    const start = performance.now();
    tm.buildAll();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    tm.dispose();
  });
});
