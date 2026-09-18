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
import { NODES_PER_CHUNK, chunkKey, type LandscapeChunk, type LandscapeChunkId } from '../../core/world/LandscapeMap.js';
import type { Rect } from '../../core/world/WorldGen.js';
import { type CompositionPalette } from '../../core/world/VoxelGrid.js';
import { rockIndexOf } from '../../core/world/RockCatalog.js';

/** Sample spacing of a boundary quad's subdivision, metres — matches the old seam mesh's resolution. */
const FINE_STEP = 1;

/** How far past its own bounding rect the playable mesh can draw ground: one
 *  cell, the west/north sealing halo (`PlayableCoverage.meshedCellRect`). Only
 *  used to reject quads that cannot possibly touch the claim. */
const PLAYABLE_HALO_CELLS = 1;

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

/** Distance from (x, z) to the nearest edge of rect, measured inward — negative outside. */
function distanceInsideRect(rect: Rect, x: number, z: number): number {
  const dx = Math.min(x - rect.minX, rect.maxX - x);
  const dz = Math.min(z - rect.minZ, rect.maxZ - z);
  return Math.min(dx, dz);
}

/**
 * Which of a node's four incident sides sample coarser than `ownStep` — the
 * ladder's flat-edge trigger, shared by the claim boundary (`sides` are the
 * boundary quad's own FINE_STEP-relative neighbours) and a chunk's outer ring
 * (`sides` are the cross-chunk `NeighbourSteps`, relative to the chunk's step).
 */
function coarseSides(
  west: number, east: number, north: number, south: number, ownStep: number,
): { coarseWest: boolean; coarseEast: boolean; coarseNorth: boolean; coarseSouth: boolean } {
  return {
    coarseWest: west > ownStep,
    coarseEast: east > ownStep,
    coarseNorth: north > ownStep,
    coarseSouth: south > ownStep,
  };
}

/**
 * Which edge(s) of a `bound`-sized lattice a (row, col) node sits on, and
 * whether the flat-edge rule applies to it along each axis — shared by every
 * per-node pass (boundary-quad vertices, a chunk's own height/normal lattice)
 * that has to place a node on a coarse-neighbour chord instead of sampling it.
 */
function flatEdgeSides(
  row: number, col: number, bound: number,
  coarseWest: boolean, coarseEast: boolean, coarseNorth: boolean, coarseSouth: boolean,
): { onWest: boolean; onEast: boolean; onNorth: boolean; onSouth: boolean; flatX: boolean; flatZ: boolean } {
  const onWest = col === 0, onEast = col === bound;
  const onNorth = row === 0, onSouth = row === bound;
  const flatX = (onWest && coarseWest) || (onEast && coarseEast);
  const flatZ = (onNorth && coarseNorth) || (onSouth && coarseSouth);
  return { onWest, onEast, onNorth, onSouth, flatX, flatZ };
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
  /** The normal the playable mesh shades column (x, z) with, or null where it
   *  draws nothing there. On the shared ring this is what makes the two sheets
   *  LIGHT the node they share identically, the way `boundaryHeightAt` makes
   *  them place it identically: each sheet derives normals its own way — a
   *  density gradient here, a height-field slope there — and where those
   *  disagree across the edge they share, the crease draws the site's whole
   *  perimeter as a hairline rectangle (#1077). */
  boundaryNormalAt?(x: number, z: number): readonly [number, number, number] | null;
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
 * The neighbouring chunk's sample step on each of a chunk's four sides — the
 * ladder replacement for the old boundary-quad-local `BoundaryQuadSides`
 * (#1153). A side whose neighbour samples coarser than this chunk's own step
 * takes the flat-edge rule on that side, the same way a coarser 'outside'
 * quad used to.
 *
 * Sides are named by the axis end they sit on: west/north are the x0/z0 sides,
 * east/south the x1/z1 sides.
 */
export interface NeighbourSteps {
  west: number;
  east: number;
  north: number;
  south: number;
}

/** Every side at `step` — the right answer for a lone chunk with no classified neighbourhood (tests, and callers with no streamer). */
export function uniformNeighbourSteps(step: number): NeighbourSteps {
  return { west: step, east: step, north: step, south: step };
}

/**
 * Height of a chord node on a chunk edge shared with a coarser neighbour —
 * the ladder's flat-edge rule (#1153), read along `axis` at (x, z) against a
 * neighbour sampled at `neighbourStep`.
 *
 * Finds the two lattice nodes spaced `neighbourStep` apart along `axis`
 * (holding the other coordinate fixed) that bracket (x, z), samples both via
 * `sampleColumn`, and linearly interpolates between them — the same math the
 * pre-#1153 claim-boundary flat-edge rule used against its single hardcoded
 * coarse step, generalized to any neighbour step on the resolution ladder.
 */
export function chordHeight(
  sampleColumn: SampleFn, axis: 'x' | 'z', x: number, z: number, neighbourStep: number,
): number {
  const coord = axis === 'x' ? x : z;
  const lower = Math.floor(coord / neighbourStep) * neighbourStep;
  const upper = lower + neighbourStep;
  const t = (coord - lower) / neighbourStep;
  const hLower = (axis === 'x' ? sampleColumn(lower, z) : sampleColumn(x, lower)).height;
  const hUpper = (axis === 'x' ? sampleColumn(upper, z) : sampleColumn(x, upper)).height;
  return hLower + t * (hUpper - hLower);
}

/**
 * The normal to shade a landscape node at (x, z) with: the playable mesh's own
 * wherever that mesh draws the same node, and the height field's slope
 * everywhere else.
 *
 * `heightAt` is the boundary-adjusted height source the caller already uses for
 * positions, so the fallback slope is measured against the very ground the ring
 * is placed on rather than a separately-sampled one.
 */
function shadingNormalAt(
  x: number,
  z: number,
  playable: PlayableCut,
  heightAt: (x: number, z: number) => number,
): readonly [number, number, number] {
  const shared = playable.boundaryNormalAt?.(x, z);
  if (shared) return shared;
  const dhdx = (heightAt(x + FINE_STEP, z) - heightAt(x - FINE_STEP, z)) / (2 * FINE_STEP);
  const dhdz = (heightAt(x, z + FINE_STEP) - heightAt(x, z - FINE_STEP)) / (2 * FINE_STEP);
  return heightFieldNormal(dhdx, dhdz);
}

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
  sides: NeighbourSteps = uniformNeighbourSteps(FINE_STEP),
): void {
  const subdiv = Math.max(1, Math.round((x1 - x0) / FINE_STEP));
  const claims = playable.meshClaimsColumn ?? playable.ownsColumn;

  // The ladder's NeighbourSteps replaces the old boolean BoundaryQuadSides —
  // a side is flat-edged when its neighbour samples coarser than this quad's
  // own FINE_STEP. Behaviour is unchanged from the pre-#1153 boolean rule;
  // only the parameter's shape has moved.
  const { coarseWest, coarseEast, coarseNorth, coarseSouth } =
    coarseSides(sides.west, sides.east, sides.north, sides.south, FINE_STEP);

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

    const { onWest, onEast, onNorth, onSouth, flatX, flatZ } =
      flatEdgeSides(row, col, subdiv, coarseWest, coarseEast, coarseNorth, coarseSouth);

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

    // A node the playable mesh also draws is a node on the ring the two sheets
    // share, and it takes that mesh's own normal rather than a second estimate
    // of the same slope (#1077). Every other node keeps the height field's,
    // which is the only answer available out there.
    const normal = shadingNormalAt(x, z, playable, trueHeightAt);

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
 * Builds one chunk's mesh geometry against its live neighbour steps and the
 * playable cut, replacing the old per-tile `buildTileMesh` (#1153) — the
 * resolution ladder makes every mesh unit a single chunk rather than a
 * classify-and-subdivide pass over one giant tile. Null when the chunk
 * carries no geometry (fully claimed by the playable mesh).
 *
 * Returns a `THREE.Mesh` with no material set — `LandscapeMesh.buildChunk`
 * assigns the shared terrain material, since this free function (unlike the
 * old class-private `buildTileMesh`) has no `this.material` to read.
 *
 * Two independent adjustments compose here, and they answer different
 * questions:
 *  - The claim boundary (classifyQuad/buildBoundaryQuad): cells the playable
 *    mesh owns are dropped; cells straddling its edge are subdivided to 1 m
 *    and flat-edged against WITHIN-CHUNK neighbours that stayed at the
 *    chunk's own step (mirrors the pre-#1153 tile-local rule exactly).
 *  - The resolution ladder (chordHeight): nodes on the chunk's own OUTER
 *    ring, on a side whose `neighbourSteps` entry is coarser than this
 *    chunk's step, are placed on the coarser neighbour's own lattice instead
 *    of this chunk's sampled height, so the two chunks' shared edge is one
 *    line instead of two.
 */
export function buildChunkMesh(
  chunk: LandscapeChunk,
  neighbourSteps: NeighbourSteps,
  palette: CompositionPalette,
  playable: PlayableCut,
  sampleColumn: SampleFn,
): THREE.Mesh | null {
  const n = NODES_PER_CHUNK;
  const step = chunk.step;
  const { originX, originZ } = chunk;

  const maxX = originX + (n - 1) * step;
  const maxZ = originZ + (n - 1) * step;
  const touchesRect =
    maxX > playable.rect.minX && originX < playable.rect.maxX &&
    maxZ > playable.rect.minZ && originZ < playable.rect.maxZ;

  const { coarseWest, coarseEast, coarseNorth, coarseSouth } =
    coarseSides(neighbourSteps.west, neighbourSteps.east, neighbourSteps.north, neighbourSteps.south, step);

  /**
   * A chunk-own-lattice node's height, honoring the resolution-ladder chord
   * rule on the chunk's outer ring. A corner shared by two coarse sides is
   * an exact lattice node of every coarser ancestor too (the ladder's chunks
   * nest by construction), so it takes the plain sampled/cached value rather
   * than either side's chord — same reasoning as the pre-#1153 claim-edge
   * corner rule.
   */
  const nodeHeightAt = (row: number, col: number): number => {
    const { onWest, onNorth, flatX, flatZ } =
      flatEdgeSides(row, col, n - 1, coarseWest, coarseEast, coarseNorth, coarseSouth);
    if (!flatX && !flatZ) return chunk.heights[row * n + col]!;
    if (flatX && flatZ) return chunk.heights[row * n + col]!;

    const x = originX + col * step;
    const z = originZ + row * step;
    if (flatX) return chordHeight(sampleColumn, 'z', x, z, onWest ? neighbourSteps.west : neighbourSteps.east);
    return chordHeight(sampleColumn, 'x', x, z, onNorth ? neighbourSteps.north : neighbourSteps.south);
  };
  /**
   * A neighbour sample for the normal's finite difference, one step off
   * (row, col) — possibly past the chunk's own 33x33 array. Clamping the
   * index into range and still dividing by the full `2 * step` (as this used
   * to) turns a two-sided difference into a one-sided one at every chunk's
   * outer ring without halving the denominator to match — the slope came out
   * half its true value for any node on a chunk's own edge, which #559's
   * dense boundary walk caught once chunks (rather than one huge tile) put an
   * array edge within a couple of metres of the playable rect on every side.
   * Sampling straight from the height field past the edge keeps both sides of
   * the difference genuine, at the true `step` spacing, with no denominator
   * mismatch — consistent with `shadingNormalAt`'s own rule that slope reads
   * the live/theoretical field, never a flat-edge-adjusted or clamped value.
   */
  const neighbourHeightAt = (row: number, col: number): number => {
    if (row >= 0 && row <= n - 1 && col >= 0 && col <= n - 1) return nodeHeightAt(row, col);
    return sampleColumn(originX + col * step, originZ + row * step).height;
  };

  /**
   * Slope at a chunk-own-lattice node, honoring the ladder's flat-edge rule
   * the same way `nodeHeightAt` honors it for position (#1153 ladder rung
   * joins). On a side whose neighbour samples coarser, BOTH derivatives use
   * that neighbour's own step — not this chunk's native one — sampled
   * straight from the height field around (x, z). That reproduces, digit for
   * digit, the exact central difference the coarser neighbour's own node at
   * this shared position computes nativelly for itself: same field, same two
   * bracket points, same spacing. Differencing at each side's own native step
   * instead does agree on POSITION (both take the same chorded height) but
   * not on SLOPE the moment the field carries curvature at a wavelength
   * shorter than the coarser step — the two sides then measure genuinely
   * different local slopes of the same curve, and light the node they share
   * differently (up to tens of degrees on this fixture's ridged terrain).
   * Corners (flatX && flatZ) fall through to the interior/native-step case
   * below, unaddressed here, like `nodeHeightAt`'s own corner rule.
   */
  const nodeNormalAt = (row: number, col: number, x: number, z: number): [number, number, number] => {
    const { onWest, onNorth, flatX, flatZ } =
      flatEdgeSides(row, col, n - 1, coarseWest, coarseEast, coarseNorth, coarseSouth);
    if (flatX !== flatZ) {
      const nStep = flatX
        ? (onWest ? neighbourSteps.west : neighbourSteps.east)
        : (onNorth ? neighbourSteps.north : neighbourSteps.south);
      const dhdx = (sampleColumn(x + nStep, z).height - sampleColumn(x - nStep, z).height) / (2 * nStep);
      const dhdz = (sampleColumn(x, z + nStep).height - sampleColumn(x, z - nStep).height) / (2 * nStep);
      return heightFieldNormal(dhdx, dhdz);
    }
    const dhdx = (neighbourHeightAt(row, col + 1) - neighbourHeightAt(row, col - 1)) / (2 * step);
    const dhdz = (neighbourHeightAt(row + 1, col) - neighbourHeightAt(row - 1, col)) / (2 * step);
    return heightFieldNormal(dhdx, dhdz);
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const rockA: number[] = [];
  const rockB: number[] = [];
  const rockWeight: number[] = [];
  const ore: number[] = []; // (id, amt) pairs; landscape never carries ore (#458 A18)

  for (let row = 0; row < n; row++) {
    const z = originZ + row * step;
    for (let col = 0; col < n; col++) {
      const x = originX + col * step;
      const idx = row * n + col;
      const y = nodeHeightAt(row, col);
      positions.push(x, y, z);

      const normal = nodeNormalAt(row, col, x, z);
      normals.push(normal[0], normal[1], normal[2]);

      const blend = rockBlendFor(palette, chunk.surfCompIds[idx]!);
      rockA.push(blend.rockA);
      rockB.push(blend.rockB);
      rockWeight.push(blend.weight);
      ore.push(-1, 0);
    }
  }

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
  /** True when the WITHIN-CHUNK quad at (x0, z0) stays at the chunk's own step (not subdivided). */
  const isCoarserQuad = (x0: number, z0: number): boolean => classAt(x0, z0) === 'outside';

  const indices: number[] = [];
  for (let row = 0; row < n - 1; row++) {
    const z0 = originZ + row * step, z1 = z0 + step;
    for (let col = 0; col < n - 1; col++) {
      const x0 = originX + col * step, x1 = x0 + step;
      if (touchesRect) {
        const cls = classAt(x0, z0);
        if (cls === 'inside') continue;
        if (cls === 'boundary') {
          // A quad on the chunk's own outer ring also faces the cross-chunk
          // ladder neighbour on that side — take whichever of the two
          // (within-chunk step-transition, cross-chunk NeighbourSteps) is
          // coarser, since either alone can force the flat-edge rule.
          const westStep = Math.max(
            isCoarserQuad(x0 - step, z0) ? step : FINE_STEP,
            col === 0 ? neighbourSteps.west : FINE_STEP,
          );
          const eastStep = Math.max(
            isCoarserQuad(x1, z0) ? step : FINE_STEP,
            col === n - 2 ? neighbourSteps.east : FINE_STEP,
          );
          const northStep = Math.max(
            isCoarserQuad(x0, z0 - step) ? step : FINE_STEP,
            row === 0 ? neighbourSteps.north : FINE_STEP,
          );
          const southStep = Math.max(
            isCoarserQuad(x0, z1) ? step : FINE_STEP,
            row === n - 2 ? neighbourSteps.south : FINE_STEP,
          );
          buildBoundaryQuad(
            positions, normals, rockA, rockB, rockWeight, ore, indices,
            x0, z0, x1, z1, sampleColumn, palette, playable,
            { west: westStep, east: eastStep, north: northStep, south: southStep },
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

  const mesh = new THREE.Mesh(geometry);
  mesh.frustumCulled = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class LandscapeMesh {
  private readonly meshesByChunk = new Map<string, THREE.Mesh>();

  constructor(private readonly scene: THREE.Scene, private readonly material: THREE.Material) {}

  /** Total mesh count (one per resident chunk) — diagnostics and tests. */
  get meshCount(): number { return this.meshesByChunk.size; }

  /**
   * Every resident chunk mesh, for raycasting past the site's claimed edge
   * (#558) — mirrors TerrainMesh.meshes so a caller can raycast both without
   * knowing which one it hit.
   */
  get meshes(): THREE.Mesh[] { return Array.from(this.meshesByChunk.values()); }

  /**
   * Builds (or rebuilds) chunk `id`'s mesh against its live neighbour steps
   * and adds it to the scene, replacing the old whole-map `build()` (#1153)
   * — a chunk streamer calls this per-chunk as the camera moves instead of
   * rebuilding every tile on any site change.
   *
   * `cut` defaults to the handle's own generation-time rect, for callers with
   * no live site to cut against (tests, and any level that never expands).
   */
  buildChunk(
    id: LandscapeChunkId, handle: LandscapeHandle, palette: CompositionPalette,
    neighbourSteps: NeighbourSteps, cut?: PlayableCut,
  ): void {
    this.disposeChunk(id);
    const chunk = handle.map.getChunk(id);
    const playable = cut ?? rectCut(handle.playableRect);
    const mesh = buildChunkMesh(chunk, neighbourSteps, palette, playable, handle.sampleColumn);
    if (!mesh) return;
    mesh.material = this.material;
    this.scene.add(mesh);
    this.meshesByChunk.set(chunkKey(id), mesh);
  }

  /** Removes and disposes chunk `id`'s mesh, if resident. */
  disposeChunk(id: LandscapeChunkId): void {
    const key = chunkKey(id);
    const mesh = this.meshesByChunk.get(key);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    this.meshesByChunk.delete(key);
  }

  /** Removes and disposes every resident chunk mesh. */
  dispose(): void {
    for (const mesh of this.meshesByChunk.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshesByChunk.clear();
  }
}
