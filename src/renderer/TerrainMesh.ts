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
import { CHUNK_SIZE as VOXEL_CHUNK_SIZE, chunkIndexOf, type VoxelGrid } from '../core/world/VoxelGrid.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
import { EDGE_TABLE, TRI_TABLE } from './MarchingCubesTables.js';
import { TerrainMaterial } from './terrain/TerrainMaterial.js';
import { SurveyConfidenceOverlay } from './SurveyConfidenceOverlay.js';

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

export interface DirtyRegion {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export type EdgeHeightSampler = (x: number, z: number) => number;

/** Virtual density for a column TerrainMesh does not own, using the
 *  landscape's theoretical height, so gradient-normal sampling near the
 *  site edge doesn't fall into "air" where the ground actually continues.
 *  Same half-voxel crossing convention as emitVertex/computeVoxelColumnSurfaceHeight. */
export function virtualEdgeDensity(surfaceHeight: number, y: number): number {
  return Math.max(0, Math.min(1, surfaceHeight + 0.5 - y));
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

/**
 * Density at one integer lattice corner, for gradient-normal sampling only.
 * A column the grid doesn't own reads as air (0) unless an edge height
 * sampler is installed, in which case it reads as the virtual density of
 * the landscape's theoretical/live ground there (#559) — this only feeds
 * densityGradientNormal's finite differences; sampleCorner/cubeIndex (which
 * decide geometry/topology) always use grid.densityAt directly and are
 * untouched by this.
 */
function cornerDensityForNormal(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): number {
  if (sampler && !grid.containsColumn(x, z)) {
    return virtualEdgeDensity(sampler(x, z), y);
  }
  return grid.densityAt(x, y, z);
}

/** Density with trilinear interpolation, so the gradient below is continuous. */
function densityAtSmooth(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  let acc = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    if (w > 0) acc += w * cornerDensityForNormal(grid, sampler, x0 + dx, y0 + dy, z0 + dz);
  }
  return acc;
}

/**
 * Surface normal from the density field, rather than from the triangles.
 *
 * computeVertexNormals() averages the faces meeting at a vertex, and marching
 * cubes lays those faces on a regular lattice with a fixed diagonal split. The
 * averaged normals inherit that diagonal, and it reads as fine hatching ruled
 * across the terrain at the triangle scale — at every zoom, and impossible to
 * remove in the fragment shader because it is already in the normals before
 * shading runs.
 *
 * An iso-surface's true normal is the negated gradient of the field it is an
 * iso-surface of, which owes nothing to how the triangles were cut.
 */
function densityGradientNormal(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): [number, number, number] {
  const e = 0.85;
  const gx = densityAtSmooth(grid, sampler, x + e, y, z) - densityAtSmooth(grid, sampler, x - e, y, z);
  const gy = densityAtSmooth(grid, sampler, x, y + e, z) - densityAtSmooth(grid, sampler, x, y - e, z);
  const gz = densityAtSmooth(grid, sampler, x, y, z + e) - densityAtSmooth(grid, sampler, x, y, z - e);
  const len = Math.hypot(gx, gy, gz);
  // A vertex in a locally uniform region has no gradient to speak of. Falling
  // back to "up" beats emitting a zero normal, which shades black.
  if (len < 1e-6) return [0, 1, 0];
  // Negated: the gradient points toward increasing density (into the rock),
  // and the outward normal is its opposite. An earlier revision returned the
  // un-negated gradient to match the mesh's then-inverted triangle winding;
  // marchCube now emits outside-facing triangles as front faces, so the
  // mathematically correct sign is also the one the renderer expects.
  return [-gx / len, -gy / len, -gz / len];
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
  /** Vertical chunk count. x/z chunk coordinates come from the grid's own claimed set, and are signed. */
  private ncy = 0;
  private edgeHeightSampler: EdgeHeightSampler | null = null;

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
      heightRange: [0, grid.sizeY],
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
    for (const { cx, cz } of this.grid.ownedChunks()) {
      for (let cy = 0; cy < this.ncy; cy++) {
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
    // A claim can arrive with the region, so the vertical chunk count and the
    // material's play rect both have to catch up before anything is marched.
    this.updateChunkGridDims();

    const cxMin = chunkIndexOf(region.minX - 1);
    const cxMax = chunkIndexOf(region.maxX);
    const cyMin = Math.max(0, Math.floor((region.minY - 1) / CHUNK_SIZE));
    const cyMax = Math.min(this.ncy - 1, Math.floor(region.maxY / CHUNK_SIZE));
    const czMin = chunkIndexOf(region.minZ - 1);
    const czMax = chunkIndexOf(region.maxZ);

    let remeshed = 0;
    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cx = cxMin; cx <= cxMax; cx++) {
          // Chunks outside the claimed set have no geometry of their own, but
          // an already-built neighbour may need its sealing wall re-marched,
          // which the owned-chunk pass below covers.
          if (!this.grid.hasChunk(cx, cz)) continue;
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
    return {
      ncx: Math.ceil(this.grid.sizeX / CHUNK_SIZE),
      ncy: this.ncy,
      ncz: Math.ceil(this.grid.sizeZ / CHUNK_SIZE),
    };
  }

  // ---------- Internal ----------

  private updateChunkGridDims(): void {
    this.ncy = Math.ceil(this.grid.sizeY / CHUNK_SIZE);
  }

  /** Packs a signed (cx, cy, cz) triple into one collision-free key. Range +/-1024 chunks per horizontal axis. */
  private chunkKey(cx: number, cy: number, cz: number): number {
    return ((cx + 1024) * 2048 + (cz + 1024)) * 1024 + cy;
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
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];

    // March one cell PAST the grid on every side, and one cell before it on the
    // low side, so the cubes straddling the boundary are emitted too.
    // `densityAt` reads out of bounds as air, so a straddling cube has solid
    // corners inside and empty corners outside and marches into a wall face —
    // which is what seals the playable volume. Stopping at sizeX-1 instead left
    // the mesh open along its four sides: an unclosed shell you could see
    // straight into wherever the terrain was cut back, which is exactly what a
    // blast at the edge of the site did.
    const rect = this.grid.chunkRect(cx, cz);
    if (!rect) {
      this.chunks.set(key, null);
      return 0;
    }
    // Extend one cube outward only where no owned chunk lies beyond that
    // side: an owned neighbour marches those cubes itself, and marching them
    // twice would emit the interior wall between two claimed chunks.
    const { hasWest, hasEast, hasNorth, hasSouth } = this.neighbourFlags(cx, cz);
    if (this.canSkipChunkMarch(cx, cy, cz, rect)) {
      this.chunks.set(key, null);
      return 0;
    }
    const oy = cy * CHUNK_SIZE;
    const xStart = hasWest ? rect.minX : rect.minX - 1;
    const zStart = hasNorth ? rect.minZ : rect.minZ - 1;
    const yStart = oy;
    const xEnd = rect.maxX;
    const zEnd = rect.maxZ;
    const yEnd = Math.min(oy + CHUNK_SIZE, this.grid.sizeY);

    for (let z = zStart; z < zEnd; z++) {
      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const floorY = this.boundarySkirtFloorY(x, z, rect, hasWest, hasEast, hasNorth, hasSouth);
          if (floorY !== null && y + 1 < floorY) continue;
          this.marchCube(x, y, z, positions, rockA, rockB, rockWeight, ore);
        }
      }
    }

    if (positions.length === 0) {
      this.chunks.set(key, null);
      return 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aRockA', new THREE.Float32BufferAttribute(rockA, 1));
    geometry.setAttribute('aRockB', new THREE.Float32BufferAttribute(rockB, 1));
    geometry.setAttribute('aRockWeight', new THREE.Float32BufferAttribute(rockWeight, 1));
    geometry.setAttribute('aOre', new THREE.Float32BufferAttribute(ore, 2));
    // Normals from the field, not the triangulation — see densityGradientNormal.
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const n = densityGradientNormal(this.grid, this.edgeHeightSampler, positions[i]!, positions[i + 1]!, positions[i + 2]!);
      normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2];
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.chunks.set(key, mesh);
    return positions.length / 3;
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
    const aboveRange = this.grid.chunkDensityRange(cx, cz, cy + 1);
    const aboveSafe = aboveRange === null || aboveRange.min >= SURFACE_THRESHOLD;
    if (!aboveSafe) return false;
    if (cy > 0) {
      const belowRange = this.grid.chunkDensityRange(cx, cz, cy - 1);
      const belowSafe = belowRange === null || belowRange.min >= SURFACE_THRESHOLD;
      if (!belowSafe) return false;
    }

    // A fully interior chunk never emits geometry.
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

    const slabTop = Math.min((cy + 1) * CHUNK_SIZE, this.grid.sizeY);
    return slabTop < deepestFloor;
  }

  private marchCube(
    x: number, y: number, z: number,
    outPos: number[],
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
      const tempRockA: number[] = [];
      const tempRockB: number[] = [];
      const tempRockW: number[] = [];
      const tempOre: number[] = [];
      emitVertex(
        [x + dx0, y + dy0, z + dz0], corners[c0i]!,
        [x + dx1, y + dy1, z + dz1], corners[c1i]!,
        tempPos, tempRockA, tempRockB, tempRockW, tempOre,
      );
      edgeVerts[e] = [tempPos[0]!, tempPos[1]!, tempPos[2]!];
      edgeRockA[e] = tempRockA[0]!;
      edgeRockB[e] = tempRockB[0]!;
      edgeRockWeight[e] = tempRockW[0]!;
      edgeOre[e] = [tempOre[0]!, tempOre[1]!];
    }

    const tris = TRI_TABLE[cubeIndex];
    if (!tris) return;

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
      const e0 = tris[i]!, e1 = tris[i + 1]!, e2 = tris[i + 2]!;
      for (const e of [e2, e1, e0]) {
        outPos.push(...edgeVerts[e]!);
        outRockA.push(edgeRockA[e]!);
        outRockB.push(edgeRockB[e]!);
        outRockWeight.push(edgeRockWeight[e]!);
        outOre.push(...edgeOre[e]!);
      }
    }
  }
}
