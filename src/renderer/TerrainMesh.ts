// BlastSimulator2026 — Terrain Mesh
// Converts a VoxelGrid to a Three.js mesh using chunk-based marching cubes.
//
// Voxels with density >= SURFACE_THRESHOLD are "solid".
// Each chunk is 16×16×16 voxels.
// Re-meshing a single 16³ chunk targets < 50ms.
// Vertex colors are set from the rock type's hex color field.

import * as THREE from 'three';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { EDGE_TABLE, TRI_TABLE } from './MarchingCubesTables.js';
import { sampleRockColor } from './ProceduralTexture.js';

// ---------- Constants ----------
// 16 voxels per chunk side — standard for MC chunk streaming
const CHUNK_SIZE = 16;

// Density ≥ this is considered solid material (0.5 = half-filled)
const SURFACE_THRESHOLD = 0.5;

// ---------- Edge vertex lookup: for each of 12 cube edges, which 2 corners ----------
const EDGE_CORNERS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Corner offsets in (dx, dy, dz) within a cube cell
const CORNER_OFFSETS: readonly [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

// ---------- Interpolation ----------
// Uses 3D-coherent procedural color at the interpolated vertex position.
function interpVertex(
  p0: [number, number, number], d0: number, rockId0: string,
  p1: [number, number, number], d1: number, rockId1: string,
  outPos: number[], outColor: number[],
): void {
  let t = 0.5;
  if (Math.abs(d1 - d0) > 1e-6) {
    t = (SURFACE_THRESHOLD - d0) / (d1 - d0);
  }
  t = Math.max(0, Math.min(1, t));

  const vx = p0[0] + t * (p1[0] - p0[0]);
  const vy = p0[1] + t * (p1[1] - p0[1]);
  const vz = p0[2] + t * (p1[2] - p0[2]);

  outPos.push(vx, vy, vz);

  // Sample procedural color at the vertex world position.
  // Blend rock types across boundary based on t for smooth transitions.
  const c0 = sampleRockColor(rockId0, vx, vy, vz);
  const c1 = sampleRockColor(rockId1, vx, vy, vz);
  outColor.push(
    c0.r + t * (c1.r - c0.r),
    c0.g + t * (c1.g - c0.g),
    c0.b + t * (c1.b - c0.b),
  );
}

// ---------- Main class ----------

/** Chunk key → Three.js Mesh */
type ChunkKey = string;

export class TerrainMesh {
  private readonly scene: THREE.Scene;
  private readonly grid: VoxelGrid;
  private readonly chunks = new Map<ChunkKey, THREE.Mesh>();
  private readonly material: THREE.MeshPhongMaterial;

  constructor(scene: THREE.Scene, grid: VoxelGrid) {
    this.scene = scene;
    this.grid = grid;

    // Vertex-colored material — no texture needed
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 12,
      side: THREE.FrontSide,
    });
  }

  /** Build all chunks from scratch. Call once after grid is populated. */
  buildAll(): void {
    const cx = Math.ceil(this.grid.sizeX / CHUNK_SIZE);
    const cy = Math.ceil(this.grid.sizeY / CHUNK_SIZE);
    const cz = Math.ceil(this.grid.sizeZ / CHUNK_SIZE);
    for (let z = 0; z < cz; z++) {
      for (let y = 0; y < cy; y++) {
        for (let x = 0; x < cx; x++) {
          this.buildChunk(x, y, z);
        }
      }
    }
  }

  /**
   * Re-mesh chunks containing the given dirty voxel positions.
   * Call after blast or any voxel mutation.
   */
  update(dirtyPositions: { x: number; y: number; z: number }[]): void {
    const dirty = new Set<ChunkKey>();
    for (const { x, y, z } of dirtyPositions) {
      dirty.add(this.chunkKey(
        Math.floor(x / CHUNK_SIZE),
        Math.floor(y / CHUNK_SIZE),
        Math.floor(z / CHUNK_SIZE),
      ));
    }
    for (const key of dirty) {
      const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
      this.buildChunk(cx, cy, cz);
    }
  }

  /** Remove all terrain meshes from the scene and release geometry. */
  dispose(): void {
    for (const mesh of this.chunks.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.material.dispose();
  }

  // ---------- Internal ----------

  private chunkKey(cx: number, cy: number, cz: number): ChunkKey {
    return `${cx},${cy},${cz}`;
  }

  private buildChunk(cx: number, cy: number, cz: number): void {
    const key = this.chunkKey(cx, cy, cz);

    // Remove existing mesh
    const existing = this.chunks.get(key);
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      this.chunks.delete(key);
    }

    // World-space origin of this chunk
    const ox = cx * CHUNK_SIZE;
    const oy = cy * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    const positions: number[] = [];
    const colors: number[] = [];

    // Iterate every cell within the chunk (and one voxel past for neighbour lookup)
    const xEnd = Math.min(ox + CHUNK_SIZE, this.grid.sizeX - 1);
    const yEnd = Math.min(oy + CHUNK_SIZE, this.grid.sizeY - 1);
    const zEnd = Math.min(oz + CHUNK_SIZE, this.grid.sizeZ - 1);

    for (let z = oz; z < zEnd; z++) {
      for (let y = oy; y < yEnd; y++) {
        for (let x = ox; x < xEnd; x++) {
          this.marchCube(x, y, z, positions, colors);
        }
      }
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(mesh);
    this.chunks.set(key, mesh);
  }

  private marchCube(
    x: number, y: number, z: number,
    outPos: number[], outColor: number[],
  ): void {
    // Sample density and rock at all 8 corners
    const densities = new Float32Array(8);
    const rockIds: string[] = new Array(8);

    for (let i = 0; i < 8; i++) {
      const [dx, dy, dz] = CORNER_OFFSETS[i]!;
      const voxel = this.grid.getVoxel(x + dx, y + dy, z + dz);
      densities[i] = voxel?.density ?? 0;
      rockIds[i] = voxel?.rockId ?? '';
    }

    // Compute cube index
    let cubeIndex = 0;
    for (let i = 0; i < 8; i++) {
      if (densities[i]! >= SURFACE_THRESHOLD) cubeIndex |= (1 << i);
    }

    if (cubeIndex === 0 || cubeIndex === 255) return; // All air or all solid

    const edgeMask = EDGE_TABLE[cubeIndex]!;
    if (!edgeMask) return;

    // Interpolate edge vertices (only the ones needed)
    const edgeVerts: [number, number, number][] = [];
    const edgeColors: [number, number, number][] = [];

    for (let e = 0; e < 12; e++) {
      if (!(edgeMask & (1 << e))) {
        edgeVerts.push([0, 0, 0]);
        edgeColors.push([0, 0, 0]);
        continue;
      }
      const [c0, c1] = EDGE_CORNERS[e]!;
      const [dx0, dy0, dz0] = CORNER_OFFSETS[c0]!;
      const [dx1, dy1, dz1] = CORNER_OFFSETS[c1]!;

      const tempPos: number[] = [];
      const tempCol: number[] = [];
      interpVertex(
        [x + dx0, y + dy0, z + dz0], densities[c0]!, rockIds[c0]!,
        [x + dx1, y + dy1, z + dz1], densities[c1]!, rockIds[c1]!,
        tempPos, tempCol,
      );
      edgeVerts.push([tempPos[0]!, tempPos[1]!, tempPos[2]!]);
      edgeColors.push([tempCol[0]!, tempCol[1]!, tempCol[2]!]);
    }

    // Emit triangles
    const tris = TRI_TABLE[cubeIndex];
    if (!tris) return;

    for (let i = 0; i < tris.length; i += 3) {
      const e0 = tris[i]!;
      const e1 = tris[i + 1]!;
      const e2 = tris[i + 2]!;

      const v0 = edgeVerts[e0]!;
      const v1 = edgeVerts[e1]!;
      const v2 = edgeVerts[e2]!;

      outPos.push(...v0, ...v1, ...v2);
      outColor.push(...edgeColors[e0]!, ...edgeColors[e1]!, ...edgeColors[e2]!);
    }
  }
}
