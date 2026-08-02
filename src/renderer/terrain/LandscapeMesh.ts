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
 * crease direction, and smooth-shaded normals turn that into corduroy running
 * across open ground — the single most obvious artifact on the landscape at
 * its 4m sample spacing. Flipping on parity breaks the run without changing
 * the surface the quad describes.
 */
function pushQuad(indices: number[], i0: number, i1: number, i2: number, i3: number, parity: number): void {
  if ((parity & 1) === 0) indices.push(i0, i2, i1, i1, i2, i3);
  else indices.push(i0, i2, i3, i0, i3, i1);
}

/** Distance from (x, z) to the nearest edge of rect, measured inward — negative outside. */
function distanceInsideRect(rect: Rect, x: number, z: number): number {
  const dx = Math.min(x - rect.minX, rect.maxX - x);
  const dz = Math.min(z - rect.minZ, rect.maxZ - z);
  return Math.min(dx, dz);
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

export class LandscapeMesh {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.Material;
  private readonly tileMeshes: THREE.Mesh[] = [];
  private seamMesh: THREE.Mesh | null = null;

  /** `material` is shared with TerrainMesh and FragmentMesh (D9's "one shared terrain material" — one shader, one draw-state everywhere). */
  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.scene = scene;
    this.material = material;
  }

  /** Total mesh count (tiles + seam, if any) — diagnostics and tests. */
  get meshCount(): number {
    return this.tileMeshes.length + (this.seamMesh ? 1 : 0);
  }

  build(handle: LandscapeHandle, palette: CompositionPalette): void {
    this.dispose();

    for (const tile of handle.map.tiles) {
      const mesh = this.buildTileMesh(
        tile, handle.map.coarseStep, handle.map.samplesPerTile, palette, handle.playableRect,
      );
      if (mesh) {
        this.scene.add(mesh);
        this.tileMeshes.push(mesh);
      }
    }

    this.seamMesh = this.buildSeamMesh(handle.playableRect, handle.sampleColumn, palette);
    if (this.seamMesh) this.scene.add(this.seamMesh);
  }

  dispose(): void {
    for (const mesh of this.tileMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.tileMeshes.length = 0;
    if (this.seamMesh) {
      this.scene.remove(this.seamMesh);
      this.seamMesh.geometry.dispose();
      this.seamMesh = null;
    }
  }

  // ---------- Internal ----------

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
    tile: LandscapeTile, step: number, n: number, palette: CompositionPalette, rect: Rect,
  ): THREE.Mesh | null {
    if (tile.heights.length === 0) return null;

    // Most tiles are nowhere near the rect — test the tile's own span once and
    // skip the per-quad work entirely for those.
    const tileMaxX = tile.originX + (n - 1) * step;
    const tileMaxZ = tile.originZ + (n - 1) * step;
    const touchesRect =
      tileMaxX > rect.minX && tile.originX < rect.maxX &&
      tileMaxZ > rect.minZ && tile.originZ < rect.maxZ;

    const positions = new Float32Array(n * n * 3);
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
          // Any corner inside the rect means this quad overhangs ground the
          // voxel mesh owns — drop the whole quad rather than let it dip in.
          const reachesIntoRect =
            distanceInsideRect(rect, x0, z0) > 0 || distanceInsideRect(rect, x1, z0) > 0 ||
            distanceInsideRect(rect, x0, z1) > 0 || distanceInsideRect(rect, x1, z1) > 0;
          if (reachesIntoRect) continue;
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
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
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
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];
    const indices: number[] = [];
    const vertexIndex = new Map<number, number>();

    const worldX = (col: number) => outerMinX + col * FINE_STEP;
    const worldZ = (row: number) => outerMinZ + row * FINE_STEP;

    const emitVertex = (row: number, col: number): number => {
      const key = row * cols + col;
      const existing = vertexIndex.get(key);
      if (existing !== undefined) return existing;

      const x = worldX(col), z = worldZ(row);
      const sample = sampleColumn(x, z);
      const insideDepth = distanceInsideRect(rect, x, z);
      const y = insideDepth > 0 ? sample.height - OVERLAP_DROP : sample.height;

      const idx = positions.length / 3;
      positions.push(x, y, z);
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
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
