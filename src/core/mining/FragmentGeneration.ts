// BlastSimulator2026 — Blast step 3: carving broken rock into fragments
//
// Every broken voxel is diced into sub-cells, a number of seed points are
// scattered through the blast, and each sub-cell joins its nearest seed. The
// clusters that fall out are the fragments: irregular, multi-voxel where the
// rock barely broke, small and numerous where the charge was violent.
//
// Fragment size follows from the blast alone. A voxel that barely reached its
// threshold usually contributes no seed at all, so its rock is swallowed by a
// neighbouring cluster and comes out as one big boulder; a voxel next to the
// charge contributes several, and shatters. There is no fragment budget — the
// only cap is a guard against pathological input — because size is the player's
// feedback on their blast design, not a performance dial. Physics cost is capped
// separately by grouping fragments into projectiles.
//
// See the gameplay-blast-system skill, "Step 3 — Carving Fragments".

import type { Random } from '../math/Random.js';
import { vec3, type Vec3 } from '../math/Vec3.js';
import type { VoxelGrid, VoxelRockComposition } from '../world/VoxelGrid.js';
import { getRock } from '../world/RockCatalog.js';
import {
  SUB_CELL_RESOLUTION,
  SEEDS_BASE,
  SEEDS_PER_INTENSITY,
  MAX_SEEDS_PER_VOXEL,
  SEED_SEARCH_RADIUS,
  MAX_ORPHAN_COMPONENT_SUBCELLS,
  MAX_FRAGMENTS_PER_BLAST,
  FRAGMENTATION_MULTIPLIER,
} from '../config/balance.js';
import { type EnergyField, intensityAt } from './EnergyPropagation.js';
import type { FragmentationResult, VoxelCoord } from './VoxelFragmentation.js';
import {
  computeAverageRockComposition,
  computeAverageOreDensities,
  dominantRockOf,
  type VoxelContribution,
} from './FragmentComposition.js';

const SUB = SUB_CELL_RESOLUTION;
const SUB_CELL_SIZE = 1 / SUB;
const SUB_CELL_VOLUME = SUB_CELL_SIZE ** 3;

/** A fragment as generated: geometry plus everything hauling and rendering need. */
export interface GeneratedFragment {
  /** Centre of mass, in world voxel coordinates. */
  origin: Vec3;
  /** Half-extents of the cluster's bounding box — the fragment's rough shape. */
  halfExtents: Vec3;
  volumeM3: number;
  massKg: number;
  composition: VoxelRockComposition;
  oreDensities: Record<string, number>;
  rockId: string;
  /** The voxels this fragment was carved from, weighted by how much it took. */
  sources: VoxelContribution[];
  /** Stable per-fragment randomness for shape variants and tumble. */
  shapeSeed: number;
}

export interface FragmentGenerationResult {
  fragments: GeneratedFragment[];
  /** True when the seed rate had to be throttled to stay under the guard. */
  throttled: boolean;
}

/** How many seed points a voxel contributes, given how hard it was hit. */
export function seedCountForIntensity(intensity: number, rng: Random): number {
  const expected = SEEDS_BASE + SEEDS_PER_INTENSITY * Math.max(0, intensity - FRAGMENTATION_MULTIPLIER);
  const whole = Math.floor(expected);
  const remainder = expected - whole;
  const count = whole + (rng.chance(remainder) ? 1 : 0);
  return Math.min(MAX_SEEDS_PER_VOXEL, Math.max(0, count));
}

/**
 * Carve the broken voxels into fragments.
 *
 * Sub-cells are assigned to the nearest seed within `SEED_SEARCH_RADIUS`; rock
 * with no seed in range forms its own connected lumps, which is where the big
 * boulders of an undercharged blast come from.
 */
export function generateFragments(
  fragmentation: FragmentationResult,
  field: EnergyField,
  grid: VoxelGrid,
  rng: Random,
): FragmentGenerationResult {
  const voxels = fragmentation.fragmented;
  if (voxels.length === 0) return { fragments: [], throttled: false };

  // Index the broken voxels so sub-cell work can look them up by coordinate.
  const voxelIndex = new Map<number, number>();
  for (let i = 0; i < voxels.length; i++) {
    voxelIndex.set(voxelKey(voxels[i]!), i);
  }

  const { seeds, seedsByVoxel, throttled } = scatterSeeds(voxels, field, rng);

  // Assign every sub-cell of every broken voxel to its nearest seed.
  const subCellsPerVoxel = SUB ** 3;
  const owner = new Int32Array(voxels.length * subCellsPerVoxel).fill(-1);

  // Seeds flattened into typed arrays: the assignment loop below touches them
  // for every sub-cell of every broken voxel, and chasing a Vec3 per read was
  // one of the blast's hottest paths.
  const seedX = new Float64Array(seeds.length);
  const seedY = new Float64Array(seeds.length);
  const seedZ = new Float64Array(seeds.length);
  for (let i = 0; i < seeds.length; i++) {
    seedX[i] = seeds[i]!.x;
    seedY[i] = seeds[i]!.y;
    seedZ[i] = seeds[i]!.z;
  }

  // All 64 sub-cells of a voxel search the same shells, so the seed lists per
  // shell are gathered once per voxel and reused, not re-fetched per sub-cell —
  // and gathered lazily, because a sub-cell with a seed in its own voxel never
  // looks at the outer shells at all.
  const shellSeeds: (number[] | null)[] = new Array(SEED_SEARCH_RADIUS + 1);

  for (let vi = 0; vi < voxels.length; vi++) {
    const voxel = voxels[vi]!;
    shellSeeds.fill(null);
    const ensureShell = (r: number): number[] => {
      const cached = shellSeeds[r];
      if (cached) return cached;
      const shell = SHELL_OFFSETS[r]!;
      const list: number[] = [];
      for (let o = 0; o < shell.length; o += 3) {
        const indices = seedsByVoxel.get(voxelKeyOf(voxel.x + shell[o]!, voxel.y + shell[o + 1]!, voxel.z + shell[o + 2]!));
        if (indices) for (const si of indices) list.push(si);
      }
      shellSeeds[r] = list;
      return list;
    };

    for (let s = 0; s < subCellsPerVoxel; s++) {
      const sx = s % SUB;
      const sy = Math.floor(s / SUB) % SUB;
      const sz = Math.floor(s / (SUB * SUB));
      owner[vi * subCellsPerVoxel + s] = nearestSeed(
        voxel.x + (sx + 0.5) * SUB_CELL_SIZE,
        voxel.y + (sy + 0.5) * SUB_CELL_SIZE,
        voxel.z + (sz + 0.5) * SUB_CELL_SIZE,
        ensureShell, seedX, seedY, seedZ,
      );
    }
  }

  // Cluster by seed, then sweep up whatever no seed claimed.
  const clusters = new Map<number, number[]>();
  const orphans: number[] = [];
  for (let k = 0; k < owner.length; k++) {
    const seedIdx = owner[k]!;
    if (seedIdx < 0) { orphans.push(k); continue; }
    const bucket = clusters.get(seedIdx);
    if (bucket) bucket.push(k);
    else clusters.set(seedIdx, [k]);
  }

  const fragments: GeneratedFragment[] = [];
  // Sorted so fragment order depends on the seeds, not on Map insertion order.
  for (const seedIdx of [...clusters.keys()].sort((a, b) => a - b)) {
    const fragment = buildFragment(clusters.get(seedIdx)!, voxels, grid, rng);
    if (fragment) fragments.push(fragment);
  }
  for (const component of splitOrphanComponents(orphans, voxels, voxelIndex)) {
    const fragment = buildFragment(component, voxels, grid, rng);
    if (fragment) fragments.push(fragment);
  }

  return { fragments, throttled };
}

// ── Seeds ────────────────────────────────────────────────────────────────────

interface SeedScatter {
  seeds: Vec3[];
  /** Voxel key → indices of the seeds sampled inside it. */
  seedsByVoxel: Map<number, number[]>;
  throttled: boolean;
}

function scatterSeeds(voxels: readonly VoxelCoord[], field: EnergyField, rng: Random): SeedScatter {
  const seeds: Vec3[] = [];
  const seedsByVoxel = new Map<number, number[]>();
  let throttled = false;

  for (const voxel of voxels) {
    // The guard exists for pathological input, never as a balance dial: once it
    // trips, stop adding seeds rather than dropping rock, so the volume still
    // comes out whole — as fewer, larger fragments.
    if (seeds.length >= MAX_FRAGMENTS_PER_BLAST) { throttled = true; break; }

    const count = seedCountForIntensity(intensityAt(field, voxel.x, voxel.y, voxel.z), rng);
    if (count === 0) continue;

    const key = voxelKey(voxel);
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      indices.push(seeds.length);
      seeds.push(vec3(
        voxel.x + rng.nextFloat(0, 1),
        voxel.y + rng.nextFloat(0, 1),
        voxel.z + rng.nextFloat(0, 1),
      ));
    }
    seedsByVoxel.set(key, indices);
  }

  return { seeds, seedsByVoxel, throttled };
}

/**
 * Index of the seed nearest to `point`, searching outward a voxel at a time.
 *
 * Returns -1 when no seed lies within `SEED_SEARCH_RADIUS` — that rock belongs
 * to no fragment yet and is handled as an orphan.
 */
/**
 * Voxel offsets making up each search shell, precomputed once. The naive way —
 * sweeping the whole (2r+1)³ cube and skipping non-shell entries — repeats that
 * skip for every sub-cell of every broken voxel, millions of times a blast.
 */
const SHELL_OFFSETS: ReadonlyArray<readonly number[]> = (() => {
  const shells: number[][] = [];
  for (let r = 0; r <= SEED_SEARCH_RADIUS; r++) {
    const shell: number[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
          shell.push(dx, dy, dz);
        }
      }
    }
    shells.push(shell);
  }
  return shells;
})();

function nearestSeed(
  px: number,
  py: number,
  pz: number,
  ensureShell: (r: number) => readonly number[],
  seedX: Float64Array,
  seedY: Float64Array,
  seedZ: Float64Array,
): number {
  let best = -1;
  let bestDist = Infinity;

  for (let r = 0; r <= SEED_SEARCH_RADIUS; r++) {
    for (const si of ensureShell(r)) {
      const ddx = seedX[si]! - px;
      const ddy = seedY[si]! - py;
      const ddz = seedZ[si]! - pz;
      const d = ddx * ddx + ddy * ddy + ddz * ddz;
      // Ties go to the lower index so the result never depends on
      // iteration order.
      if (d < bestDist || (d === bestDist && si < best)) { bestDist = d; best = si; }
    }
    // A seed one shell out could still be closer than one found on this shell,
    // so only stop once the shell itself is further away than the best hit.
    if (best >= 0 && bestDist <= r * r) break;
  }

  return best;
}

// ── Orphans ──────────────────────────────────────────────────────────────────

/**
 * Break rock that no seed claimed into connected lumps.
 *
 * This is where an undercharged blast's boulders come from: a region whose
 * voxels were all too gently broken to contribute a seed stays joined, and comes
 * out as one oversized block the player has to send a rock breaker at.
 */
function splitOrphanComponents(
  orphans: readonly number[],
  voxels: readonly VoxelCoord[],
  voxelIndex: ReadonlyMap<number, number>,
): number[][] {
  if (orphans.length === 0) return [];

  const remaining = new Set(orphans);
  const components: number[][] = [];

  for (const start of orphans) {
    if (!remaining.has(start)) continue;

    // Breadth-first, so a lump grows outward evenly and comes out compact.
    // Depth-first would snake through the rock and produce stringy fragments
    // whose own centre of mass can fall outside them.
    const component: number[] = [];
    const queue = [start];
    remaining.delete(start);

    for (let head = 0; head < queue.length && component.length < MAX_ORPHAN_COMPONENT_SUBCELLS; head++) {
      const slot = queue[head]!;
      component.push(slot);

      for (const neighbour of subCellNeighbours(slot, voxels, voxelIndex)) {
        if (!remaining.has(neighbour)) continue;
        remaining.delete(neighbour);
        queue.push(neighbour);
      }
    }

    // Anything queued past the size cap goes back for its own lump.
    for (let i = component.length; i < queue.length; i++) remaining.add(queue[i]!);

    components.push(component);
  }

  return components;
}

/** The six face-adjacent sub-cells, wherever they live in the broken set. */
function subCellNeighbours(
  slot: number,
  voxels: readonly VoxelCoord[],
  voxelIndex: ReadonlyMap<number, number>,
): number[] {
  const subCellsPerVoxel = SUB ** 3;
  const vi = Math.floor(slot / subCellsPerVoxel);
  const s = slot % subCellsPerVoxel;
  const voxel = voxels[vi]!;
  const sx = s % SUB;
  const sy = Math.floor(s / SUB) % SUB;
  const sz = Math.floor(s / (SUB * SUB));

  const out: number[] = [];
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
    let nx = sx + dx, ny = sy + dy, nz = sz + dz;
    let vx = voxel.x, vy = voxel.y, vz = voxel.z;

    // Stepping off one side of a voxel lands in its neighbour.
    if (nx < 0) { nx = SUB - 1; vx--; } else if (nx >= SUB) { nx = 0; vx++; }
    if (ny < 0) { ny = SUB - 1; vy--; } else if (ny >= SUB) { ny = 0; vy++; }
    if (nz < 0) { nz = SUB - 1; vz--; } else if (nz >= SUB) { nz = 0; vz++; }

    const ni = voxelIndex.get(voxelKeyOf(vx, vy, vz));
    if (ni === undefined) continue;
    out.push(ni * subCellsPerVoxel + (nx + SUB * (ny + SUB * nz)));
  }
  return out;
}

// ── Building a fragment ──────────────────────────────────────────────────────

function buildFragment(
  slots: readonly number[],
  voxels: readonly VoxelCoord[],
  grid: VoxelGrid,
  rng: Random,
): GeneratedFragment | null {
  if (slots.length === 0) return null;

  const subCellsPerVoxel = SUB ** 3;
  let sumX = 0, sumY = 0, sumZ = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const subCellsPerSource = new Map<number, number>();

  const half = SUB_CELL_SIZE / 2;
  for (const slot of slots) {
    const vi = Math.floor(slot / subCellsPerVoxel);
    const voxel = voxels[vi]!;
    const sc = slot % subCellsPerVoxel;
    const cx = voxel.x + ((sc % SUB) + 0.5) * SUB_CELL_SIZE;
    const cy = voxel.y + ((Math.floor(sc / SUB) % SUB) + 0.5) * SUB_CELL_SIZE;
    const cz = voxel.z + (Math.floor(sc / (SUB * SUB)) + 0.5) * SUB_CELL_SIZE;

    sumX += cx; sumY += cy; sumZ += cz;
    if (cx - half < minX) minX = cx - half;
    if (cy - half < minY) minY = cy - half;
    if (cz - half < minZ) minZ = cz - half;
    if (cx + half > maxX) maxX = cx + half;
    if (cy + half > maxY) maxY = cy + half;
    if (cz + half > maxZ) maxZ = cz + half;

    subCellsPerSource.set(vi, (subCellsPerSource.get(vi) ?? 0) + 1);
  }

  const n = slots.length;
  const sources: VoxelContribution[] = [...subCellsPerSource.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vi, count]) => ({ ...voxels[vi]!, weight: count * SUB_CELL_VOLUME }));

  const composition = computeAverageRockComposition(sources, grid);
  const oreDensities = computeAverageOreDensities(sources, grid);

  let density = 0;
  for (const rock of composition.rocks) {
    const def = getRock(rock.rockId);
    if (def) density += rock.coefficient * def.density;
  }

  const volumeM3 = n * SUB_CELL_VOLUME;

  return {
    origin: vec3(sumX / n, sumY / n, sumZ / n),
    halfExtents: vec3((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2),
    volumeM3,
    massKg: volumeM3 * density,
    composition,
    oreDensities,
    rockId: dominantRockOf(composition),
    sources,
    shapeSeed: rng.nextInt(0, 0x7fffffff),
  };
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** Centre of sub-cell `s` (0 … SUB³-1) inside a voxel, in world coordinates. */
/**
 * Pack a voxel coordinate into one number for map keys.
 * Offset keeps negative coordinates positive; the span covers any playable site.
 */
const KEY_OFFSET = 1024;
const KEY_SPAN = 4096;

function voxelKeyOf(x: number, y: number, z: number): number {
  return ((x + KEY_OFFSET) * KEY_SPAN + (y + KEY_OFFSET)) * KEY_SPAN + (z + KEY_OFFSET);
}

function voxelKey(voxel: VoxelCoord): number {
  return voxelKeyOf(voxel.x, voxel.y, voxel.z);
}
