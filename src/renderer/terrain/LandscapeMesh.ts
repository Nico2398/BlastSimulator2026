// BlastSimulator2026 — Landscape mesher (#458 T3.2/D7/A16)
// Builds real ground geometry for LandscapeMap's tiles, replacing
// DistantScenery's ring of unrelated decorative primitives with continuous
// terrain that actually meets the playable voxel mesh at its edge.
//
// Two kinds of geometry, sharing the same material as the playable terrain:
//   - One indexed grid Mesh per LandscapeTile, at the map's stored coarse
//     resolution (4m by default).
//   - One "seam" Mesh: a fine (1m) band from FINE_MARGIN outside the
//     playable rect to OVERLAP inside it, sampled directly (the stored
//     tiles don't have 1m resolution) so silhouette density matches the
//     voxel mesh right at the junction, with the inside-the-rect portion
//     lowered by OVERLAP_DROP so it sits safely under the playable mesh —
//     no gap can open there regardless of voxelization rounding (#458 A16).
// The deep interior (more than OVERLAP inside the rect) is skipped
// entirely: that's the playable VoxelGrid's own marching-cubes job.

import * as THREE from 'three';
import type { LandscapeHandle } from '../../console/commands/world.js';
import type { LandscapeTile } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { getDominantRockId, type CompositionPalette } from '../../core/world/VoxelGrid.js';
import { rockIndexOf } from '../../core/world/RockCatalog.js';

/** Metres outside the playable rect within which the seam subdivides to FINE_STEP (#458 A16). */
const FINE_MARGIN = 24;
/** Metres inside the playable rect the seam mesh still covers. */
const OVERLAP = 2;
/** The overlap strip's vertices are lowered by this much so it sits under the playable mesh, never fighting it. */
const OVERLAP_DROP = 0.15;
const FINE_STEP = 1;

type SampleFn = (x: number, z: number) => { height: number; biomeId: number; surfCompId: number };

/**
 * Two triangles for one grid quad, alternating which diagonal splits it.
 *
 * Splitting every quad the same way gives the whole sheet a shared diagonal
 * crease direction; alternating breaks the run. It only matters for the
 * silhouette now — normals no longer come from the triangles at all (see
 * heightFieldNormal).
 */
function pushQuad(indices: number[], i0: number, i1: number, i2: number, i3: number, parity: number): void {
  if ((parity & 1) === 0) indices.push(i0, i2, i1, i1, i2, i3);
  else indices.push(i0, i2, i3, i0, i3, i1);
}

/**
 * Normal of a height field from its slope, rather than from the triangles.
 *
 * computeVertexNormals() averages the faces meeting at a vertex, and those
 * faces lie on a regular lattice with a chosen diagonal split. The averaged
 * normal therefore depends on which way each quad was cut, and that
 * dependence reads as fine ruled lines across open ground at every zoom —
 * exactly the artifact the alternating split above was meant to hide and only
 * turned from corduroy into a weave. Slope owes nothing to the triangulation.
 *
 * `dhdx`/`dhdz` are metres of rise per metre travelled; the surface normal of
 * y = h(x, z) is (-dh/dx, 1, -dh/dz) normalized.
 */
function heightFieldNormal(dhdx: number, dhdz: number): [number, number, number] {
  const len = Math.hypot(dhdx, 1, dhdz);
  return [-dhdx / len, 1 / len, -dhdz / len];
}

/** Key for the tile lookup used to read a neighbouring tile's samples. */
function tileKey(tileX: number, tileZ: number): string {
  return `${tileX},${tileZ}`;
}

/** Distance from (x, z) to the nearest edge of rect, measured inward — negative outside. */
function distanceInsideRect(rect: Rect, x: number, z: number): number {
  const dx = Math.min(x - rect.minX, rect.maxX - x);
  const dz = Math.min(z - rect.minZ, rect.maxZ - z);
  return Math.min(dx, dz);
}

/**
 * Where the playable mesh's surface actually sits for a column of this height.
 *
 * Identity, and that is the point. The playable grid used to fill voxels solid
 * up to a rounded surface, which put its iso-surface half a voxel below the
 * first air cell and left the landscape floating up to a metre above it; the
 * landscape had to quantize the same way to meet it. Generation now writes a
 * fractional density through the surface band (TerrainGen's surfaceDensityAt),
 * so marching cubes reproduces the continuous height exactly and both
 * representations read the same number with no correction at all (#458).
 */
export function voxelSurfaceHeight(continuousHeight: number): number {
  return continuousHeight;
}

/**
 * Seam vertex height.
 *
 * Both meshes now agree on the continuous height, so the seam simply follows
 * it. The strip that overlaps the playable rect is still dropped clear of the
 * mesh that owns that ground, so the two can never z-fight.
 */
export function seamHeightAt(continuousHeight: number, insideDepth: number): number {
  const y = voxelSurfaceHeight(continuousHeight);
  return insideDepth > 0 ? y - OVERLAP_DROP : y;
}

/**
 * Landscape samples carry one rock (no marching-cubes blend), so both shader
 * rock slots are the same index and the blend weight is 0 — no ore data is
 * tracked in LandscapeMap, so aOre is always "none" (#458 T4.1/A18).
 */
function rockIndexFor(palette: CompositionPalette, surfCompId: number): number {
  const comp = palette.get(surfCompId).comp;
  return Math.max(0, rockIndexOf(getDominantRockId(comp)));
}

/**
 * The ground the playable mesh owns, which the landscape must not overlap.
 *
 * `rect` is the site's live bounding box, and `ownsColumn` its actual claimed
 * shape (#473 D8) — the two differ once a site has grown into an L, and the
 * landscape has to keep covering the notch the bounding box squares off.
 * Both surfaces read the same height sampler, so they agree by construction
 * wherever they meet.
 */
export interface PlayableCut {
  rect: Rect;
  ownsColumn(x: number, z: number): boolean;
}

/** The pre-expansion behaviour: the site is exactly its rect. */
function rectCut(rect: Rect): PlayableCut {
  return { rect, ownsColumn: (x, z) => distanceInsideRect(rect, x, z) > 0 };
}

export class LandscapeMesh {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.Material;
  private readonly tileMeshes: THREE.Mesh[] = [];
  private seamMesh: THREE.Mesh | null = null;
  /** Tiles by grid index, so a vertex on a tile's edge can read its neighbour's samples for a slope. */
  private readonly tileIndex = new Map<string, LandscapeTile>();

  /** `material` is shared with TerrainMesh and FragmentMesh (D9's "one shared terrain material" — one shader, one draw-state everywhere). */
  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.scene = scene;
    this.material = material;
  }

  /** Total mesh count (tiles + seam, if any) — diagnostics and tests. */
  get meshCount(): number {
    return this.tileMeshes.length + (this.seamMesh ? 1 : 0);
  }

  /**
   * `cut` defaults to the handle's own generation-time rect, for callers with
   * no live site to cut against (tests, and any level that never expands).
   */
  build(handle: LandscapeHandle, palette: CompositionPalette, cut?: PlayableCut): void {
    this.dispose();

    const playable = cut ?? rectCut(handle.playableRect);

    for (const tile of handle.map.tiles) this.tileIndex.set(tileKey(tile.tileX, tile.tileZ), tile);

    for (const tile of handle.map.tiles) {
      const mesh = this.buildTileMesh(
        tile, handle.map.coarseStep, handle.map.samplesPerTile, palette, playable,
      );
      if (mesh) {
        this.scene.add(mesh);
        this.tileMeshes.push(mesh);
      }
    }

    this.seamMesh = this.buildSeamMesh(playable.rect, handle.sampleColumn, palette);
    if (this.seamMesh) this.scene.add(this.seamMesh);
  }

  dispose(): void {
    for (const mesh of this.tileMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.tileMeshes.length = 0;
    this.tileIndex.clear();
    if (this.seamMesh) {
      this.scene.remove(this.seamMesh);
      this.seamMesh.geometry.dispose();
      this.seamMesh = null;
    }
  }

  // ---------- Internal ----------

  /**
   * One sample's height, addressed by tile-local (row, col) and allowed to run
   * one node past either end.
   *
   * Neighbouring tiles share their edge samples — a tile's last column is the
   * next tile's first — so col n means the neighbour's col 1, and col -1 means
   * the previous tile's col n-2. Off the edge of the built map there is no
   * neighbour, and the index is clamped instead: a one-sided difference at the
   * very rim of the world, which no camera reaches.
   */
  private nodeHeight(tile: LandscapeTile, row: number, col: number, n: number): number {
    let tx = tile.tileX, tz = tile.tileZ, r = row, c = col;
    if (c < 0) { tx -= 1; c = n - 2; } else if (c > n - 1) { tx += 1; c = 1; }
    if (r < 0) { tz -= 1; r = n - 2; } else if (r > n - 1) { tz += 1; r = 1; }

    if (tx === tile.tileX && tz === tile.tileZ) return tile.heights[r * n + c]!;
    const neighbour = this.tileIndex.get(tileKey(tx, tz));
    if (neighbour) return neighbour.heights[r * n + c]!;

    const clampedRow = Math.min(n - 1, Math.max(0, row));
    const clampedCol = Math.min(n - 1, Math.max(0, col));
    return tile.heights[clampedRow * n + clampedCol]!;
  }

  /**
   * Indexed grid mesh from one tile's stored samples, smooth-shaded (#458 A16).
   *
   * Quads reaching into the playable rect are dropped. A tile spans 512 m
   * while a playable rect is 32–160 m, so every rect sits deep inside its
   * tiles — without this the coarse 4 m sheet blankets the whole pit at the
   * pre-dig surface height and hides everything the voxel mesh does beneath
   * it, craters included. The seam mesh already bridges from FINE_MARGIN
   * outside the rect to OVERLAP inside it, so cutting the tiles back to the
   * rect boundary opens no gap.
   */
  private buildTileMesh(
    tile: LandscapeTile, step: number, n: number, palette: CompositionPalette, playable: PlayableCut,
  ): THREE.Mesh | null {
    if (tile.heights.length === 0) return null;

    // Most tiles are nowhere near the rect — test the tile's own span once and
    // skip the per-quad work entirely for those.
    const tileMaxX = tile.originX + (n - 1) * step;
    const tileMaxZ = tile.originZ + (n - 1) * step;
    const touchesRect =
      tileMaxX > playable.rect.minX && tile.originX < playable.rect.maxX &&
      tileMaxZ > playable.rect.minZ && tile.originZ < playable.rect.maxZ;

    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const rockA = new Float32Array(n * n);
    const rockB = new Float32Array(n * n);
    const rockWeight = new Float32Array(n * n); // all zero: single-rock samples (#458 A18)
    const ore = new Float32Array(n * n * 2); // (id, amt) pairs; landscape never carries ore (#458 A18)
    for (let i = 0; i < n * n; i++) ore[i * 2] = -1; // id = -1 (none); amt stays 0
    for (let row = 0; row < n; row++) {
      const z = tile.originZ + row * step;
      for (let col = 0; col < n; col++) {
        const x = tile.originX + col * step;
        const idx = row * n + col;
        const y = tile.heights[idx]!;

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;

        // Central differences over the sample spacing, reaching into the
        // neighbouring tile at a tile edge so the slope — and therefore the
        // shading — stays continuous from one tile to the next.
        const dhdx = (this.nodeHeight(tile, row, col + 1, n) - this.nodeHeight(tile, row, col - 1, n)) / (2 * step);
        const dhdz = (this.nodeHeight(tile, row + 1, col, n) - this.nodeHeight(tile, row - 1, col, n)) / (2 * step);
        const normal = heightFieldNormal(dhdx, dhdz);
        normals[idx * 3] = normal[0];
        normals[idx * 3 + 1] = normal[1];
        normals[idx * 3 + 2] = normal[2];

        const rockIdx = rockIndexFor(palette, tile.surfCompIds[idx]!);
        rockA[idx] = rockIdx;
        rockB[idx] = rockIdx;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < n - 1; row++) {
      const z0 = tile.originZ + row * step, z1 = z0 + step;
      for (let col = 0; col < n - 1; col++) {
        if (touchesRect) {
          const x0 = tile.originX + col * step, x1 = x0 + step;
          // Any corner over claimed ground means this quad overhangs what the
          // voxel mesh owns — drop the whole quad rather than let it dip in.
          const reachesIntoSite =
            playable.ownsColumn(x0, z0) || playable.ownsColumn(x1, z0) ||
            playable.ownsColumn(x0, z1) || playable.ownsColumn(x1, z1);
          if (reachesIntoSite) continue;
        }
        const i0 = row * n + col;
        const i1 = i0 + 1;
        const i2 = i0 + n;
        const i3 = i2 + 1;
        pushQuad(indices, i0, i1, i2, i3, row + col);
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRockA', new THREE.BufferAttribute(rockA, 1));
    geometry.setAttribute('aRockB', new THREE.BufferAttribute(rockB, 1));
    geometry.setAttribute('aRockWeight', new THREE.BufferAttribute(rockWeight, 1));
    geometry.setAttribute('aOre', new THREE.BufferAttribute(ore, 2));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Fine (1m) band from FINE_MARGIN outside the playable rect to OVERLAP
   * inside it, sampled directly since the stored tiles don't have this
   * resolution. Quads whose every corner sits more than OVERLAP inside the
   * rect are skipped — the playable mesh owns that ground.
   */
  private buildSeamMesh(rect: Rect, sampleColumn: SampleFn, palette: CompositionPalette): THREE.Mesh | null {
    const outerMinX = rect.minX - FINE_MARGIN;
    const outerMinZ = rect.minZ - FINE_MARGIN;
    const cols = Math.round((rect.maxX + FINE_MARGIN - outerMinX) / FINE_STEP) + 1;
    const rows = Math.round((rect.maxZ + FINE_MARGIN - outerMinZ) / FINE_STEP) + 1;

    const positions: number[] = [];
    const normals: number[] = [];
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];
    const indices: number[] = [];
    const vertexIndex = new Map<number, number>();

    const worldX = (col: number) => outerMinX + col * FINE_STEP;
    const worldZ = (row: number) => outerMinZ + row * FINE_STEP;

    // Slopes need the neighbouring nodes' heights, and every node is a
    // neighbour of four others — sampling each one once and reusing it keeps
    // this to barely more than one sample per vertex.
    const heightCache = new Map<number, number>();
    const heightAtNode = (row: number, col: number): number => {
      const key = (row + 1) * (cols + 2) + (col + 1);
      const cached = heightCache.get(key);
      if (cached !== undefined) return cached;
      const h = sampleColumn(worldX(col), worldZ(row)).height;
      heightCache.set(key, h);
      return h;
    };

    const emitVertex = (row: number, col: number): number => {
      const key = row * cols + col;
      const existing = vertexIndex.get(key);
      if (existing !== undefined) return existing;

      const x = worldX(col), z = worldZ(row);
      const sample = sampleColumn(x, z);
      heightCache.set((row + 1) * (cols + 2) + (col + 1), sample.height);
      const insideDepth = distanceInsideRect(rect, x, z);
      const y = seamHeightAt(sample.height, insideDepth);

      // From the sampled height field, not from the dropped seam height: the
      // OVERLAP_DROP step is a depth-fighting trick, not a slope, and shading
      // it as one would ring the site with a bright line.
      const dhdx = (heightAtNode(row, col + 1) - heightAtNode(row, col - 1)) / (2 * FINE_STEP);
      const dhdz = (heightAtNode(row + 1, col) - heightAtNode(row - 1, col)) / (2 * FINE_STEP);
      const normal = heightFieldNormal(dhdx, dhdz);

      const idx = positions.length / 3;
      positions.push(x, y, z);
      normals.push(normal[0], normal[1], normal[2]);
      // Single-rock sample: both shader rock slots are the same index, blend
      // weight 0, no ore data tracked by LandscapeMap (#458 A18).
      const rockIdx = rockIndexFor(palette, sample.surfCompId);
      rockA.push(rockIdx);
      rockB.push(rockIdx);
      rockWeight.push(0);
      ore.push(-1, 0);
      vertexIndex.set(key, idx);
      return idx;
    };

    for (let row = 0; row < rows - 1; row++) {
      const z0 = worldZ(row), z1 = worldZ(row + 1);
      for (let col = 0; col < cols - 1; col++) {
        const x0 = worldX(col), x1 = worldX(col + 1);
        const allDeepInside =
          distanceInsideRect(rect, x0, z0) > OVERLAP &&
          distanceInsideRect(rect, x1, z0) > OVERLAP &&
          distanceInsideRect(rect, x0, z1) > OVERLAP &&
          distanceInsideRect(rect, x1, z1) > OVERLAP;
        if (allDeepInside) continue; // playable mesh already covers this ground

        const i0 = emitVertex(row, col);
        const i1 = emitVertex(row, col + 1);
        const i2 = emitVertex(row + 1, col);
        const i3 = emitVertex(row + 1, col + 1);
        pushQuad(indices, i0, i1, i2, i3, row + col);
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aRockA', new THREE.Float32BufferAttribute(rockA, 1));
    geometry.setAttribute('aRockB', new THREE.Float32BufferAttribute(rockB, 1));
    geometry.setAttribute('aRockWeight', new THREE.Float32BufferAttribute(rockWeight, 1));
    geometry.setAttribute('aOre', new THREE.Float32BufferAttribute(ore, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
