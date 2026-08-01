// BlastSimulator2026 — Terrain Mesh
// Converts a VoxelGrid to Three.js meshes using chunk-based marching cubes.
// One BufferGeometry+Mesh per 16^3 chunk (#458 T3.1/D10/A17) — a
// terrain:updated event re-marches only the chunks its region actually
// touches, not the whole grid. Full rebuild only happens on grid identity
// change (buildAll()).
//
// Voxels with density >= SURFACE_THRESHOLD are "solid".
// Re-meshing a single 16^3 chunk targets < 50ms.
// Vertex colors are set from the rock type's hex color field — kept
// alongside the new per-vertex rock/ore attributes for visual continuity
// until T4.1's TerrainMaterial replaces them with triplanar shading.

import * as THREE from 'three';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
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

export interface DirtyRegion {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

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

/** Per-corner samples used both for the surface threshold and the emitted vertex attributes. */
interface CornerSample {
  density: number;
  rockId: string;
  /** Highest-density ore id at this corner, or '' if none. */
  oreId: string;
  oreAmt: number;
}

function sampleCorner(grid: VoxelGrid, x: number, y: number, z: number): CornerSample {
  const density = grid.densityAt(x, y, z);
  const rockId = grid.dominantRockAt(x, y, z);
  const ores = grid.oresAt(x, y, z);
  let oreId = '';
  let oreAmt = 0;
  if (ores) {
    for (const [id, amt] of Object.entries(ores)) {
      if (amt > oreAmt) { oreId = id; oreAmt = amt; }
    }
  }
  return { density, rockId, oreId, oreAmt };
}

/** Appends one interpolated vertex's position, color, and rock/ore attributes to the output arrays. */
function emitVertex(
  p0: readonly [number, number, number], c0: CornerSample,
  p1: readonly [number, number, number], c1: CornerSample,
  outPos: number[], outColor: number[],
  outRockA: number[], outRockB: number[], outRockWeight: number[], outOre: number[],
): void {
  let t = 0.5;
  if (Math.abs(c1.density - c0.density) > 1e-6) {
    t = (SURFACE_THRESHOLD - c0.density) / (c1.density - c0.density);
  }
  t = Math.max(0, Math.min(1, t));

  const vx = p0[0] + t * (p1[0] - p0[0]);
  const vy = p0[1] + t * (p1[1] - p0[1]);
  const vz = p0[2] + t * (p1[2] - p0[2]);
  outPos.push(vx, vy, vz);

  // 3D-coherent procedural color, blended across the boundary by t.
  const rgb0 = sampleRockColor(c0.rockId, vx, vy, vz);
  const rgb1 = sampleRockColor(c1.rockId, vx, vy, vz);
  outColor.push(
    rgb0.r + t * (rgb1.r - rgb0.r),
    rgb0.g + t * (rgb1.g - rgb0.g),
    rgb0.b + t * (rgb1.b - rgb0.b),
  );

  // Air corners (rockId === '') inherit the other corner's rock (#458 A18).
  const rockIdA = c0.rockId || c1.rockId;
  const rockIdB = c1.rockId || c0.rockId;
  outRockA.push(Math.max(0, rockIndexOf(rockIdA)));
  outRockB.push(Math.max(0, rockIndexOf(rockIdB)));
  outRockWeight.push(t);

  const nearer = t < 0.5 ? c0 : c1;
  const oreIdx = nearer.oreId ? oreIndexOf(nearer.oreId) : -1;
  outOre.push(oreIdx, oreIdx >= 0 ? nearer.oreAmt : 0);
}

// ---------- Main class ----------

export class TerrainMesh {
  private readonly scene: THREE.Scene;
  private grid: VoxelGrid;
  private readonly material: THREE.MeshPhongMaterial;
  private surveyOverlay: SurveyConfidenceOverlay | null = null;

  /** Chunk-grid-index -> its Mesh, or null for a built-but-empty chunk (no triangles). */
  private readonly chunks = new Map<number, THREE.Mesh | null>();
  private ncx = 0;
  private ncy = 0;
  private ncz = 0;

  constructor(scene: THREE.Scene, grid: VoxelGrid) {
    this.scene = scene;
    this.grid = grid;

    // Vertex-colored material — no texture needed (still true until T4.1).
    this.material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 12,
      side: THREE.DoubleSide,
    });
    this.updateChunkGridDims();
  }

  /** Replace the underlying grid reference (e.g. after campaign start regenerates terrain). Caller must follow with buildAll(). */
  setGrid(grid: VoxelGrid): void {
    console.log(`[TerrainMesh] setGrid: old=${this.grid.id} new=${grid.id}`);
    this.grid = grid;
    this.updateChunkGridDims();
  }

  /** ID of the currently-bound VoxelGrid, for diagnostics. */
  get gridId(): number {
    return this.grid.id;
  }

  /** The shared interim material — reused by LandscapeMesh so both zones render with identical shading (#458 T3.2/D9). */
  get sharedMaterial(): THREE.MeshPhongMaterial {
    return this.material;
  }

  /** Union bounding box and total vertex count across every built chunk mesh, for diagnostics. Null if nothing is built. */
  getBounds(): {
    minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
    vertexCount: number;
  } | null {
    let box: THREE.Box3 | null = null;
    let vertexCount = 0;
    for (const mesh of this.chunks.values()) {
      if (!mesh) continue;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (!bb) continue;
      box = box ? box.union(bb) : bb.clone();
      vertexCount += mesh.geometry.attributes['position']!.count;
    }
    if (!box) return null;
    return {
      minX: Math.round(box.min.x * 100) / 100,
      maxX: Math.round(box.max.x * 100) / 100,
      minY: Math.round(box.min.y * 100) / 100,
      maxY: Math.round(box.max.y * 100) / 100,
      minZ: Math.round(box.min.z * 100) / 100,
      maxZ: Math.round(box.max.z * 100) / 100,
      vertexCount,
    };
  }

  /** Build every chunk from scratch. Call once after grid is populated, or when the grid identity changes. */
  buildAll(): void {
    this.disposeAllChunks();
    this.updateChunkGridDims();

    let totalVerts = 0;
    for (let cz = 0; cz < this.ncz; cz++) {
      for (let cy = 0; cy < this.ncy; cy++) {
        for (let cx = 0; cx < this.ncx; cx++) {
          totalVerts += this.rebuildChunk(cx, cy, cz);
        }
      }
    }
    console.log(`[TerrainMesh] buildAll: grid=${this.grid.id} chunks=${this.chunks.size} vertices=${totalVerts}`);
  }

  /**
   * Re-march exactly the chunks a dirty voxel region touches (#458 T3.1/A17).
   * Marching a cube at (x,y,z) reads corners up to (x+1,y+1,z+1), so a
   * changed voxel at v affects cubes from v-1 to v — hence the -1 on the min
   * side only.
   */
  remeshRegion(region: DirtyRegion): void {
    const cxMin = Math.max(0, Math.floor((region.minX - 1) / CHUNK_SIZE));
    const cxMax = Math.min(this.ncx - 1, Math.floor(region.maxX / CHUNK_SIZE));
    const cyMin = Math.max(0, Math.floor((region.minY - 1) / CHUNK_SIZE));
    const cyMax = Math.min(this.ncy - 1, Math.floor(region.maxY / CHUNK_SIZE));
    const czMin = Math.max(0, Math.floor((region.minZ - 1) / CHUNK_SIZE));
    const czMax = Math.min(this.ncz - 1, Math.floor(region.maxZ / CHUNK_SIZE));

    let remeshed = 0;
    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cx = cxMin; cx <= cxMax; cx++) {
          this.rebuildChunk(cx, cy, cz);
          remeshed++;
        }
      }
    }
    console.log(`[TerrainMesh] remeshRegion: grid=${this.grid.id} chunksRemeshed=${remeshed}`);
  }

  /** Remove all terrain meshes from the scene and release geometry. */
  dispose(): void {
    this.disposeAllChunks();
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

  /** The Mesh for one chunk, or null if it's empty/unbuilt — diagnostics and dirty-set tests. */
  getChunkMesh(cx: number, cy: number, cz: number): THREE.Mesh | null {
    return this.chunks.get(this.chunkKey(cx, cy, cz)) ?? null;
  }

  /** Chunk grid dimensions for the currently-bound grid — diagnostics and tests. */
  get chunkGridDims(): { ncx: number; ncy: number; ncz: number } {
    return { ncx: this.ncx, ncy: this.ncy, ncz: this.ncz };
  }

  // ---------- Internal ----------

  private updateChunkGridDims(): void {
    this.ncx = Math.ceil(this.grid.sizeX / CHUNK_SIZE);
    this.ncy = Math.ceil(this.grid.sizeY / CHUNK_SIZE);
    this.ncz = Math.ceil(this.grid.sizeZ / CHUNK_SIZE);
  }

  private chunkKey(cx: number, cy: number, cz: number): number {
    return cx + cy * this.ncx + cz * this.ncx * this.ncy;
  }

  private disposeAllChunks(): void {
    for (const mesh of this.chunks.values()) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
  }

  /** Dispose and re-march one chunk. Returns its vertex count (0 if empty — stored as null, no mesh added). */
  private rebuildChunk(cx: number, cy: number, cz: number): number {
    const key = this.chunkKey(cx, cy, cz);
    const old = this.chunks.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    this.chunks.delete(key);

    const positions: number[] = [];
    const colors: number[] = [];
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];

    clearColorSampleCache(); // bound the color-sample cache per chunk, as before

    const ox = cx * CHUNK_SIZE, oy = cy * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const xEnd = Math.min(ox + CHUNK_SIZE, this.grid.sizeX - 1);
    const yEnd = Math.min(oy + CHUNK_SIZE, this.grid.sizeY - 1);
    const zEnd = Math.min(oz + CHUNK_SIZE, this.grid.sizeZ - 1);

    for (let z = oz; z < zEnd; z++) {
      for (let y = oy; y < yEnd; y++) {
        for (let x = ox; x < xEnd; x++) {
          this.marchCube(x, y, z, positions, colors, rockA, rockB, rockWeight, ore);
        }
      }
    }

    if (positions.length === 0) {
      this.chunks.set(key, null);
      return 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('aRockA', new THREE.Float32BufferAttribute(rockA, 1));
    geometry.setAttribute('aRockB', new THREE.Float32BufferAttribute(rockB, 1));
    geometry.setAttribute('aRockWeight', new THREE.Float32BufferAttribute(rockWeight, 1));
    geometry.setAttribute('aOre', new THREE.Float32BufferAttribute(ore, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    this.scene.add(mesh);
    this.chunks.set(key, mesh);
    return positions.length / 3;
  }

  private marchCube(
    x: number, y: number, z: number,
    outPos: number[], outColor: number[],
    outRockA: number[], outRockB: number[], outRockWeight: number[], outOre: number[],
  ): void {
    const corners: CornerSample[] = new Array(8);
    for (let i = 0; i < 8; i++) {
      const [dx, dy, dz] = CORNER_OFFSETS[i]!;
      corners[i] = sampleCorner(this.grid, x + dx, y + dy, z + dz);
    }

    let cubeIndex = 0;
    for (let i = 0; i < 8; i++) {
      if (corners[i]!.density >= SURFACE_THRESHOLD) cubeIndex |= (1 << i);
    }
    if (cubeIndex === 0 || cubeIndex === 255) return; // all air or all solid

    const edgeMask = EDGE_TABLE[cubeIndex]!;
    if (!edgeMask) return;

    const edgeVerts: [number, number, number][] = new Array(12);
    const edgeColors: [number, number, number][] = new Array(12);
    const edgeRockA: number[] = new Array(12);
    const edgeRockB: number[] = new Array(12);
    const edgeRockWeight: number[] = new Array(12);
    const edgeOre: [number, number][] = new Array(12);

    for (let e = 0; e < 12; e++) {
      if (!(edgeMask & (1 << e))) continue;
      const [c0i, c1i] = EDGE_CORNERS[e]!;
      const [dx0, dy0, dz0] = CORNER_OFFSETS[c0i]!;
      const [dx1, dy1, dz1] = CORNER_OFFSETS[c1i]!;

      const tempPos: number[] = [];
      const tempCol: number[] = [];
      const tempRockA: number[] = [];
      const tempRockB: number[] = [];
      const tempRockW: number[] = [];
      const tempOre: number[] = [];
      emitVertex(
        [x + dx0, y + dy0, z + dz0], corners[c0i]!,
        [x + dx1, y + dy1, z + dz1], corners[c1i]!,
        tempPos, tempCol, tempRockA, tempRockB, tempRockW, tempOre,
      );
      edgeVerts[e] = [tempPos[0]!, tempPos[1]!, tempPos[2]!];
      edgeColors[e] = [tempCol[0]!, tempCol[1]!, tempCol[2]!];
      edgeRockA[e] = tempRockA[0]!;
      edgeRockB[e] = tempRockB[0]!;
      edgeRockWeight[e] = tempRockW[0]!;
      edgeOre[e] = [tempOre[0]!, tempOre[1]!];
    }

    const tris = TRI_TABLE[cubeIndex];
    if (!tris) return;

    for (let i = 0; i < tris.length; i += 3) {
      const e0 = tris[i]!, e1 = tris[i + 1]!, e2 = tris[i + 2]!;
      for (const e of [e0, e1, e2]) {
        outPos.push(...edgeVerts[e]!);
        outColor.push(...edgeColors[e]!);
        outRockA.push(edgeRockA[e]!);
        outRockB.push(edgeRockB[e]!);
        outRockWeight.push(edgeRockWeight[e]!);
        outOre.push(...edgeOre[e]!);
      }
    }
  }
}
