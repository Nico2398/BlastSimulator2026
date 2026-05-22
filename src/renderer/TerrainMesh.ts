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
import { sampleRockColor, clearColorSampleCache } from './ProceduralTexture.js';
import { SurveyConfidenceOverlay } from './SurveyConfidenceOverlay.js';

// Re-export survey overlay types/class so consumers can import from either location.
export { SurveyConfidenceOverlay, confidenceToColor } from './SurveyConfidenceOverlay.js';
export type { SurveyConfidencePoint, SurveyConfidenceOverlayOptions } from './SurveyConfidenceOverlay.js';

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

export class TerrainMesh {
  private readonly scene: THREE.Scene;
  private readonly grid: VoxelGrid;
  private mesh: THREE.Mesh | null = null;
  private readonly material: THREE.MeshPhongMaterial;
  private surveyOverlay: SurveyConfidenceOverlay | null = null;

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
    // Remove any existing mesh
    this.removeMesh();

    const positions: number[] = [];
    const colors: number[] = [];

    const cx = Math.ceil(this.grid.sizeX / CHUNK_SIZE);
    const cy = Math.ceil(this.grid.sizeY / CHUNK_SIZE);
    const cz = Math.ceil(this.grid.sizeZ / CHUNK_SIZE);

    for (let czIdx = 0; czIdx < cz; czIdx++) {
      for (let cyIdx = 0; cyIdx < cy; cyIdx++) {
        for (let cxIdx = 0; cxIdx < cx; cxIdx++) {
          this.marchChunk(cxIdx, cyIdx, czIdx, positions, colors);
        }
      }
    }

    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = true;
    this.scene.add(this.mesh);
  }

  /**
   * Re-mesh the terrain after voxel mutations.
   * Rebuilds the entire mesh from scratch (simple but correct).
   */
  update(_dirtyPositions: { x: number; y: number; z: number }[]): void {
    this.buildAll();
  }

  /** Remove all terrain meshes from the scene and release geometry. */
  dispose(): void {
    this.removeMesh();
    this.material.dispose();
    this.surveyOverlay?.dispose();
    this.surveyOverlay = null;
  }

  /**
   * Get or lazily create the survey confidence overlay for this terrain.
   *
   * Usage:
   * ```ts
   * const overlay = terrain.getSurveyOverlay();
   * overlay.show({ points: [...], opacity: 0.6 });
   * ```
   */
  getSurveyOverlay(): SurveyConfidenceOverlay {
    if (!this.surveyOverlay) {
      this.surveyOverlay = new SurveyConfidenceOverlay(this.scene);
    }
    return this.surveyOverlay;
  }

  // ---------- Internal ----------

  /** Remove the current terrain mesh from the scene and release its geometry. */
  private removeMesh(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }

  /** March all cubes within a single CHUNK_SIZE³ region, appending to the shared arrays. */
  private marchChunk(cx: number, cy: number, cz: number, outPos: number[], outColor: number[]): void {
    // Clear color cache before each chunk to keep cache size bounded
    clearColorSampleCache();

    const ox = cx * CHUNK_SIZE;
    const oy = cy * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    const xEnd = Math.min(ox + CHUNK_SIZE, this.grid.sizeX - 1);
    const yEnd = Math.min(oy + CHUNK_SIZE, this.grid.sizeY - 1);
    const zEnd = Math.min(oz + CHUNK_SIZE, this.grid.sizeZ - 1);

    for (let z = oz; z < zEnd; z++) {
      for (let y = oy; y < yEnd; y++) {
        for (let x = ox; x < xEnd; x++) {
          this.marchCube(x, y, z, outPos, outColor);
        }
      }
    }
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
