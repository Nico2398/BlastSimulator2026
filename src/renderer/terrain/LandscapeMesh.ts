// BlastSimulator2026 — Landscape mesher (#458 T3.2/D7/A16, #491, #907)
// Builds real ground geometry for LandscapeMap's tiles, replacing
// DistantScenery's ring of unrelated decorative primitives with continuous
// terrain that actually meets the playable voxel mesh at its edge.
//
// One indexed grid Mesh per LandscapeTile, at the map's stored coarse
// resolution (4m by default). Every coarse quad is classified against the live
// claim (classifyQuad): quads whose every cell the playable mesh draws are
// dropped, quads that hold or touch a drawn cell are subdivided to FINE_STEP
// (1m) by buildBoundaryQuad, their neighbours to MID_STEP, and open ground is
// emitted whole. There is no second overlapping "seam" mesh (#491 — the old
// two-mesh overlap-and-hide-the-seam design left a ~20m band where the coarse
// tile's loose corner-in-rect test and the fine seam mesh's own placement could
// disagree, producing floating or detached ground shards along ridges/slopes).
//
// Two rules make the join exact rather than approximate (#907):
//
//   **Ownership is a cell test, and the same one the playable mesh marches by.**
//   `PlayableCut.meshClaimsColumn` answers about the 1 m cell at (x, z), which
//   is one marching-cubes cube column, and a fine cell is kept exactly when the
//   answer for its own minimum corner is no. In production that predicate is
//   `PlayableCoverage.meshClaimsCell`, a point test against the very rect
//   TerrainMesh's march loop runs over — so the two sheets cannot disagree
//   about a square metre.
//
//   **The flat-edge rule stops at the claim.** A boundary quad's perimeter node
//   is placed by linear interpolation between its PARENT coarse quad's corner
//   heights, so it meets an unsubdivided coarser neighbour with no T-junction
//   crack (#491) — but only on the sides that actually face one. On a side
//   facing another fine quad, or facing the claim itself, the node takes the
//   live surface height (`PlayableCut.boundaryHeightAt`, falling back to the
//   theoretical WorldGen height) — the same number the playable mesh puts its
//   own vertex at. Applying the chord on the claim side is what put the
//   landscape's boundary ring on a straight 4 m line while the playable mesh
//   followed the sampled ground between the same two coarse nodes.
import * as THREE from 'three';
import type { LandscapeHandle } from '../../console/commands/world.js';
import type { LandscapeTile } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { type CompositionPalette } from '../../core/world/VoxelGrid.js';
import { rockIndexOf } from '../../core/world/RockCatalog.js';

/** Sample spacing of a boundary quad's subdivision, metres — matches the old seam mesh's resolution. */
const FINE_STEP = 1;

/** How far past its own bounding rect the playable mesh can draw ground: one
 *  cell, the west/north sealing halo (`PlayableCoverage.meshedCellRect`). Only
 *  used to reject quads that cannot possibly touch the claim. */
const PLAYABLE_HALO_CELLS = 1;

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
  /** The height the playable mesh renders at column (x, z), or NaN where it
   *  renders nothing — the landscape's signal to use its own sampled height.
   *  On the shared ring this is what makes the two sheets place the same node
   *  at the same Y, before or after a blast (#559, #907). */
  boundaryHeightAt?(x: number, z: number): number;
  /** True when the playable mesh draws ground over the 1 m CELL whose minimum
   *  corner is (x, z) — including the sealing halo it marches one cell past its
   *  own rect. A cell test, not a column test: the cell at the high edge of a
   *  quad belongs to the next quad (#559 root cause 4, #907). Falls back to
   *  ownsColumn when absent. */
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
 * Classifies one coarse-tile quad (given by its two opposite corners) against
 * the live claim boundary: 'inside' (dropped — the voxel mesh owns every cell
 * of it), 'boundary' (subdivided to FINE_STEP by buildBoundaryQuad), or
 * 'outside' (emitted whole, or at MID_STEP when it borders the fine ring).
 *
 * Two things this has to get right, and both were wrong before #907.
 *
 * **It classifies CELLS, not corner nodes.** A quad covers the 1 m cells whose
 * minimum corners run over [x0, x1) x [z0, z1) — the cell at x1 belongs to the
 * next quad. Testing the four corner nodes counted that neighbouring cell as
 * part of this quad, so the last claimed cell before the east/south edge of the
 * site was kept by the landscape as well as marched by TerrainMesh: two sheets
 * over the same square metre.
 *
 * **A quad entirely outside the claim still needs the fine ring when it touches
 * it.** The landscape's coarse lattice is aligned to the playable rect's centre
 * (LandscapeMap tiles the world from there at COARSE_STEP), so a rect whose span
 * is a multiple of 2 * COARSE_STEP — every level's is — puts its own edge exactly
 * on a lattice line. Every cell on one side is then claimed and every cell on the
 * other is not, no quad straddles anything, and the claim edge ends up between an
 * 'inside' quad and a plain COARSE_STEP 'outside' quad with no fine ring anywhere
 * near it: a 4 m-spaced landscape edge butted against a 1 m-spaced playable one.
 * So a fully-unclaimed quad that shares an edge or a corner with a claimed cell is
 * 'boundary' too, and the ring exists on whichever side of the lattice line the
 * claim happens to fall.
 */
export function classifyQuad(playable: PlayableCut, x0: number, z0: number, x1: number, z1: number): 'outside' | 'inside' | 'boundary' {
  const claims = playable.meshClaimsColumn ?? playable.ownsColumn;

  // Nothing the playable mesh draws can reach further than one cell outside its
  // own bounding rect (the west/north sealing halo), so a quad whose expanded
  // neighbourhood misses that band is 'outside' without a single cell test —
  // this runs over every quad of every tile that touches the rect.
  const { rect } = playable;
  if (
    x1 + FINE_STEP <= rect.minX - PLAYABLE_HALO_CELLS || x0 - FINE_STEP >= rect.maxX ||
    z1 + FINE_STEP <= rect.minZ - PLAYABLE_HALO_CELLS || z0 - FINE_STEP >= rect.maxZ
  ) return 'outside';

  let claimedCells = 0;
  let totalCells = 0;
  for (let z = z0; z < z1; z += FINE_STEP) {
    for (let x = x0; x < x1; x += FINE_STEP) {
      totalCells++;
      if (claims(x, z)) claimedCells++;
    }
  }
  if (claimedCells === totalCells && totalCells > 0) return 'inside';
  if (claimedCells > 0) return 'boundary';

  // Fully unclaimed: fine anyway when it touches the claimed region, so the two
  // sheets meet at one shared node spacing.
  for (let z = z0 - FINE_STEP; z <= z1; z += FINE_STEP) {
    for (let x = x0 - FINE_STEP; x <= x1; x += FINE_STEP) {
      if (x >= x0 && x < x1 && z >= z0 && z < z1) continue; // own cells: already counted
      if (claims(x, z)) return 'boundary';
    }
  }
  return 'outside';
}

/**
 * Which sides of a boundary quad face a neighbour emitted at a COARSER step
 * than FINE_STEP (an 'outside' quad, whether coarse or MID_STEP). Those sides —
 * and only those — take the flat-edge rule.
 *
 * Sides are named by the axis end they sit on: west/north are the x0/z0 sides,
 * east/south the x1/z1 sides.
 */
export interface BoundaryQuadSides {
  coarseWest: boolean;
  coarseEast: boolean;
  coarseNorth: boolean;
  coarseSouth: boolean;
}

/** Every side coarse — the pre-#907 behaviour, and the right answer for a lone
 *  quad with no classified neighbourhood (tests, and callers with no map). */
const ALL_SIDES_COARSE: BoundaryQuadSides = {
  coarseWest: true, coarseEast: true, coarseNorth: true, coarseSouth: true,
};

/**
 * Emits the clipped/subdivided geometry for one boundary quad (a coarse-tile
 * quad classifyQuad marked 'boundary') into the given output arrays, sampled
 * at fine (FINE_STEP) resolution against the live claim edge so it meets the
 * playable mesh with no overlap and no gap.
 *
 * Subdivides the one coarse quad into SUBDIV×SUBDIV fine cells and keeps a cell
 * exactly when the playable mesh does not draw it — a single test on the cell's
 * own minimum corner, which is what `meshClaimsColumn` answers about. The old
 * rule kept a cell if ANY of its four corner nodes was unclaimed, which counted
 * the neighbouring cell past the quad's high edge as part of this cell and so
 * kept the last claimed row before the site's east/south edge: two sheets over
 * the same square metre, z-fighting by construction (#907).
 *
 * Node positions follow the flat-edge rule — a node on the PARENT coarse quad's
 * perimeter is placed by linear interpolation between that side's two coarse
 * corner heights rather than by sampling — but only on the sides `sides` marks
 * coarse. That rule exists to meet an unsubdivided neighbour with no T-junction
 * crack (#491), and it has nothing to answer for on a side facing another fine
 * quad (both sample the same nodes) or facing the claim itself (the neighbour
 * there is the playable mesh, at 1 m spacing). Applying it on the claim side is
 * what put the landscape's own boundary ring on a straight 4 m chord while the
 * playable mesh followed the sampled ground between the same two coarse nodes.
 *
 * Every other node takes the live surface height (`playable.boundaryHeightAt`)
 * when the caller supplies one, falling back to the theoretical WorldGen height
 * otherwise, so the ring never drifts from what the playable mesh renders.
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
  sides: BoundaryQuadSides = ALL_SIDES_COARSE,
): void {
  const subdiv = Math.max(1, Math.round((x1 - x0) / FINE_STEP));
  const claims = playable.meshClaimsColumn ?? playable.ownsColumn;

  // Parent coarse corner heights, read directly (never boundary-adjusted) —
  // the flat-edge rule's whole point is to reproduce exactly what an
  // unsubdivided coarse neighbour would compute for this same edge.
  const h00 = sampleColumn(x0, z0).height;
  const h10 = sampleColumn(x1, z0).height;
  const h01 = sampleColumn(x0, z1).height;
  const h11 = sampleColumn(x1, z1).height;

  // Slope source for shading: the live/theoretical field, never the
  // flat-edge-adjusted position (a T-junction fix, not a slope). Trust the
  // live value whenever the caller can supply one, and only when it isn't
  // NaN — the claim boundary moves, and computeVoxelColumnSurfaceHeight
  // answers NaN rather than clamping for a column outside the site (#559).
  // Gating on ownsColumn here as well would be redundant with that NaN
  // contract in production (boundaryHeightAt IS computeVoxelColumnSurfaceHeight,
  // which already returns NaN for exactly the columns ownsColumn rejects) and
  // wrong the moment a caller's live source legitimately covers ground just
  // past ownsColumn's strict edge (e.g. TerrainMesh's meshClaimsColumn halo,
  // or a live post-blast height one ring out) — #559 root cause 1.
  const heightCache = new Map<string, number>();
  const trueHeightAt = (x: number, z: number): number => {
    const key = `${x},${z}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    let h = sampleColumn(x, z).height;
    if (playable.boundaryHeightAt) {
      const live = playable.boundaryHeightAt(x, z);
      if (!Number.isNaN(live)) h = live;
    }
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

    const onWest = col === 0, onEast = col === subdiv;
    const onNorth = row === 0, onSouth = row === subdiv;
    const flatX = (onWest && sides.coarseWest) || (onEast && sides.coarseEast);
    const flatZ = (onNorth && sides.coarseNorth) || (onSouth && sides.coarseSouth);

    let y: number;
    if ((onWest || onEast) && (onNorth || onSouth)) {
      // A quad corner is itself a coarse lattice node, so its flat-edge value
      // and its sampled value are the same number for any node outside the
      // claim — and a corner shared with a coarser neighbour always is one,
      // since that neighbour is only classified 'outside' when no cell in its
      // own expanded neighbourhood is claimed. Preferring the parent corner
      // whenever either incident side is coarse keeps that identity explicit.
      const corner = onWest ? (onNorth ? h00 : h01) : (onNorth ? h10 : h11);
      y = flatX || flatZ ? corner : trueHeightAt(x, z);
    } else if (flatZ) {
      const t = col / subdiv;
      y = onNorth ? h00 + t * (h10 - h00) : h01 + t * (h11 - h01);
    } else if (flatX) {
      const t = row / subdiv;
      y = onWest ? h00 + t * (h01 - h00) : h10 + t * (h11 - h10);
    } else {
      y = trueHeightAt(x, z);
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
      // One test, on the cell's own minimum corner: `claims` answers about the
      // 1 m cell at (x, z), which is exactly one marching-cubes cube column.
      if (claims(x0 + col * FINE_STEP, z0 + row * FINE_STEP)) continue; // the playable mesh draws this cell

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
 *
 * `step` is the target sample spacing to subdivide the quad down to (the
 * caller always passes MID_STEP) — the same "spacing, not a count" meaning
 * FINE_STEP carries in buildBoundaryQuad, not the coarse tile's own step.
 */
export function subdivideOutsideQuad(
  positions: number[],
  normals: number[],
  rockA: number[],
  rockB: number[],
  rockWeight: number[],
  ore: number[],
  indices: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  sampleColumn: SampleFn,
  palette: CompositionPalette,
  step: number,
): void {
  const subdiv = Math.max(1, Math.round((x1 - x0) / step));

  // Parent coarse corner heights. A plain bilinear interpolation of these
  // four naturally reduces to the flat-edge rule's linear interpolation
  // along every side of the quad, so no separate perimeter special-case is
  // needed here the way buildBoundaryQuad needs one (its interior deviates
  // from bilinear by using live/theoretical sampled height; this function's
  // interior never does — it's unconditionally outside the claim).
  const h00 = sampleColumn(x0, z0).height;
  const h10 = sampleColumn(x1, z0).height;
  const h01 = sampleColumn(x0, z1).height;
  const h11 = sampleColumn(x1, z1).height;

  const bilinearHeight = (x: number, z: number): number => {
    const u = (x - x0) / (x1 - x0);
    const v = (z - z0) / (z1 - z0);
    return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
  };

  const vertexIndex = new Map<number, number>();

  const emitVertex = (row: number, col: number): number => {
    const key = row * (subdiv + 1) + col;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;

    const x = x0 + col * MID_STEP;
    const z = z0 + row * MID_STEP;
    const y = bilinearHeight(x, z);

    const dhdx = (bilinearHeight(x + MID_STEP, z) - bilinearHeight(x - MID_STEP, z)) / (2 * MID_STEP);
    const dhdz = (bilinearHeight(x, z + MID_STEP) - bilinearHeight(x, z - MID_STEP)) / (2 * MID_STEP);
    const normal = heightFieldNormal(dhdx, dhdz);

    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(normal[0], normal[1], normal[2]);

    const sample = sampleColumn(x, z);
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
      const i0 = emitVertex(row, col);
      const i1 = emitVertex(row, col + 1);
      const i2 = emitVertex(row + 1, col);
      const i3 = emitVertex(row + 1, col + 1);
      pushQuad(indices, i0, i1, i2, i3, row + col);
    }
  }
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

    // Classify quads by WORLD position, not by tile-local index, and memoize.
    //
    // Two tiles meet along a shared line of quads, and a claim can straddle it
    // (LandscapeMap tiles the world from the playable rect's own centre, so the
    // tutorial site sits astride a tile corner). A tile-local lookup answers
    // "not a boundary quad" for anything past its own edge, so the two tiles
    // disagreed about the resolution — and therefore about the flat-edge rule —
    // on exactly the quads they share. classifyQuad is a pure function of world
    // coordinates and the cut, so asking it directly gives both tiles the same
    // answer (#907).
    const quadClass = new Map<string, 'inside' | 'outside' | 'boundary'>();
    const classAt = (x0: number, z0: number): 'inside' | 'outside' | 'boundary' => {
      if (!touchesRect) return 'outside';
      const key = `${x0},${z0}`;
      const cached = quadClass.get(key);
      if (cached !== undefined) return cached;
      const cls = classifyQuad(playable, x0, z0, x0 + step, z0 + step);
      quadClass.set(key, cls);
      return cls;
    };
    /** True when the quad at (x0, z0) is emitted at a coarser step than
     *  FINE_STEP, and a fine neighbour must flat-edge the side facing it. */
    const isCoarserQuad = (x0: number, z0: number): boolean => classAt(x0, z0) === 'outside';

    const indices: number[] = [];
    for (let row = 0; row < n - 1; row++) {
      const z0 = tile.originZ + row * step, z1 = z0 + step;
      for (let col = 0; col < n - 1; col++) {
        if (touchesRect) {
          const x0 = tile.originX + col * step, x1 = x0 + step;
          const cls = classAt(x0, z0);
          if (cls === 'inside') continue;
          if (cls === 'boundary') {
            buildBoundaryQuad(
              positions, normals, rockA, rockB, rockWeight, ore, indices,
              x0, z0, x1, z1, sampleColumn, palette, playable,
              {
                coarseWest: isCoarserQuad(x0 - step, z0),
                coarseEast: isCoarserQuad(x1, z0),
                coarseNorth: isCoarserQuad(x0, z0 - step),
                coarseSouth: isCoarserQuad(x0, z1),
              },
            );
            continue;
          }
          const adjacentToBoundary =
            classAt(x0 - step, z0) === 'boundary' || classAt(x1, z0) === 'boundary' ||
            classAt(x0, z0 - step) === 'boundary' || classAt(x0, z1) === 'boundary';
          if (adjacentToBoundary) {
            subdivideOutsideQuad(
              positions, normals, rockA, rockB, rockWeight, ore, indices,
              x0, z0, x1, z1, sampleColumn, palette, MID_STEP,
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
