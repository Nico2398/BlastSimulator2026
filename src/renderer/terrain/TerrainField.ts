// BlastSimulator2026 — The terrain's density field, as marching cubes reads it
// Split from TerrainMesh.ts (#1603): the per-corner and per-normal samplers,
// and ChunkFieldCache, which samples them once per chunk instead of once per
// cube that touches them.

import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import { surfaceDensityAt } from '../../core/world/TerrainGen.js';
import { haloSurfaceHeight } from './PlayableCoverage.js';

export type EdgeHeightSampler = (x: number, z: number) => number;

/**
 * Density for a column TerrainMesh does not own, standing in the neighbouring
 * landscape's ground where the grid has nothing (#559 for normals, #907 for
 * geometry).
 *
 * This is `TerrainGen.surfaceDensityAt` — literally the function the core fills
 * a real column with — not a look-alike beside it. That matters twice over.
 * The obvious reason is that the halo column then reads exactly as if the grid
 * owned it, so nothing about the mesh changes character at the site edge. The
 * sharper one is the band width: `surfaceDensityAt` ramps over two voxels
 * precisely so that the two samples straddling the surface are both unclamped
 * and marching cubes' linear crossing lands on the height exactly. The one-
 * voxel ramp this used to carry (`surfaceHeight + 0.5 - y`) always clamps on
 * one side of the crossing, which bends it by up to 8.6 cm — tolerable when it
 * only tilted a normal, a visible step once it decides where the ground is.
 */
export function virtualEdgeDensity(surfaceHeight: number, y: number): number {
  return surfaceDensityAt(y, surfaceHeight);
}

/** Per-corner samples used both for the surface threshold and the emitted vertex attributes. */
export interface CornerSample {
  density: number;
  rockId: string;
  /** Highest-density ore id at this corner, or '' if none. */
  oreId: string;
  oreAmt: number;
}

/**
 * Density at one integer lattice corner: the grid's own where it owns the
 * column, and the neighbouring landscape's ground where it does not.
 *
 * Geometry and normals read the SAME field. #559 extended the field past the
 * site for normals only, on the reasoning that topology should stay the grid's
 * business — but that left the halo cube marching solid rock against air, so
 * the mesh's outer boundary fell on the x/z-edge crossings roughly half a metre
 * inside the halo and a voxel below the surface, while the landscape stopped a
 * full metre out. The half-metre of ground between them belonged to nobody, and
 * that slot, with the step at its lip, is the gap #907 reports. Filling the halo
 * column with the neighbouring ground instead puts the outermost vertex on the
 * halo node itself, at exactly the height the landscape samples there, so the
 * two sheets share that node (see `virtualEdgeDensity`).
 *
 * With no sampler installed — tests, and any caller with no landscape — an
 * unowned column reads as air exactly as before.
 */
function cornerDensityForNormal(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): number {
  const virtual = virtualColumnDensity(grid, sampler, x, y, z);
  return virtual ?? grid.densityAt(x, y, z);
}

/** The landscape-ground density standing in for an unowned column at (x, y, z),
 *  or null when the grid owns the column or no sampler can answer for it. */
function virtualColumnDensity(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): number | null {
  const height = columnVirtualHeight(grid, sampler, x, z);
  return Number.isNaN(height) ? null : virtualEdgeDensity(height, y);
}

/** The ground height an unowned column stands in for, or NaN when the grid owns
 *  the column or no sampler can answer for it — the per-column half of
 *  `virtualColumnDensity`, shared by every height in the column. */
function columnVirtualHeight(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, z: number): number {
  if (!sampler || grid.containsColumn(x, z)) return NaN;
  const height = haloSurfaceHeight(grid, sampler(x, z));
  return Number.isFinite(height) ? height : NaN;
}

/** Density at an integer lattice corner. */
type LatticeDensity = (x: number, y: number, z: number) => number;

/** Density with trilinear interpolation, so the gradient below is continuous. */
function densityAtSmooth(density: LatticeDensity, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  let acc = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
    if (w > 0) acc += w * density(x0 + dx, y0 + dy, z0 + dz);
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
 *
 * Exported because the landscape has to light the ring node it SHARES with this
 * mesh exactly the way this mesh lights it. #907 made both sheets take that
 * node's height from one authority; its normal was still derived twice, once
 * from this gradient and once from the landscape's own height-field slope, and
 * the two disagree by ~7 degrees on real ground. A normal that jumps across a
 * shared edge is a lighting crease, and this edge runs the site's whole
 * perimeter (#1077).
 */
export function densityGradientNormal(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): [number, number, number] {
  const density: LatticeDensity = (cx, cy, cz) => cornerDensityForNormal(grid, sampler, cx, cy, cz);
  return gradientNormalOf((px, py, pz) => densityAtSmooth(density, px, py, pz), x, y, z);
}

/** `densityGradientNormal` over any smooth density — the one formula the direct and the cached field share. */
function gradientNormalOf(smooth: LatticeDensity, x: number, y: number, z: number): [number, number, number] {
  const e = 0.85;
  const gx = smooth(x + e, y, z) - smooth(x - e, y, z);
  const gy = smooth(x, y + e, z) - smooth(x, y - e, z);
  const gz = smooth(x, y, z + e) - smooth(x, y, z - e);
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

/** Everything marching cubes reads at one lattice corner: density, rock and dominant ore. */
export function sampleCorner(grid: VoxelGrid, sampler: EdgeHeightSampler | null, x: number, y: number, z: number): CornerSample {
  return cornerSampleAt(grid, columnVirtualHeight(grid, sampler, x, z), x, y, z);
}

/** `sampleCorner` with the column's `columnVirtualHeight` already in hand. */
function cornerSampleAt(grid: VoxelGrid, virtualHeight: number, x: number, y: number, z: number): CornerSample {
  if (!Number.isNaN(virtualHeight)) {
    const virtual = virtualEdgeDensity(virtualHeight, y);
    // Ground beside the site: the landscape carries no ore (#458 A18), and its
    // rock comes from the nearest owned column at the same height rather than
    // from the sampler. Both sheets read one strata pipeline, so a column one
    // metre apart resolves to the same surface rock in all but a stratum
    // contour's own width — and it is the rock already drawn a metre inside the
    // edge, so the halo cannot introduce a colour break the site does not
    // already have. An air corner keeps rockId '' and inherits from the other
    // end of its edge, exactly as an out-of-grid corner does today.
    return { density: virtual, rockId: nearestOwnedRock(grid, x, y, z), oreId: '', oreAmt: 0 };
  }
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

/** Dominant rock at the owned column nearest (x, z), same y — '' when that
 *  column is air there or the site owns nothing at all. */
function nearestOwnedRock(grid: VoxelGrid, x: number, y: number, z: number): string {
  const cx = Math.max(grid.minX, Math.min(grid.maxX - 1, x));
  const cz = Math.max(grid.minZ, Math.min(grid.maxZ - 1, z));
  return grid.dominantRockAt(cx, y, cz);
}

/** Corner offsets (dx, dy, dz) of a marching cube, in the order its case index's bits use. */
export const CUBE_CORNER_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** Inclusive lattice box, in voxel coordinates. */
export interface LatticeBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/**
 * The density field around one chunk, sampled once (#1603).
 *
 * Marching cubes reads every lattice corner from each of the up to eight cubes
 * sharing it, and the field normals re-read the same corners through a
 * trilinear blend — around fifty density reads per emitted vertex. On a blast
 * that re-marches a dozen chunks this was most of the remesh, and the
 * landscape height behind each halo column (a full noise evaluation) was
 * re-sampled for every height in that column. This holds each column's halo
 * height once, the density at every corner of `box` padded by one (the reach
 * of a normal's ±0.85 blend), and each corner's rock and ore once asked for.
 *
 * Every value is the direct functions' own — `sampleCorner` and
 * `densityGradientNormal` — by the same arithmetic, so a mesh marched from the
 * cache is bit-identical to one marched without it. A read outside the padded
 * box falls through to the direct functions.
 */
export class ChunkFieldCache {
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  /** Per padded column (x fastest): `columnVirtualHeight`, NaN for an owned column. */
  private readonly columnHeight: Float64Array;
  /** Per padded corner: x fastest, then y, then z. */
  private readonly density: Float64Array;
  private readonly samples: (CornerSample | undefined)[];
  /** Linear index step of each cube corner (CUBE_CORNER_OFFSETS) within `density`. */
  private readonly cubeCornerStep: Int32Array;
  private readonly latticeDensity: LatticeDensity = (x, y, z) => this.densityAt(x, y, z);
  private readonly smoothDensity: LatticeDensity = (x, y, z) => this.smoothAt(x, y, z);

  constructor(
    private readonly grid: VoxelGrid,
    private readonly sampler: EdgeHeightSampler | null,
    box: LatticeBox,
  ) {
    this.ox = box.minX - 1;
    this.oy = box.minY - 1;
    this.oz = box.minZ - 1;
    this.nx = box.maxX - box.minX + 3;
    this.ny = box.maxY - box.minY + 3;
    this.nz = box.maxZ - box.minZ + 3;
    this.columnHeight = new Float64Array(this.nx * this.nz);
    this.density = new Float64Array(this.nx * this.ny * this.nz);
    this.samples = new Array<CornerSample | undefined>(this.density.length);
    this.cubeCornerStep = Int32Array.from(CUBE_CORNER_OFFSETS, ([dx, dy, dz]) => (dz * this.ny + dy) * this.nx + dx);
    for (let k = 0; k < this.nz; k++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.ox + i, z = this.oz + k;
        const height = columnVirtualHeight(grid, sampler, x, z);
        this.columnHeight[k * this.nx + i] = height;
        const owned = Number.isNaN(height);
        for (let j = 0; j < this.ny; j++) {
          const y = this.oy + j;
          this.density[(k * this.ny + j) * this.nx + i] = owned ? grid.densityAt(x, y, z) : virtualEdgeDensity(height, y);
        }
      }
    }
  }

  /** `cornerDensityForNormal` at a lattice corner. */
  densityAt(x: number, y: number, z: number): number {
    const idx = this.indexOf(x, y, z);
    return idx < 0 ? cornerDensityForNormal(this.grid, this.sampler, x, y, z) : this.density[idx]!;
  }

  /** `sampleCorner` at a lattice corner. */
  corner(x: number, y: number, z: number): CornerSample {
    const idx = this.indexOf(x, y, z);
    if (idx < 0) return sampleCorner(this.grid, this.sampler, x, y, z);
    let sample = this.samples[idx];
    if (sample === undefined) {
      sample = cornerSampleAt(this.grid, this.columnHeight[(z - this.oz) * this.nx + (x - this.ox)]!, x, y, z);
      this.samples[idx] = sample;
    }
    return sample;
  }

  /** Marching-cubes case of the cube whose low corner is (x, y, z): bit i set when corner i (CUBE_CORNER_OFFSETS) is at or above `threshold`. */
  cubeIndex(x: number, y: number, z: number, threshold: number): number {
    const base = this.indexOf(x, y, z);
    let index = 0;
    if (base >= 0 && this.indexOf(x + 1, y + 1, z + 1) >= 0) {
      for (let i = 0; i < 8; i++) if (this.density[base + this.cubeCornerStep[i]!]! >= threshold) index |= 1 << i;
      return index;
    }
    for (let i = 0; i < 8; i++) {
      const [dx, dy, dz] = CUBE_CORNER_OFFSETS[i]!;
      if (this.densityAt(x + dx, y + dy, z + dz) >= threshold) index |= 1 << i;
    }
    return index;
  }

  /** `densityGradientNormal` at any point. */
  normal(x: number, y: number, z: number): [number, number, number] {
    return gradientNormalOf(this.smoothDensity, x, y, z);
  }

  /** `densityAtSmooth` over the cached corners — the same blend, read straight from the array. */
  private smoothAt(x: number, y: number, z: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const base = this.indexOf(x0, y0, z0);
    if (base < 0 || this.indexOf(x0 + 1, y0 + 1, z0 + 1) < 0) return densityAtSmooth(this.latticeDensity, x, y, z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const sy = this.nx, sz = this.nx * this.ny;
    let acc = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      if (w > 0) acc += w * this.density[base + dx + dy * sy + dz * sz]!;
    }
    return acc;
  }

  private indexOf(x: number, y: number, z: number): number {
    const i = x - this.ox, j = y - this.oy, k = z - this.oz;
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return (k * this.ny + j) * this.nx + i;
  }
}
