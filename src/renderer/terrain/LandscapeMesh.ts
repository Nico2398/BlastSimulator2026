// BlastSimulator2026 — Landscape mesher (#458 T3.2/D7/A16, #491)
// Builds real ground geometry for LandscapeMap's tiles, replacing
// DistantScenery's ring of unrelated decorative primitives with continuous
// terrain that actually meets the playable voxel mesh at its edge.
//
// One indexed grid Mesh per LandscapeTile, at the map's stored coarse
// resolution (4m by default): quads fully outside the playable rect are
// emitted as-is, quads fully inside it are dropped (the voxel mesh owns that
// ground), and quads straddling the boundary are subdivided down to
// FINE_STEP (1m) by buildBoundaryQuad instead of duplicated by a second,
// overlapping "seam" mesh (#491 — the old two-mesh overlap-and-hide-the-seam
// design left a ~20m band where the coarse tile's loose corner-in-rect test
// and the fine seam mesh's own placement could disagree, producing floating
// or detached ground shards along ridges/slopes). Every boundary quad's
// outer perimeter interpolates linearly between its PARENT coarse quad's own
// corner heights (the "flat-edge rule") so it always meets its unsubdivided
// coarse neighbours with no crack, while interior boundary nodes — and the
// exact claim edge, via PlayableCut.boundaryHeightAt — read the live surface
// so a blast never opens a gap before the next rebuild moves the boundary.

import * as THREE from 'three';
import type { LandscapeHandle } from '../../console/commands/world.js';
import type { LandscapeTile } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { type CompositionPalette } from '../../core/world/VoxelGrid.js';
import { rockIndexOf } from '../../core/world/RockCatalog.js';

/** Sample spacing of a boundary quad's subdivision, metres — matches the old seam mesh's resolution. */
const FINE_STEP = 1;

/** Intermediate subdivision step between FINE_STEP boundary quads and the
 *  coarse open-ground quads, so the resolution jump isn't a one-step cliff
 *  that itself reads as a seam (#559). */
export const MID_STEP = 2;

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
  /** Live surface height at (x, z), when known — used at the claim boundary
   *  so the landscape's edge matches whatever the playable mesh currently
   *  renders there. Falls back to the theoretical WorldGen height when absent. */
  boundaryHeightAt?(x: number, z: number): number;
  /** Ground TerrainMesh will actually draw into, including its 1-voxel
   *  outward-march halo — narrower "not mine to draw" test than ownsColumn.
   *  Falls back to ownsColumn when absent (#559). */
  meshClaimsColumn?(x: number, z: number): boolean;
}

/** The pre-expansion behaviour: the site is exactly its rect. */
function rectCut(rect: Rect): PlayableCut {
  return { rect, ownsColumn: (x, z) => distanceInsideRect(rect, x, z) > 0 };
}

/**
 * Two-rock blend for one sample, replacing rockIndexFor's collapse to a
 * single dominant index. `rockA`/`rockB` are shader rock-catalog indices;
 * `weight` is the blend fraction toward `rockB` (0 = pure rockA), matching
 * TerrainMesh.emitVertex's convention exactly (rockA/rockB/weight feed the
 * one shared shader, which rounds each to an int per-fragment and blends
 * their material recipes by vRockW).
 */
export function rockBlendFor(palette: CompositionPalette, surfCompId: number): { rockA: number; rockB: number; weight: number } {
  const rocks = palette.get(surfCompId).comp.rocks;
  if (rocks.length === 0) return { rockA: 0, rockB: 0, weight: 0 };

  const sorted = [...rocks].sort((a, b) => b.coefficient - a.coefficient);
  const first = sorted[0]!;
  const second = sorted[1];

  const rockA = Math.max(0, rockIndexOf(first.rockId));
  if (!second || second.coefficient <= 0) {
    return { rockA, rockB: rockA, weight: 0 };
  }
  const rockB = Math.max(0, rockIndexOf(second.rockId));
  const weight = second.coefficient / (first.coefficient + second.coefficient);
  return { rockA, rockB, weight };
}

/**
 * Classifies one coarse-tile quad (given by its two opposite corners)
 * against the live claim boundary: fully outside the playable rect (kept
 * as-is), fully inside it (dropped — the voxel mesh owns that ground), or
 * straddling the boundary (needs clipping/subdivision via buildBoundaryQuad
 * instead of being emitted whole).
 */
export function classifyQuad(playable: PlayableCut, x0: number, z0: number, x1: number, z1: number): 'outside' | 'inside' | 'boundary' {
  const owned = [
    playable.ownsColumn(x0, z0),
    playable.ownsColumn(x1, z0),
    playable.ownsColumn(x0, z1),
    playable.ownsColumn(x1, z1),
  ];
  if (owned.every(o => o)) return 'inside';
  if (owned.every(o => !o)) return 'outside';
  return 'boundary';
}

/**
 * Emits the clipped/subdivided geometry for one boundary quad (a coarse-tile
 * quad classifyQuad marked 'boundary') into the given output arrays, sampled
 * at fine (FINE_STEP) resolution against the live claim edge so it meets the
 * playable mesh with no overlap and no gap.
 *
 * Subdivides the one coarse quad into SUBDIV×SUBDIV fine cells and keeps a
 * cell only if at least one of its 4 corners is unowned — this is what drops
 * the pit-side ground entirely rather than duplicating it. Every kept cell's
 * two triangles are appended to the (growable) output arrays the caller's
 * coarse pass already populated for its own tile.
 *
 * Node positions follow the flat-edge rule: a node sitting exactly on the
 * PARENT coarse quad's own perimeter is placed by linear interpolation
 * between that side's two coarse corner heights (never the true sampled
 * height), so the boundary quad's outer edge always matches whatever an
 * unsubdivided neighbouring coarse quad computes for the same edge — no
 * T-junction crack is possible. Interior nodes use the live surface height
 * (`playable.boundaryHeightAt`) when the caller supplies one, falling back to
 * the theoretical WorldGen height otherwise, so the boundary ring never
 * drifts from what the playable marching-cubes mesh renders after a blast.
 */
export function buildBoundaryQuad(
  positions: number[],
  normals: number[],
  rockA: number[],
  rockB: number[],
  rockWeight: number[],
  ore: number[],
  indices: number[],
  x0: number, z0: number, x1: number, z1: number,
  sampleColumn: SampleFn,
  palette: CompositionPalette,
  playable: PlayableCut,
): void {
  const subdiv = Math.max(1, Math.round((x1 - x0) / FINE_STEP));

  // Parent coarse corner heights, read directly (never boundary-adjusted) —
  // the flat-edge rule's whole point is to reproduce exactly what an
  // unsubdivided coarse neighbour would compute for this same edge.
  const h00 = sampleColumn(x0, z0).height;
  const h10 = sampleColumn(x1, z0).height;
  const h01 = sampleColumn(x0, z1).height;
  const h11 = sampleColumn(x1, z1).height;

  // Slope source for shading: the live/theoretical field, never the
  // flat-edge-adjusted position (a T-junction fix, not a slope).
  const heightCache = new Map<string, number>();
  const trueHeightAt = (x: number, z: number): number => {
    const key = `${x},${z}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const h = playable.boundaryHeightAt ? playable.boundaryHeightAt(x, z) : sampleColumn(x, z).height;
    heightCache.set(key, h);
    return h;
  };

  const vertexIndex = new Map<number, number>();

  const emitVertex = (row: number, col: number): number => {
    const key = row * (subdiv + 1) + col;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;

    const x = x0 + col * FINE_STEP;
    const z = z0 + row * FINE_STEP;
    const sample = sampleColumn(x, z);

    const onXEdge = col === 0 || col === subdiv;
    const onZEdge = row === 0 || row === subdiv;

    let y: number;
    if (onXEdge && onZEdge) {
      y = col === 0 ? (row === 0 ? h00 : h01) : (row === 0 ? h10 : h11);
    } else if (onZEdge) {
      const t = col / subdiv;
      y = row === 0 ? h00 + t * (h10 - h00) : h01 + t * (h11 - h01);
    } else if (onXEdge) {
      const t = row / subdiv;
      y = col === 0 ? h00 + t * (h01 - h00) : h10 + t * (h11 - h10);
    } else {
      y = playable.boundaryHeightAt ? playable.boundaryHeightAt(x, z) : sample.height;
    }

    const dhdx = (trueHeightAt(x + FINE_STEP, z) - trueHeightAt(x - FINE_STEP, z)) / (2 * FINE_STEP);
    const dhdz = (trueHeightAt(x, z + FINE_STEP) - trueHeightAt(x, z - FINE_STEP)) / (2 * FINE_STEP);
    const normal = heightFieldNormal(dhdx, dhdz);

    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(normal[0], normal[1], normal[2]);

    const blend = rockBlendFor(palette, sample.surfCompId);
    rockA.push(blend.rockA);
    rockB.push(blend.rockB);
    rockWeight.push(blend.weight);
    ore.push(-1, 0); // landscape never carries ore (#458 A18)

    vertexIndex.set(key, idx);
    return idx;
  };

  for (let row = 0; row < subdiv; row++) {
    for (let col = 0; col < subdiv; col++) {
      const cx0 = x0 + col * FINE_STEP, cx1 = cx0 + FINE_STEP;
      const cz0 = z0 + row * FINE_STEP, cz1 = cz0 + FINE_STEP;
      const anyUnowned =
        !playable.ownsColumn(cx0, cz0) || !playable.ownsColumn(cx1, cz0) ||
        !playable.ownsColumn(cx0, cz1) || !playable.ownsColumn(cx1, cz1);
      if (!anyUnowned) continue; // fully claimed — the playable mesh owns this cell

      const i0 = emitVertex(row, col);
      const i1 = emitVertex(row, col + 1);
      const i2 = emitVertex(row + 1, col);
      const i3 = emitVertex(row + 1, col + 1);
      pushQuad(indices, i0, i1, i2, i3, row + col);
    }
  }
}

/**
 * Subdivides a coarse 'outside' quad adjacent to the boundary at an
 * intermediate resolution (MID_STEP) so the jump from FINE_STEP boundary
 * quads to coarse open-ground quads isn't a one-step cliff that itself reads
 * as a seam. Flat-edge-interpolates its own outer perimeter against
 * unsubdivided coarse neighbours per the existing #491 rule.
 */
export function subdivideOutsideQuad(
  _positions: number[],
  _normals: number[],
  _rockA: number[],
  _rockB: number[],
  _rockWeight: number[],
  _ore: number[],
  _indices: number[],
  _x0: number,
  _z0: number,
  _x1: number,
  _z1: number,
  _sampleColumn: SampleFn,
  _palette: CompositionPalette,
  _step: number,
): void {
  throw new Error('not implemented');
}

export class LandscapeMesh {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.Material;
  private readonly tileMeshes: THREE.Mesh[] = [];
  /** Tiles by grid index, so a vertex on a tile's edge can read its neighbour's samples for a slope. */
  private readonly tileIndex = new Map<string, LandscapeTile>();

  /** `material` is shared with TerrainMesh and FragmentMesh (D9's "one shared terrain material" — one shader, one draw-state everywhere). */
  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.scene = scene;
    this.material = material;
  }

  /** Total mesh count (one per non-empty tile) — diagnostics and tests. */
  get meshCount(): number {
    return this.tileMeshes.length;
  }

  /**
   * Every tile mesh, for raycasting past the site's claimed edge (#558) —
   * mirrors TerrainMesh.meshes so a caller can raycast both without knowing
   * which one it hit.
   */
  get meshes(): THREE.Mesh[] {
    return this.tileMeshes;
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
        tile, handle.map.coarseStep, handle.map.samplesPerTile, palette, playable, handle.sampleColumn,
      );
      if (mesh) {
        this.scene.add(mesh);
        this.tileMeshes.push(mesh);
      }
    }
  }

  dispose(): void {
    for (const mesh of this.tileMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.tileMeshes.length = 0;
    this.tileIndex.clear();
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
   * A tile spans 512 m while a playable rect is 32–160 m, so every rect sits
   * deep inside its tiles. Each coarse quad is classified against the live
   * claim boundary (classifyQuad): 'inside' quads are dropped (the voxel mesh
   * owns that ground), 'outside' quads are emitted whole exactly as before,
   * and 'boundary' quads — the single quad-wide ring actually straddling the
   * claim edge — are subdivided by buildBoundaryQuad instead of a second,
   * overlapping seam mesh (#491).
   */
  private buildTileMesh(
    tile: LandscapeTile, step: number, n: number, palette: CompositionPalette, playable: PlayableCut,
    sampleColumn: SampleFn,
  ): THREE.Mesh | null {
    if (tile.heights.length === 0) return null;

    // Most tiles are nowhere near the rect — test the tile's own span once and
    // skip the per-quad work entirely for those.
    const tileMaxX = tile.originX + (n - 1) * step;
    const tileMaxZ = tile.originZ + (n - 1) * step;
    const touchesRect =
      tileMaxX > playable.rect.minX && tile.originX < playable.rect.maxX &&
      tileMaxZ > playable.rect.minZ && tile.originZ < playable.rect.maxZ;

    // Growable, not fixed-size: boundary quads append extra fine-grid
    // vertices past the tile's own n*n coarse nodes.
    const positions: number[] = [];
    const normals: number[] = [];
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = []; // (id, amt) pairs; landscape never carries ore (#458 A18)

    // Coarse nodes are pushed unconditionally, in row-major order, so index
    // row*n+col stays valid for every 'outside' quad regardless of which
    // quads elsewhere in the tile turn out to be 'inside'/'boundary'.
    for (let row = 0; row < n; row++) {
      const z = tile.originZ + row * step;
      for (let col = 0; col < n; col++) {
        const x = tile.originX + col * step;
        const idx = row * n + col;
        const y = tile.heights[idx]!;

        positions.push(x, y, z);

        // Central differences over the sample spacing, reaching into the
        // neighbouring tile at a tile edge so the slope — and therefore the
        // shading — stays continuous from one tile to the next.
        const dhdx = (this.nodeHeight(tile, row, col + 1, n) - this.nodeHeight(tile, row, col - 1, n)) / (2 * step);
        const dhdz = (this.nodeHeight(tile, row + 1, col, n) - this.nodeHeight(tile, row - 1, col, n)) / (2 * step);
        const normal = heightFieldNormal(dhdx, dhdz);
        normals.push(normal[0], normal[1], normal[2]);

        const blend = rockBlendFor(palette, tile.surfCompIds[idx]!);
        rockA.push(blend.rockA);
        rockB.push(blend.rockB);
        rockWeight.push(blend.weight);
        ore.push(-1, 0); // id = -1 (none); amt stays 0
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < n - 1; row++) {
      const z0 = tile.originZ + row * step, z1 = z0 + step;
      for (let col = 0; col < n - 1; col++) {
        if (touchesRect) {
          const x0 = tile.originX + col * step, x1 = x0 + step;
          const cls = classifyQuad(playable, x0, z0, x1, z1);
          if (cls === 'inside') continue;
          if (cls === 'boundary') {
            buildBoundaryQuad(
              positions, normals, rockA, rockB, rockWeight, ore, indices,
              x0, z0, x1, z1, sampleColumn, palette, playable,
            );
            continue;
          }
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
