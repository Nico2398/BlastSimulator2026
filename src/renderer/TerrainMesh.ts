// BlastSimulator2026 — Terrain Mesh
// Converts a VoxelGrid to Three.js meshes using chunk-based marching cubes.
// One BufferGeometry+Mesh per 16^3 chunk (#458 T3.1/D10/A17) — a
// terrain:updated event re-marches only the chunks its region actually
// touches, not the whole grid. Full rebuild only happens on grid identity
// change (buildAll()).
//
// Voxels with density >= SURFACE_THRESHOLD are "solid".
// Re-meshing a single 16^3 chunk targets < 50ms.
// Color comes entirely from TerrainMaterial's shader, driven by the
// per-vertex aRockA/aRockB/aRockWeight/aOre attributes emitted below
// (#458 T4.1/D9/A19) — no CPU-side vertex color is computed.

import * as THREE from 'three';
import { CHUNK_SIZE as VOXEL_CHUNK_SIZE, chunkIndexOf, computeColumnRangeY, type VoxelGrid, getSmoothTerrainSurfaceY } from '../core/world/VoxelGrid.js';
import { meshedCellRect } from './terrain/PlayableCoverage.js';
import { ChunkRemeshBatch, type QueuedChunk } from './terrain/ChunkRemeshBatch.js';
import { ChunkFieldCache, CUBE_CORNER_OFFSETS, type CornerSample, type EdgeHeightSampler } from './terrain/TerrainField.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
import { EDGE_TABLE, TRI_TABLE } from './MarchingCubesTables.js';
import { TerrainMaterial } from './terrain/TerrainMaterial.js';
import { SurveyConfidenceOverlay } from './SurveyConfidenceOverlay.js';

// The density field moved to terrain/TerrainField.ts (#1603); its public samplers stay importable from here.
export { densityGradientNormal, virtualEdgeDensity, type EdgeHeightSampler } from './terrain/TerrainField.js';

// Re-export survey overlay types/class so consumers can import from either location.
export { SurveyConfidenceOverlay, confidenceToColor } from './SurveyConfidenceOverlay.js';
export type { SurveyConfidencePoint, SurveyConfidenceOverlayOptions } from './SurveyConfidenceOverlay.js';

// ---------- Constants ----------
// One mesh chunk spans one voxel-grid chunk on x/z (#473 D1), so a newly
// claimed chunk re-marches exactly one mesh.
const CHUNK_SIZE = VOXEL_CHUNK_SIZE;

// Density ≥ this is considered solid material (0.5 = half-filled)
const SURFACE_THRESHOLD = 0.5;

/** Metres of buffer below the neighbouring landscape's sampled ground height
 *  at which a boundary/skirt wall may stop (#560). Exported so tests can
 *  assert against the same constant the implementation uses. */
export const SKIRT_VISIBILITY_MARGIN_M = 2;

/** Chunk-key packing (#1188): `chunkKey` biases each signed coordinate by
 *  `CHUNK_KEY_OFFSET` before packing, and the `cx`/`cz` fields have a
 *  `CHUNK_KEY_BASE` stride between them. Shared by `chunkKey` and its decode
 *  site in `chunkGridDims` so the two never drift apart. ±65536 chunks per
 *  axis covers the grid's whole addressable height (`MAX_VOXEL_ABS_Y` is
 *  62 500 chunks), and three 17-bit fields stay inside a safe integer. */
const CHUNK_KEY_OFFSET = 65536;
const CHUNK_KEY_BASE = 131072;

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
const CORNER_OFFSETS = CUBE_CORNER_OFFSETS;

/**
 * Real ground altitude range `[minY, maxY]` across `grid`, for the terrain
 * material's altitude-based cover shading — falls back to `[0, 60]` when the
 * grid has no ground yet (#1188, replacing the old `[0, grid.sizeY]` band,
 * which stopped tracking real ground once the grid could span negative Y or
 * outgrow a fixed vertical bound).
 */
export function gridHeightRange(grid: VoxelGrid): [number, number] {
  const range = computeColumnRangeY(grid, grid.minX, grid.maxX - 1, grid.minZ, grid.maxZ - 1);
  if (!range) return [0, 60];
  return [range.minY, range.maxY];
}

/** Scratch reused by every marchCube call — one cube's corners and crossed-edge vertices (#1603). */
const MARCH_CORNERS: CornerSample[] = new Array<CornerSample>(8);
const EDGE_SLOT = new Int8Array(12);
const EDGE_POS: number[] = [];
const EDGE_ROCK_A: number[] = [];
const EDGE_ROCK_B: number[] = [];
const EDGE_ROCK_W: number[] = [];
const EDGE_ORE: number[] = [];

/** Appends one interpolated vertex's position and rock/ore attributes to the output arrays. */
function emitVertex(
  p0: readonly [number, number, number], c0: CornerSample,
  p1: readonly [number, number, number], c1: CornerSample,
  outPos: number[],
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
  private readonly material: TerrainMaterial;
  private surveyOverlay: SurveyConfidenceOverlay | null = null;

  /** Packed signed chunk coordinate -> its Mesh, or null for a built-but-empty chunk (no triangles). */
  private readonly chunks = new Map<number, THREE.Mesh | null>();
  private edgeHeightSampler: EdgeHeightSampler | null = null;
  /** A blast's chunks, marched across frames and swapped in together (#1603). */
  private readonly remeshBatch = new ChunkRemeshBatch<THREE.Mesh | null>(
    ({ cx, cy, cz }) => this.marchChunk(cx, cy, cz),
    ({ key }, mesh) => this.installChunk(key, mesh),
    mesh => mesh?.geometry.dispose(),
  );

  constructor(scene: THREE.Scene, grid: VoxelGrid, biomeId?: string) {
    this.scene = scene;
    this.grid = grid;

    // Playable rect matches WorldGen's own formula exactly (#458 A19.4) — no
    // need to plumb the landscape handle through just for this.
    this.material = new TerrainMaterial({
      playRect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
      // Which surface covers this level can grow at all, and the band of
      // heights its altitude preferences are measured against.
      ...(biomeId !== undefined ? { biomeId } : {}),
      heightRange: gridHeightRange(grid),
    });
    this.material.side = THREE.DoubleSide;
    // Render the shadow map from BACK faces. The classic acne fix for closed
    // surfaces: the map then stores the underside of the terrain, which sits a
    // full surface-thickness behind the lit top, so the top can never fail a
    // depth comparison against itself — no bias large enough to eat contact
    // shadows is needed. Cast silhouettes are unchanged (same outline from the
    // sun's point of view). Applies to the landscape and blast fragments too,
    // since the material is shared; both are closed-enough surfaces for the
    // same reasoning to hold.
    this.material.shadowSide = THREE.BackSide;
  }

  /** Replace the underlying grid reference (e.g. after campaign start regenerates terrain). Caller must follow with buildAll(). */
  setGrid(grid: VoxelGrid): void {
    console.log(`[TerrainMesh] setGrid: old=${this.grid.id} new=${grid.id}`);
    this.grid = grid;
    this.remeshBatch.clear(); // marched from the old grid
    this.material.setHeightRange(...gridHeightRange(grid));
  }

  /** ID of the currently-bound VoxelGrid, for diagnostics. */
  get gridId(): number {
    return this.grid.id;
  }

  /** Sets (or clears with null) the sampler used to extend the normal-only
   *  density field past the site's owned columns for edge-vertex normal
   *  calculation. Does not affect which triangles are emitted. */
  setEdgeHeightSampler(sampler: EdgeHeightSampler | null): void {
    this.edgeHeightSampler = sampler;
  }

  /** The currently installed edge height sampler, or null — diagnostics and tests. */
  get currentEdgeHeightSampler(): EdgeHeightSampler | null {
    return this.edgeHeightSampler;
  }

  /** The shared terrain material — reused by LandscapeMesh and FragmentMesh so every zone renders with identical shading (#458 T3.2/T4.1/D9). */
  get sharedMaterial(): TerrainMaterial {
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
      // rebuildChunk() replaces a chunk's geometry whole, so a box computed
      // once holds for that geometry's lifetime. computeBoundingBox()
      // rescans every vertex on every call, and this runs inside every
      // `__gameState` read a scenario harness makes — several per step, one
      // per tick inside a wait — at ~8 ms a call on a 96×96 site.
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
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

    let totalVerts = 0;
    for (const { cx, cz } of this.grid.ownedChunks()) {
      const rect = this.grid.chunkRect(cx, cz);
      if (!rect) continue;
      // A chunk's east/south edge cubes read one column into the neighbouring
      // chunk, so the seam between them is this chunk's geometry: size the
      // range over those read columns too, or a cliff or pit sitting right on
      // the seam is never marched. A surface-height scan only ever sees a
      // column's topmost solid-to-air crossing, so a cavity or a fill apart
      // from that top needs the edit record too — padded one row down, since
      // the cube below an edit reads into it — which, unlike resident slabs,
      // survives eviction. Slabs written with no generator attached have no
      // edit record behind them, so the resident set still counts (#1188).
      const readRect = { minX: rect.minX, maxX: rect.maxX + 1, minZ: rect.minZ, maxZ: rect.maxZ + 1 };
      const surfaceRange = this.chunkVerticalSlabRange(readRect);
      const editedRange = this.grid.editedYRange(readRect.minX, readRect.maxX - 1, readRect.minZ, readRect.maxZ - 1);
      const allocRange = this.grid.allocatedCyRange(cx, cz);
      if (!surfaceRange && !editedRange && !allocRange) continue;
      const cyMin = Math.min(
        surfaceRange ? surfaceRange.cyMin : Infinity,
        editedRange ? chunkIndexOf(editedRange.minY - 1) : Infinity,
        allocRange ? allocRange.min : Infinity,
      );
      const cyMax = Math.max(
        surfaceRange ? surfaceRange.cyMax : -Infinity,
        editedRange ? chunkIndexOf(editedRange.maxY) : -Infinity,
        allocRange ? allocRange.max : -Infinity,
      );
      for (let cy = cyMin; cy <= cyMax; cy++) {
        totalVerts += this.rebuildChunk(cx, cy, cz);
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
    // A blast's batch still in flight holds older geometry for some of these
    // chunks: land it first, so this edit is marched over the newest voxels
    // and never overwritten by the batch afterwards.
    this.remeshBatch.finish();
    const chunks = this.chunksInRegion(region);
    for (const { cx, cy, cz } of chunks) this.rebuildChunk(cx, cy, cz);
    console.log(`[TerrainMesh] remeshRegion: grid=${this.grid.id} chunksRemeshed=${chunks.length}`);
  }

  /**
   * Queue the chunks `region` touches to be re-marched across later frames and
   * swapped in together (ChunkRemeshBatch, #1603) — for a blast, whose dozen
   * chunks would otherwise all be marched inside the detonate frame. The old
   * meshes stay on screen until `stepPendingRemesh` lands the whole batch.
   */
  queueRegion(region: DirtyRegion): void {
    this.remeshBatch.queue(this.chunksInRegion(region));
  }

  /** Spend up to `budgetMs` on the queued batch; true when this call swapped it in. */
  stepPendingRemesh(budgetMs: number, now: () => number = () => performance.now()): boolean {
    return this.remeshBatch.step(budgetMs, now);
  }

  /** Finish and swap in the queued batch now; true when one was pending. */
  finishPendingRemesh(): boolean {
    return this.remeshBatch.finish();
  }

  /** Chunks queued by `queueRegion` and not swapped in yet. */
  get pendingRemeshCount(): number {
    return this.remeshBatch.pending;
  }

  /** Owned chunks a dirty region touches, with their mesh keys. */
  private chunksInRegion(region: DirtyRegion): QueuedChunk[] {
    const cxMin = chunkIndexOf(region.minX - 1);
    const cxMax = chunkIndexOf(region.maxX);
    const cyMin = chunkIndexOf(region.minY - 1);
    const cyMax = chunkIndexOf(region.maxY);
    const czMin = chunkIndexOf(region.minZ - 1);
    const czMax = chunkIndexOf(region.maxZ);

    const chunks: QueuedChunk[] = [];
    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cx = cxMin; cx <= cxMax; cx++) {
          // Chunks outside the claimed set have no geometry of their own, but
          // an already-built neighbour may need its sealing wall re-marched,
          // which the owned-chunk pass below covers.
          if (!this.grid.hasChunk(cx, cz)) continue;
          chunks.push({ key: this.chunkKey(cx, cy, cz), cx, cy, cz });
        }
      }
    }
    return chunks;
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
      // The smoothed (marching-cubes) surface height for the currently-bound
      // grid — read through `this.grid` at call time (not captured once) so
      // a later setGrid() is picked up without recreating the overlay. Reuses
      // VoxelGrid's clamp-then-sample helper (#1006 finding 4 — a leaf core
      // module, so this stays a core import rather than reaching sideways
      // into GameRendererTerrain's much larger runtime import graph).
      this.surveyOverlay = new SurveyConfidenceOverlay(this.scene, (x, z) => getSmoothTerrainSurfaceY(this.grid, x, z));
    }
    return this.surveyOverlay;
  }

  /** The Mesh for one chunk, or null if it's empty/unbuilt — diagnostics and dirty-set tests. */
  getChunkMesh(cx: number, cy: number, cz: number): THREE.Mesh | null {
    return this.chunks.get(this.chunkKey(cx, cy, cz)) ?? null;
  }

  /** Every built (non-empty) chunk mesh — raycast targets for terrain scene picking (P2). */
  get meshes(): THREE.Mesh[] {
    const built: THREE.Mesh[] = [];
    for (const mesh of this.chunks.values()) {
      if (mesh) built.push(mesh);
    }
    return built;
  }

  /**
   * Chunk grid dimensions for the currently-bound grid — diagnostics and
   * tests. `ncx`/`ncz` describe the bounding box; the claimed set inside it
   * may be any shape (#473).
   */
  get chunkGridDims(): { ncx: number; ncy: number; ncz: number } {
    let ncy = 0;
    if (this.chunks.size > 0) {
      let min = Infinity, max = -Infinity;
      for (const key of this.chunks.keys()) {
        const cy = (key % CHUNK_KEY_BASE) - CHUNK_KEY_OFFSET;
        if (cy < min) min = cy;
        if (cy > max) max = cy;
      }
      ncy = max - min + 1;
    }
    return {
      ncx: Math.ceil(this.grid.sizeX / CHUNK_SIZE),
      ncy,
      ncz: Math.ceil(this.grid.sizeZ / CHUNK_SIZE),
    };
  }

  // ---------- Internal ----------

  /** Packs a signed (cx, cy, cz) triple into one collision-free key, per `CHUNK_KEY_OFFSET`/`CHUNK_KEY_BASE` above. */
  private chunkKey(cx: number, cy: number, cz: number): number {
    return ((cx + CHUNK_KEY_OFFSET) * CHUNK_KEY_BASE + (cz + CHUNK_KEY_OFFSET)) * CHUNK_KEY_BASE + (cy + CHUNK_KEY_OFFSET);
  }

  /** Which horizontal neighbours of chunk (cx, cz) are owned — computed once per rebuild and shared by rebuildChunk/canSkipChunkMarch/boundarySkirtFloorY instead of each recomputing it (#560). */
  private neighbourFlags(cx: number, cz: number): { hasWest: boolean; hasEast: boolean; hasNorth: boolean; hasSouth: boolean } {
    return {
      hasWest: this.grid.hasChunk(cx - 1, cz),
      hasEast: this.grid.hasChunk(cx + 1, cz),
      hasNorth: this.grid.hasChunk(cx, cz - 1),
      hasSouth: this.grid.hasChunk(cx, cz + 1),
    };
  }

  /**
   * The vertical chunk-index range `[cyMin, cyMax]` covering `rect`'s real
   * ground extent, or null when `rect` has no ground at all (#1188,
   * replacing chunk loops that assumed a fixed `[0, ncy)` vertical band).
   *
   * Pads by exactly one voxel on the low side, not a whole chunk: a column's
   * surface height is its topmost solid voxel, and marching cubes reads a
   * cube's corners up to y+1, so the solid-to-air crossing at that surface is
   * captured by the cube at index `minY - 1` on the way in and `maxY` itself
   * on the way out (no pad needed there — `maxY` already IS the crossing
   * cube). Same halo `remeshRegion` already applies to a dirty region's min
   * edge. Padding a whole `CHUNK_SIZE` here (the bug this replaced) always
   * pulled `cyMin` one chunk lower than the real ground ever reaches.
   *
   * Public rather than private, following this file's existing convention
   * for internals exposed for diagnostics/tests (`getChunkMesh`,
   * `chunkGridDims`, `currentEdgeHeightSampler`) — used by `buildAll` below.
   */
  chunkVerticalSlabRange(rect: { minX: number; maxX: number; minZ: number; maxZ: number }): { cyMin: number; cyMax: number } | null {
    const range = computeColumnRangeY(this.grid, rect.minX, rect.maxX - 1, rect.minZ, rect.maxZ - 1);
    if (!range) return null;
    return {
      cyMin: chunkIndexOf(range.minY - 1),
      cyMax: chunkIndexOf(range.maxY),
    };
  }

  private disposeAllChunks(): void {
    this.remeshBatch.clear();
    for (const mesh of this.chunks.values()) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
  }

  /** Dispose and re-march one chunk. Returns its vertex count (0 if empty — stored as null, no mesh added). */
  private rebuildChunk(cx: number, cy: number, cz: number): number {
    const mesh = this.marchChunk(cx, cy, cz);
    this.installChunk(this.chunkKey(cx, cy, cz), mesh);
    return mesh ? mesh.geometry.getAttribute('position').count : 0;
  }

  /** Replace chunk `key`'s mesh with `mesh` (null: the chunk has no surface). */
  private installChunk(key: number, mesh: THREE.Mesh | null): void {
    const old = this.chunks.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    if (mesh) this.scene.add(mesh);
    this.chunks.set(key, mesh);
  }

  /** March one chunk off-screen: its mesh, or null when nothing in it crosses the surface. */
  private marchChunk(cx: number, cy: number, cz: number): THREE.Mesh | null {
    const positions: number[] = [];
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];

    // Which cells this chunk marches — including the west/north halo that seals
    // the playable volume — comes from meshedCellRect, the same function
    // LandscapeMesh's cut is a point test against (PlayableCoverage.ts). Every
    // earlier pass at this seam derived those bounds here and re-derived the
    // matching "already the playable mesh's ground" predicate elsewhere, and
    // the two drifted; there is one of them now, so they cannot (#907).
    const rect = this.grid.chunkRect(cx, cz);
    const meshed = meshedCellRect(this.grid, cx, cz);
    if (!rect || !meshed) return null;
    if (this.canSkipChunkMarch(cx, cy, cz, rect)) return null;
    const oy = cy * CHUNK_SIZE;
    const xStart = meshed.minX;
    const zStart = meshed.minZ;
    const yStart = oy;
    const xEnd = meshed.maxX;
    const zEnd = meshed.maxZ;
    const yEnd = oy + CHUNK_SIZE;

    // No per-cube skirt cutoff here any more (#907). #560 stopped the skirt at
    // a fixed margin below the neighbouring ground because the halo column read
    // as air, so "solid inside, air outside" marched a wall down the site's full
    // depth whether or not anything could see it. The halo now carries the
    // neighbouring ground's own density, so a cube below both surfaces has solid
    // corners on both sides and marches to nothing on its own — the skirt is
    // gone by construction rather than by a height rule. Keeping the cutoff would
    // now delete real geometry: the wall of a crater blasted at the site edge is
    // exactly a cube whose halo side is solid ground and whose site side is air,
    // and every metre of it more than SKIRT_VISIBILITY_MARGIN_M below the
    // surrounding ground would have been skipped, leaving a see-through pit. The
    // cutoff still guards whole-chunk skipping, where the same slab-is-below-both
    // -surfaces reasoning does hold (canSkipChunkMarch).
    const field = new ChunkFieldCache(this.grid, this.edgeHeightSampler, {
      minX: xStart, minY: yStart, minZ: zStart, maxX: xEnd, maxY: yEnd, maxZ: zEnd,
    });
    for (let z = zStart; z < zEnd; z++) {
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          this.marchCube(field, x, y, z, positions, rockA, rockB, rockWeight, ore);
        }
      }
    }

    if (positions.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aRockA', new THREE.Float32BufferAttribute(rockA, 1));
    geometry.setAttribute('aRockB', new THREE.Float32BufferAttribute(rockB, 1));
    geometry.setAttribute('aRockWeight', new THREE.Float32BufferAttribute(rockWeight, 1));
    geometry.setAttribute('aOre', new THREE.Float32BufferAttribute(ore, 2));
    // Normals from the field, not the triangulation — see densityGradientNormal.
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const n = field.normal(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2];
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Lowest world Y at which a wall/skirt cube may still be emitted for column
   * (x, z), or null when this column borders no unclaimed neighbour (ordinary
   * interior geometry) or no EdgeHeightSampler is installed (full-depth
   * fallback). A column bordering unclaimed land on more than one side (site
   * corner) returns the minimum of the applicable sides' floors (#560).
   */
  private boundarySkirtFloorY(
    x: number, z: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
    hasWest: boolean, hasEast: boolean, hasNorth: boolean, hasSouth: boolean,
  ): number | null {
    // A column borders unclaimed land on a side exactly when it's the halo
    // column the march reaches into on that side (same coordinates
    // rebuildChunk's xStart/zStart/xEnd/zEnd already use).
    const bordersWest = !hasWest && x === rect.minX - 1;
    const bordersEast = !hasEast && x === rect.maxX - 1;
    const bordersNorth = !hasNorth && z === rect.minZ - 1;
    const bordersSouth = !hasSouth && z === rect.maxZ - 1;
    if (!bordersWest && !bordersEast && !bordersNorth && !bordersSouth) return null;
    if (!this.edgeHeightSampler) return null;

    let floor: number | null = null;
    const consider = (sampleX: number, sampleZ: number): void => {
      const h = this.edgeHeightSampler!(sampleX, sampleZ);
      if (!Number.isFinite(h)) return;
      const f = Math.floor(h) - SKIRT_VISIBILITY_MARGIN_M;
      if (floor === null || f < floor) floor = f;
    };
    // West/north halo columns are already at the sampling coordinate; east/
    // south need the neighbour column one past this chunk's owned rect,
    // since the march's own loop bound stops at the last owned column.
    if (bordersWest) consider(x, z);
    if (bordersEast) consider(rect.maxX, z);
    if (bordersNorth) consider(x, z);
    if (bordersSouth) consider(x, rect.maxZ);

    return floor;
  }

  /**
   * True when chunk mesh (cx, cy, cz) is provably empty/solid-interior without
   * marching a single cube (#560), using VoxelGrid's per-chunk density summary.
   * False always falls through to the normal march — never a false positive.
   */
  private canSkipChunkMarch(
    cx: number, cy: number, cz: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  ): boolean {
    const { hasWest, hasEast, hasNorth, hasSouth } = this.neighbourFlags(cx, cz);
    const range = this.grid.chunkDensityRange(cx, cz, cy);
    if (!range) return false;
    if (range.max < SURFACE_THRESHOLD) return true; // uniformly air
    if (range.min < SURFACE_THRESHOLD) return false; // genuinely mixed — a surface crosses this slab

    // Uniformly solid. Unlike x/z, rebuildChunk's y-loop has no "-1" halo
    // start (yStart is always oy, never oy-1) — the only vertical read past
    // this chunk's own slab is its topmost cube's far corner, which lands
    // one row into slab cy+1 (see yEnd's dy=1 corner in rebuildChunk). If
    // that neighbouring slab isn't ALSO uniformly solid, the real surface
    // may sit exactly on this chunk's own top boundary, and nothing else
    // ever marches that cube — so it is never safe to skip on the strength
    // of this slab's own density range alone (#560, reviewer repro: a flat
    // surface landing exactly on a CHUNK_SIZE multiple). Checked
    // symmetrically below for completeness, though the chunk below's own
    // topmost-cube march (its own "above" check, targeting this slab) is
    // what actually owns that seam.
    const slabSafe = (neighbourCy: number): boolean => {
      const r = this.grid.chunkDensityRange(cx, cz, neighbourCy);
      return r === null || r.min >= SURFACE_THRESHOLD;
    };
    if (!slabSafe(cy + 1)) return false;
    if (cy > 0 && !slabSafe(cy - 1)) return false;

    // The same holds horizontally: this chunk's east and south edge cubes,
    // and its south-east corner cube, read one column into those neighbours
    // (at this band and, through the top row, the band above). A pit dug
    // right across the seam puts the wall there, and only this chunk marches
    // it — skipping on this slab alone left a see-through hole in the wall.
    // An unowned diagonal reads as open ground, so it forbids the skip too.
    const neighbourSolid = (ncx: number, ncz: number): boolean => {
      const here = this.grid.chunkDensityRange(ncx, ncz, cy);
      const above = this.grid.chunkDensityRange(ncx, ncz, cy + 1);
      return here !== null && above !== null && here.min >= SURFACE_THRESHOLD && above.min >= SURFACE_THRESHOLD;
    };
    if (hasEast && !neighbourSolid(cx + 1, cz)) return false;
    if (hasSouth && !neighbourSolid(cx, cz + 1)) return false;
    if (hasEast && hasSouth && !neighbourSolid(cx + 1, cz + 1)) return false;

    // A fully interior chunk whose read neighbours are solid too never emits geometry.
    if (hasWest && hasEast && hasNorth && hasSouth) return true;

    // Boundary chunk: only skippable if every bordering edge column proves a
    // skirt cutoff above this slab, and this slab sits entirely below it.
    if (!this.edgeHeightSampler) return false;

    let deepestFloor = Infinity;
    const consider = (x: number, z: number): boolean => {
      const floorY = this.boundarySkirtFloorY(x, z, rect, hasWest, hasEast, hasNorth, hasSouth);
      if (floorY === null) return false;
      if (floorY < deepestFloor) deepestFloor = floorY;
      return true;
    };

    // Loop ranges below reach one cell past [rect.minZ, rect.maxZ) / [rect.minX,
    // rect.maxX) on the LOW end only, to include the diagonal corner cube
    // (e.g. (rect.minX-1, rect.minZ-1)) that rebuildChunk's own march loop
    // does visit when both an x-side and a z-side are unclaimed (xStart/
    // zStart both shift to rect.minX-1/rect.minZ-1 in that case), but which
    // neither a west-only nor a north-only scan of [rect.minZ, rect.maxZ) /
    // [rect.minX, rect.maxX) alone would ever pass to boundarySkirtFloorY.
    // The high end never needs a matching +1: rebuildChunk's xEnd/zEnd stay
    // at rect.maxX/rect.maxZ regardless of hasEast/hasSouth (the east/south
    // halo is reached through the last owned cube's high corner, not a
    // shifted loop start), so rect.maxX-1/rect.maxZ-1 are already the last
    // values these ranges cover. boundarySkirtFloorY itself combines
    // multiple borders via min when called at a shared corner index, so the
    // handful of extra calls this adds where a corner was already covered by
    // the other side's scan are redundant, not incorrect.
    if (!hasWest) {
      for (let z = rect.minZ - 1; z < rect.maxZ; z++) {
        if (!consider(rect.minX - 1, z)) return false;
      }
    }
    if (!hasEast) {
      for (let z = rect.minZ - 1; z < rect.maxZ; z++) {
        if (!consider(rect.maxX - 1, z)) return false;
      }
    }
    if (!hasNorth) {
      for (let x = rect.minX - 1; x < rect.maxX; x++) {
        if (!consider(x, rect.minZ - 1)) return false;
      }
    }
    if (!hasSouth) {
      for (let x = rect.minX - 1; x < rect.maxX; x++) {
        if (!consider(x, rect.maxZ - 1)) return false;
      }
    }

    const slabTop = (cy + 1) * CHUNK_SIZE;
    return slabTop < deepestFloor;
  }

  private marchCube(
    field: ChunkFieldCache,
    x: number, y: number, z: number,
    outPos: number[],
    outRockA: number[], outRockB: number[], outRockWeight: number[], outOre: number[],
  ): void {
    // Density alone decides whether the cube crosses the surface; the full
    // corner samples (rock, ore) are only fetched once it does (#1603).
    const cubeIndex = field.cubeIndex(x, y, z, SURFACE_THRESHOLD);
    if (cubeIndex === 0 || cubeIndex === 255) return; // all air or all solid

    const edgeMask = EDGE_TABLE[cubeIndex]!;
    if (!edgeMask) return;
    const tris = TRI_TABLE[cubeIndex];
    if (!tris) return;

    const corners = MARCH_CORNERS;
    for (let i = 0; i < 8; i++) {
      const [dx, dy, dz] = CORNER_OFFSETS[i]!;
      corners[i] = field.corner(x + dx, y + dy, z + dz);
    }

    // Each crossed edge's vertex, emitted once into the scratch buffers; the
    // triangles below copy from its slot.
    EDGE_POS.length = 0; EDGE_ROCK_A.length = 0; EDGE_ROCK_B.length = 0; EDGE_ROCK_W.length = 0; EDGE_ORE.length = 0;
    let slots = 0;
    for (let e = 0; e < 12; e++) {
      if (!(edgeMask & (1 << e))) continue;
      const [c0i, c1i] = EDGE_CORNERS[e]!;
      const [dx0, dy0, dz0] = CORNER_OFFSETS[c0i]!;
      const [dx1, dy1, dz1] = CORNER_OFFSETS[c1i]!;
      emitVertex(
        [x + dx0, y + dy0, z + dz0], corners[c0i]!,
        [x + dx1, y + dy1, z + dz1], corners[c1i]!,
        EDGE_POS, EDGE_ROCK_A, EDGE_ROCK_B, EDGE_ROCK_W, EDGE_ORE,
      );
      EDGE_SLOT[e] = slots++;
    }

    // Emitted in REVERSED order relative to TRI_TABLE. This table's order
    // winds the surface clockwise when seen from outside the rock, which made
    // every front face point INTO the ground. Nothing looked wrong because the
    // material is double-sided — but everything that consults winding without
    // the fragment-stage flip silently broke: the depth prepass (FrontSide)
    // culled the terrain out of ambient occlusion and aerial haze entirely,
    // and the shadow normalBias pushed lookups INTO the rock instead of out of
    // it. Reversing here makes outside-facing mean front-facing, the same
    // convention the landscape mesh already uses.
    for (let i = 0; i < tris.length; i += 3) {
      for (let k = 2; k >= 0; k--) {
        const slot = EDGE_SLOT[tris[i + k]!]!;
        outPos.push(EDGE_POS[slot * 3]!, EDGE_POS[slot * 3 + 1]!, EDGE_POS[slot * 3 + 2]!);
        outRockA.push(EDGE_ROCK_A[slot]!);
        outRockB.push(EDGE_ROCK_B[slot]!);
        outRockWeight.push(EDGE_ROCK_W[slot]!);
        outOre.push(EDGE_ORE[slot * 2]!, EDGE_ORE[slot * 2 + 1]!);
      }
    }
  }
}
