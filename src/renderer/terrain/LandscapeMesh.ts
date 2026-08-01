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
import { sampleRockColor } from '../ProceduralTexture.js';

/** Metres outside the playable rect within which the seam subdivides to FINE_STEP (#458 A16). */
const FINE_MARGIN = 24;
/** Metres inside the playable rect the seam mesh still covers. */
const OVERLAP = 2;
/** The overlap strip's vertices are lowered by this much so it sits under the playable mesh, never fighting it. */
const OVERLAP_DROP = 0.15;
const FINE_STEP = 1;

type SampleFn = (x: number, z: number) => { height: number; biomeId: number; surfCompId: number };

/** Distance from (x, z) to the nearest edge of rect, measured inward — negative outside. */
function distanceInsideRect(rect: Rect, x: number, z: number): number {
  const dx = Math.min(x - rect.minX, rect.maxX - x);
  const dz = Math.min(z - rect.minZ, rect.maxZ - z);
  return Math.min(dx, dz);
}

function colorFor(palette: CompositionPalette, surfCompId: number, x: number, y: number, z: number): THREE.Color {
  const comp = palette.get(surfCompId).comp;
  return sampleRockColor(getDominantRockId(comp), x, y, z);
}

export class LandscapeMesh {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.Material;
  private readonly tileMeshes: THREE.Mesh[] = [];
  private seamMesh: THREE.Mesh | null = null;

  /** `material` is shared with TerrainMesh (D9's "same interim material" — one shader, one draw-state for both zones). */
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
      const mesh = this.buildTileMesh(tile, handle.map.coarseStep, handle.map.samplesPerTile, palette);
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

  /** Indexed grid mesh from one tile's stored samples, smooth-shaded (#458 A16). */
  private buildTileMesh(tile: LandscapeTile, step: number, n: number, palette: CompositionPalette): THREE.Mesh | null {
    if (tile.heights.length === 0) return null;

    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    for (let row = 0; row < n; row++) {
      const z = tile.originZ + row * step;
      for (let col = 0; col < n; col++) {
        const x = tile.originX + col * step;
        const idx = row * n + col;
        const y = tile.heights[idx]!;

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;

        const color = colorFor(palette, tile.surfCompIds[idx]!, x, y, z);
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const i0 = row * n + col;
        const i1 = i0 + 1;
        const i2 = i0 + n;
        const i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
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
    const colors: number[] = [];
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
      const color = colorFor(palette, sample.surfCompId, x, y, z);
      colors.push(color.r, color.g, color.b);
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
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    return mesh;
  }
}
