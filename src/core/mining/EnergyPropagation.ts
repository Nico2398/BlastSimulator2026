// BlastSimulator2026 — Blast step 1: energy propagation through the voxel grid
//
// Each charged hole spreads its energy through the rock around it. A voxel
// receives a share that falls off exponentially with its distance to the
// charge, measured through rock (`BLAST_ENERGY_DECAY_M`): air carries nothing,
// so a void shields whatever is behind it, and every joule of a hole ends up in
// rock it can reach. Shares from different holes add up. That is what makes the
// drill pattern a design choice: holes close together overlap and fill the rock
// evenly, holes far apart leave a hot core round each hole and cold rock between.
//
// A voxel breaks when what it received reaches its threshold (its rock, made
// cheaper near a free face); how far past the threshold it went is how finely it
// breaks (`intensityAt`), and the excess is what can throw it.
//
// Everything runs on flat typed arrays over the blast's bounding box: a blast
// touches tens of thousands of voxels, so per-voxel object or string-key
// allocation is the one thing this must not do.
//
// See the gameplay-blast-system skill, "Step 1 — Energy Propagation".

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { drain, type Steps } from '../engine/Steps.js';
import { getRock } from '../world/RockCatalog.js';
import { chargeKgPerMetre } from './HoleDiameter.js';
import {
  BLAST_GRADE_FLOOR_OFFSET_M,
  BLAST_ENERGY_DECAY_M,
  BLAST_ENERGY_REACH_M,
  UNCONFINED_THRESHOLD_FACTOR,
  CONFINEMENT_FULL_DEPTH,
  BLAST_SLICE_CELLS,
} from '../config/balance.js';

// ── Geometry ────────────────────────────────────────────────────────────────

/** Half-open voxel box: `min` inclusive, `max` exclusive, in world voxel coords. */
export interface BlastBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/**
 * Clip a box to the columns the site actually owns. Returns null if nothing is left.
 *
 * Only X/Z are clipped: a column has no vertical cap, so Y passes through unclamped.
 */
export function clampBoxToGrid(box: BlastBox, grid: VoxelGrid): BlastBox | null {
  const clamped: BlastBox = {
    minX: Math.max(box.minX, grid.minX),
    minY: box.minY,
    minZ: Math.max(box.minZ, grid.minZ),
    maxX: Math.min(box.maxX, grid.maxX),
    maxY: box.maxY,
    maxZ: Math.min(box.maxZ, grid.maxZ),
  };
  if (clamped.maxX <= clamped.minX || clamped.maxY <= clamped.minY || clamped.maxZ <= clamped.minZ) return null;
  return clamped;
}

// ── Field ───────────────────────────────────────────────────────────────────

/**
 * The 26-neighbour offsets a distance through rock steps along, minus the 8
 * corner ones: face and edge neighbours only.
 *
 * Six face neighbours alone measure distance along grid axes, which produces
 * diamond-shaped craters. Adding the twelve edge neighbours (each a √2 step)
 * approximates a Euclidean distance closely enough that the crater reads as round.
 */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const out: Array<[number, number, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const manhattan = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (manhattan !== 1 && manhattan !== 2) continue;
        out.push([dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz)]);
      }
    }
  }
  return out;
})();

/** NEIGHBOUR_OFFSETS split into flat arrays for the propagation loop (#1603). */
const NEIGHBOUR_COUNT = NEIGHBOUR_OFFSETS.length;
const NEIGHBOUR_DX = Int32Array.from(NEIGHBOUR_OFFSETS, o => o[0]);
const NEIGHBOUR_DY = Int32Array.from(NEIGHBOUR_OFFSETS, o => o[1]);
const NEIGHBOUR_DZ = Int32Array.from(NEIGHBOUR_OFFSETS, o => o[2]);
/** Length (m) of the step to each neighbour. */
const NEIGHBOUR_DIST = Float64Array.from(NEIGHBOUR_OFFSETS, o => o[3]);

/**
 * Per-voxel blast state over one bounding box.
 *
 * A voxel's received energy is split in two: `effective`, the part up to its
 * threshold (what breaks it), and `overflowOut`, the excess beyond it (what
 * throws the resulting fragments). Their sum over the threshold is how hard the
 * voxel was hit (`intensityAt`).
 */
export interface EnergyField {
  readonly box: BlastBox;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Energy each voxel received, up to its threshold. */
  readonly effective: Float32Array;
  /** Energy each voxel received beyond its threshold. */
  readonly overflowOut: Float32Array;
  /** Absorption capacity of each voxel; 0 for air. */
  readonly threshold: Float32Array;
  /** 1 where the voxel is air (or not owned by the site), 0 where it is rock. */
  readonly air: Uint8Array;
  /** Metres from each voxel to the nearest free face; 0 for air itself. */
  readonly distAir: Float32Array;
  /** World Y of the highest charged-hole bottom (the blast's grade); null when nothing is charged. */
  gradeY: number | null;
  /** Total energy handed to `seedEnergy`. */
  seeded: number;
  /** Energy no rock kept: a charge in air, a hole with no rock in reach, or the share spent under a hole's bottom. */
  dissipated: number;
}

/** Flat index of a world coordinate. Callers must check `contains` first. */
export function indexOf(field: EnergyField, x: number, y: number, z: number): number {
  return (x - field.box.minX) + field.nx * ((y - field.box.minY) + field.ny * (z - field.box.minZ));
}

/** True when the world coordinate falls inside the field's box. */
export function contains(field: EnergyField, x: number, y: number, z: number): boolean {
  const { box } = field;
  return x >= box.minX && x < box.maxX
    && y >= box.minY && y < box.maxY
    && z >= box.minZ && z < box.maxZ;
}

/** Energy retained at a world coordinate, or 0 outside the field. */
export function effectiveAt(field: EnergyField, x: number, y: number, z: number): number {
  return contains(field, x, y, z) ? field.effective[indexOf(field, x, y, z)]! : 0;
}

/** Absorption capacity at a world coordinate, or 0 outside the field. */
export function thresholdAt(field: EnergyField, x: number, y: number, z: number): number {
  return contains(field, x, y, z) ? field.threshold[indexOf(field, x, y, z)]! : 0;
}

/** Energy received beyond the threshold at a world coordinate, or 0 outside the field. */
export function overflowAt(field: EnergyField, x: number, y: number, z: number): number {
  return contains(field, x, y, z) ? field.overflowOut[indexOf(field, x, y, z)]! : 0;
}

/** True when the voxel is air, not owned by the site, or outside the field. */
export function isAirAt(field: EnergyField, x: number, y: number, z: number): boolean {
  return !contains(field, x, y, z) || field.air[indexOf(field, x, y, z)] === 1;
}

/**
 * How hard a voxel was hit: the energy it received over what its rock can take.
 *
 * 1.0 means "just barely broke". Values well above that mean fine rubble; the
 * fragmentation bands (`FragmentationBand.ts`) name the ranges.
 */
export function intensityAt(field: EnergyField, x: number, y: number, z: number): number {
  if (!contains(field, x, y, z)) return 0;
  const i = indexOf(field, x, y, z);
  const threshold = field.threshold[i]!;
  if (threshold <= 0) return 0;
  return (field.effective[i]! + field.overflowOut[i]!) / threshold;
}

/**
 * Distance in metres from every voxel to the nearest air, by multi-source BFS
 * from all air cells at once.
 *
 * Rock at a free face has somewhere to go when the blast pushes it; rock deep in
 * the mass is confined by its neighbours and can only settle. That distinction
 * is what separates a fragment thrown across the pit from one that drops where
 * it stood, so it drives both fragment velocity and projection risk.
 *
 * Air cells read 0. Rock enclosed beyond the box edge reads the box diagonal.
 */
export function computeDistanceToAir(field: EnergyField): Float32Array {
  return field.distAir;
}

/** Fill `field.distAir` by multi-source BFS from every air cell, yielding every `BLAST_SLICE_CELLS` cells. */
function* fillDistanceToAir(field: EnergyField): Steps<void> {
  const { nx, ny } = field;
  const count = field.air.length;
  const far = nx + ny + field.nz;
  const dist = field.distAir;
  dist.fill(far);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < count; i++) {
    if ((i & (BLAST_SLICE_CELLS - 1)) === 0) yield;
    if (field.air[i] === 1) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  // The box edge borders rock we cannot see; treat it as confined, not open.
  while (head < tail) {
    if ((head & (BLAST_SLICE_CELLS - 1)) === 0) yield;
    const i = queue[head++]!;
    const d = dist[i]!;
    const lx = i % nx;
    const ly = Math.floor(i / nx) % ny;
    const lz = Math.floor(i / (nx * ny));

    for (const [dx, dy, dz] of FACE_STEPS) {
      const ax = lx + dx, ay = ly + dy, az = lz + dz;
      if (ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= field.nz) continue;
      const ni = ax + nx * (ay + ny * az);
      if (dist[ni]! <= d + 1) continue;
      dist[ni] = d + 1;
      queue[tail++] = ni;
    }
  }
}

const FACE_STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * Absorption capacity of one voxel: its rock mix weighted by each rock's
 * `energyAbsorption`, scaled by the fracture modifier so rock cracked by an
 * earlier blast gives way sooner.
 */
export function computeVoxelThreshold(grid: VoxelGrid, x: number, y: number, z: number): number {
  const { rocks } = grid.compositionAt(x, y, z);
  if (rocks.length === 0) return 0;
  let sum = 0;
  for (const rock of rocks) {
    const def = getRock(rock.rockId);
    if (def) sum += rock.coefficient * def.energyAbsorption;
  }
  return sum * grid.fractureAt(x, y, z);
}

/**
 * How much easier a voxel is to break for having a free face nearby.
 *
 * Rock deep in the mass is squeezed on all sides and has to be crushed in
 * place; rock near open air can shear and move, and gives way at a fraction of
 * the energy. This is the mechanism that makes bench blasting work at all — the
 * burden between the charge and the face fails toward the face — and without it
 * a charge just carves a sealed cavity underground and leaves the surface
 * standing, which is both wrong and invisible to the player.
 *
 * Returns 1.0 for fully confined rock, falling to
 * `UNCONFINED_THRESHOLD_FACTOR` at an exposed face.
 */
export function confinementFactor(distToAir: number): number {
  const t = Math.min(1, Math.max(0, distToAir) / CONFINEMENT_FULL_DEPTH);
  return UNCONFINED_THRESHOLD_FACTOR + (1 - UNCONFINED_THRESHOLD_FACTOR) * t;
}

/** Allocate a field over `box` and fill its static per-voxel properties. */
export function createEnergyField(
  grid: VoxelGrid,
  box: BlastBox,
): EnergyField {
  return drain(createEnergyFieldSteps(grid, box));
}

/** `createEnergyField`, yielding between slabs of the box (#1603). */
export function* createEnergyFieldSteps(
  grid: VoxelGrid,
  box: BlastBox,
): Steps<EnergyField> {
  const nx = box.maxX - box.minX;
  const ny = box.maxY - box.minY;
  const nz = box.maxZ - box.minZ;
  const count = nx * ny * nz;

  const field: EnergyField = {
    box, nx, ny, nz,
    effective: new Float32Array(count),
    overflowOut: new Float32Array(count),
    threshold: new Float32Array(count),
    air: new Uint8Array(count),
    distAir: new Float32Array(count),
    gradeY: null,
    seeded: 0,
    dissipated: 0,
  };

  // Pass 1: what is rock, and what does that rock cost to break in confinement.
  for (let z = box.minZ; z < box.maxZ; z++) {
    yield;
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        const i = indexOf(field, x, y, z);
        const threshold = grid.densityAt(x, y, z) > 0 ? computeVoxelThreshold(grid, x, y, z) : 0;
        if (threshold <= 0) {
          field.air[i] = 1;
          continue;
        }
        field.threshold[i] = threshold;
      }
    }
  }

  // Pass 2: distance to the nearest free face needs the finished air mask, and
  // the thresholds need that distance — rock near a face breaks for less.
  yield* fillDistanceToAir(field);
  for (let i = 0; i < count; i++) {
    if ((i & (BLAST_SLICE_CELLS - 1)) === 0) yield;
    if (field.air[i] === 1) continue;
    field.threshold[i] = field.threshold[i]! * confinementFactor(field.distAir[i]!);
  }

  return field;
}

// ── Propagation ─────────────────────────────────────────────────────────────

/** One charged voxel's contribution before propagation. */
export interface EnergySeed {
  x: number;
  y: number;
  z: number;
  energy: number;
}

/**
 * Turn a charged hole into per-voxel energy seeds.
 *
 * The explosive sits at the bottom of the hole and fills the length its own
 * mass occupies — one metre of hole per `chargeKgPerMetre(diameterM, explosiveId)` kilograms,
 * which grows with the bore (#1934) and the explosive's density — with the rest of the hole
 * above it inert. A filled hole's column reaches the stemming. Its energy is split evenly over those voxels, so
 * doubling the charge lengthens the column and keeps the energy per voxel
 * roughly constant, which is what makes a bigger charge break *more* rock
 * rather than the same rock more gently.
 *
 * Stemming does not change this column. Poor stemming lets the gases escape up
 * the hole instead of working on the rock, and that is already priced into the
 * `stemmingEfficiency` factor the caller applies to `totalEnergy` — charging it
 * twice would make an unstemmed shot break less rock than a stemmed one, when
 * what it really does is throw more of it.
 *
 * `surfaceY` is the first air voxel above the collar, so the topmost rock in
 * the column is `surfaceY - 1`.
 */
export function buildHoleSeeds(
  surfaceY: number,
  depth: number,
  amountKg: number,
  totalEnergy: number,
  x: number,
  z: number,
  floorY = 0,
  diameterM?: number,
  explosiveId?: string,
): EnergySeed[] {
  if (!(totalEnergy > 0) || depth <= 0 || amountKg <= 0) return [];

  // A hole cannot be drilled below the bottom of the world. Clamping here
  // rather than letting the out-of-bounds part of the column fall on the floor
  // keeps the charge whole: seeds outside the field are dropped, so an
  // over-deep hole would otherwise lose that share of its explosive silently.
  const bottomY = Math.max(floorY, Math.floor(surfaceY - depth));
  const chargeCells = Math.max(1, Math.round(amountKg / chargeKgPerMetre(diameterM, explosiveId)));
  // Nor can the charge reach past the collar, however much of it there is.
  const topY = Math.max(bottomY, Math.min(surfaceY - 1, bottomY + chargeCells - 1));
  const cellCount = topY - bottomY + 1;
  const perCell = totalEnergy / cellCount;

  const seeds: EnergySeed[] = [];
  for (let y = bottomY; y <= topY; y++) seeds.push({ x, y, z, energy: perCell });
  return seeds;
}

/**
 * Spread every hole's energy through the rock around it.
 *
 * Seeds are grouped by column — one hole per column. Each hole's energy is
 * shared out over the rock it can reach within `BLAST_ENERGY_REACH_M`, measured
 * through rock from its nearest charged voxel: a voxel at distance d gets a
 * share proportional to exp(-d / `BLAST_ENERGY_DECAY_M`), and the shares of one
 * hole sum to its whole energy. Shares from several holes add up. Rock below a
 * hole's bottom takes its share without keeping it: the shock damages the floor
 * but does not dig it, so a pattern of equal holes floors flat at their bottom.
 *
 * Every joule ends up either in a rock voxel or in `dissipated` (a charge sitting
 * in air, a hole with no rock in reach, the share spent under a hole's bottom).
 */
export function seedEnergy(field: EnergyField, seeds: readonly EnergySeed[]): void {
  drain(seedEnergySteps(field, seeds));
}

/** One hole's charged voxels (flat indices) and its total energy. */
interface HoleSource { cells: number[]; energy: number; bottomY: number }

/** `seedEnergy`, yielding once per hole (#1603). */
export function* seedEnergySteps(field: EnergyField, seeds: readonly EnergySeed[]): Steps<void> {
  const cellCount = field.effective.length;
  const { nx, ny } = field;
  const received = new Float64Array(cellCount);

  // Group the seeds by hole column; a seed in air has nothing to push.
  const holes = new Map<number, HoleSource>();
  for (const seed of seeds) {
    if (!Number.isFinite(seed.energy) || seed.energy <= 0) continue;
    if (!contains(field, seed.x, seed.y, seed.z)) continue;
    const i = indexOf(field, seed.x, seed.y, seed.z);
    field.seeded += seed.energy;
    if (field.air[i] === 1) {
      field.dissipated += seed.energy;
      continue;
    }
    const column = (seed.x - field.box.minX) + field.nx * (seed.z - field.box.minZ);
    let hole = holes.get(column);
    if (!hole) holes.set(column, hole = { cells: [], energy: 0, bottomY: seed.y });
    hole.cells.push(i);
    hole.energy += seed.energy;
    if (seed.y < hole.bottomY) hole.bottomY = seed.y;
  }
  // The blast's grade is the highest charged-hole bottom.
  for (const hole of holes.values()) {
    const grade = hole.bottomY + BLAST_GRADE_FLOOR_OFFSET_M;
    if (field.gradeY === null || grade > field.gradeY) field.gradeY = grade;
  }

  const reach = new HoleReach(field);
  for (const hole of holes.values()) {
    yield;
    const visited = reach.from(hole.cells);
    let total = 0;
    for (let k = 0; k < visited.length; k++) total += Math.exp(-reach.distance[visited[k]!]! / BLAST_ENERGY_DECAY_M);
    if (!(total > 0)) {
      field.dissipated += hole.energy;
      continue;
    }
    const perWeight = hole.energy / total;
    // The rock under a hole's bottom takes its share of the shock but is not dug: the floor
    // of the crater is the bottom of the holes. Its share is spent there, not passed back up.
    const floorRow = hole.bottomY - field.box.minY;
    for (let k = 0; k < visited.length; k++) {
      const i = visited[k]!;
      const share = perWeight * Math.exp(-reach.distance[i]! / BLAST_ENERGY_DECAY_M);
      if (Math.floor(i / nx) % ny < floorRow) field.dissipated += share;
      else received[i]! += share;
    }
  }

  yield;
  for (let i = 0; i < cellCount; i++) {
    const energy = received[i]!;
    if (energy <= 0) continue;
    const threshold = field.threshold[i]!;
    field.effective[i] = Math.min(energy, threshold);
    field.overflowOut[i] = Math.max(0, energy - threshold);
  }
}

/**
 * Shortest distances through rock from a hole's charged voxels, out to
 * `BLAST_ENERGY_REACH_M`: Dijkstra over the face and edge neighbours, air never
 * entered. Buffers are allocated once per field and reused for every hole.
 */
class HoleReach {
  /** Distance (m) of every voxel the last `from` call reached. */
  readonly distance: Float64Array;
  private readonly stamp: Int32Array;
  private run = 0;
  private heapCost: Float64Array;
  private heapCell: Int32Array;
  private readonly neighbourStep: Int32Array;

  constructor(private readonly field: EnergyField) {
    const count = field.effective.length;
    this.distance = new Float64Array(count);
    this.stamp = new Int32Array(count);
    this.heapCost = new Float64Array(1024);
    this.heapCell = new Int32Array(1024);
    const { nx, ny } = field;
    this.neighbourStep = Int32Array.from(NEIGHBOUR_OFFSETS, ([dx, dy, dz]) => dx + nx * (dy + ny * dz));
  }

  /** Voxels within reach of `sources`, nearest first; their distances are in `distance`. */
  from(sources: readonly number[]): number[] {
    const { field, distance, stamp } = this;
    const { nx, ny, nz } = field;
    const run = ++this.run;
    const visited: number[] = [];
    let size = 0;
    const push = (cell: number, cost: number): void => {
      if (size === this.heapCost.length) this.grow();
      let k = size++;
      while (k > 0) {
        const parent = (k - 1) >> 1;
        // Ties break on the cell index so the sweep order never depends on push order.
        if (this.heapCost[parent]! < cost || (this.heapCost[parent] === cost && this.heapCell[parent]! <= cell)) break;
        this.heapCost[k] = this.heapCost[parent]!;
        this.heapCell[k] = this.heapCell[parent]!;
        k = parent;
      }
      this.heapCost[k] = cost;
      this.heapCell[k] = cell;
    };
    const pop = (): void => {
      const lastCost = this.heapCost[--size]!;
      const lastCell = this.heapCell[size]!;
      let k = 0;
      for (;;) {
        let child = 2 * k + 1;
        if (child >= size) break;
        const right = child + 1;
        if (right < size && (this.heapCost[right]! < this.heapCost[child]!
          || (this.heapCost[right] === this.heapCost[child] && this.heapCell[right]! < this.heapCell[child]!))) child = right;
        if (this.heapCost[child]! > lastCost || (this.heapCost[child] === lastCost && this.heapCell[child]! >= lastCell)) break;
        this.heapCost[k] = this.heapCost[child]!;
        this.heapCell[k] = this.heapCell[child]!;
        k = child;
      }
      this.heapCost[k] = lastCost;
      this.heapCell[k] = lastCell;
    };

    for (const cell of sources) {
      if (stamp[cell] === run) continue;
      stamp[cell] = run;
      distance[cell] = 0;
      push(cell, 0);
    }
    // `settled` marks voxels already finalised this run (stamp alone says "seen").
    const settledMark = -run;
    while (size > 0) {
      const cost = this.heapCost[0]!;
      const cell = this.heapCell[0]!;
      pop();
      if (stamp[cell] === settledMark || cost > distance[cell]!) continue;
      stamp[cell] = settledMark;
      visited.push(cell);
      const lx = cell % nx;
      const ly = Math.floor(cell / nx) % ny;
      const lz = Math.floor(cell / (nx * ny));
      for (let k = 0; k < NEIGHBOUR_COUNT; k++) {
        const ax = lx + NEIGHBOUR_DX[k]!, ay = ly + NEIGHBOUR_DY[k]!, az = lz + NEIGHBOUR_DZ[k]!;
        if (ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz) continue;
        const next = cell + this.neighbourStep[k]!;
        if (field.air[next] === 1 || stamp[next] === settledMark) continue;
        const nextCost = cost + NEIGHBOUR_DIST[k]!;
        if (nextCost > BLAST_ENERGY_REACH_M) continue;
        if (stamp[next] === run && distance[next]! <= nextCost) continue;
        stamp[next] = run;
        distance[next] = nextCost;
        push(next, nextCost);
      }
    }
    return visited;
  }

  private grow(): void {
    const cost = new Float64Array(this.heapCost.length * 2);
    cost.set(this.heapCost);
    const cell = new Int32Array(this.heapCell.length * 2);
    cell.set(this.heapCell);
    this.heapCost = cost;
    this.heapCell = cell;
  }
}
