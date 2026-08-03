// BlastSimulator2026 — Blast step 1: energy propagation through the voxel grid
//
// Explosive energy is deposited into the voxels holding the charge, and each
// voxel keeps what its rock can absorb before handing the rest to its solid
// neighbours. Rock that swallows the whole charge keeps the blast local; rock
// that overflows spreads the fracture outward. Air neither absorbs nor carries
// energy, so a free face vents it and a void shields whatever is behind it.
//
// Everything runs on flat typed arrays over the blast's bounding box: a blast
// touches tens of thousands of voxels and the propagation loop revisits them
// many times over, so per-voxel object or string-key allocation is the one
// thing this must not do.
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A1.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { getRock } from '../world/RockCatalog.js';
import {
  MAX_PROPAGATION_ITERATIONS,
  PROPAGATION_ENERGY_EPSILON,
  TRANSMISSION_LOSS_BASE,
  TRANSMISSION_LOSS_POROSITY_SCALE,
  CHARGE_KG_PER_METRE,
  UNCONFINED_THRESHOLD_FACTOR,
  CONFINEMENT_FULL_DEPTH,
  FREE_FACE_BIAS,
} from '../config/balance.js';

// ── Geometry ────────────────────────────────────────────────────────────────

/** Half-open voxel box: `min` inclusive, `max` exclusive, in world voxel coords. */
export interface BlastBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** Clamp a box to the region the site actually owns. Returns null if nothing is left. */
export function clampBoxToGrid(box: BlastBox, grid: VoxelGrid): BlastBox | null {
  const clamped: BlastBox = {
    minX: Math.max(box.minX, grid.minX),
    minY: Math.max(box.minY, 0),
    minZ: Math.max(box.minZ, grid.minZ),
    maxX: Math.min(box.maxX, grid.maxX),
    maxY: Math.min(box.maxY, grid.sizeY),
    maxZ: Math.min(box.maxZ, grid.maxZ),
  };
  if (clamped.maxX <= clamped.minX || clamped.maxY <= clamped.minY || clamped.maxZ <= clamped.minZ) return null;
  return clamped;
}

// ── Field ───────────────────────────────────────────────────────────────────

/**
 * The 26-neighbour offsets a voxel shares its overflow with, minus the 8 corner
 * ones: face and edge neighbours only.
 *
 * Six face neighbours alone make energy spread along grid axes, which produces
 * diamond-shaped craters. Adding the twelve edge neighbours and weighting each
 * share by 1/distance approximates an isotropic wave closely enough that the
 * crater reads as round.
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

/**
 * Per-voxel blast state over one bounding box.
 *
 * `effective` is the energy a voxel kept (what fragments it), `overflowOut` the
 * total that passed through and left again (what throws the resulting
 * fragments). They answer different questions and both are needed downstream.
 */
export interface EnergyField {
  readonly box: BlastBox;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Energy retained by each voxel. */
  readonly effective: Float32Array;
  /** Energy that overflowed out of each voxel over the whole propagation. */
  readonly overflowOut: Float32Array;
  /** Absorption capacity of each voxel; 0 for air. */
  readonly threshold: Float32Array;
  /** 1 where the voxel is air (or not owned by the site), 0 where it is rock. */
  readonly air: Uint8Array;
  /** Fraction of pass-through energy each voxel loses to heat and noise. */
  readonly loss: Float32Array;
  /** Metres from each voxel to the nearest free face; 0 for air itself. */
  readonly distAir: Float32Array;
  /** Total energy handed to `seedEnergy`. */
  seeded: number;
  /** Energy lost to damping, vented into air, or stranded at the iteration cap. */
  dissipated: number;
  /** Propagation iterations actually run. */
  iterations: number;
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

/** Overflow that left a world coordinate, or 0 outside the field. */
export function overflowAt(field: EnergyField, x: number, y: number, z: number): number {
  return contains(field, x, y, z) ? field.overflowOut[indexOf(field, x, y, z)]! : 0;
}

/** True when the voxel is air, not owned by the site, or outside the field. */
export function isAirAt(field: EnergyField, x: number, y: number, z: number): boolean {
  return !contains(field, x, y, z) || field.air[indexOf(field, x, y, z)] === 1;
}

/**
 * How hard a voxel was hit, relative to what its rock can take.
 *
 * Retained energy alone cannot answer this: absorption stops at the voxel's
 * threshold, so every broken voxel retains exactly its threshold and the ratio
 * is pinned at 1.0 no matter how violent the blast was. What separates rock
 * that barely cracked from rock next to the charge is how much energy passed
 * *through* it, so intensity counts what it kept plus what it handed on.
 *
 * 1.0 means "just barely broke". Values well above that mean fine rubble.
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

/** Fill `field.distAir` by multi-source BFS from every air cell. */
function fillDistanceToAir(field: EnergyField): void {
  const { nx, ny } = field;
  const count = field.air.length;
  const far = nx + ny + field.nz;
  const dist = field.distAir;
  dist.fill(far);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < count; i++) {
    if (field.air[i] === 1) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  // The box edge borders rock we cannot see; treat it as confined, not open.
  while (head < tail) {
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
 * How much of the energy passing through a voxel is lost rather than handed on.
 *
 * Porous rock damps a shock wave; dense rock carries it. Deriving this from the
 * catalog's existing porosity keeps one number describing one property instead
 * of a second hand-tuned field that could contradict it.
 */
function transmissionLossOf(grid: VoxelGrid, x: number, y: number, z: number): number {
  const { rocks } = grid.compositionAt(x, y, z);
  let porosity = 0;
  let weight = 0;
  for (const rock of rocks) {
    const def = getRock(rock.rockId);
    if (!def) continue;
    porosity += rock.coefficient * def.porosity;
    weight += rock.coefficient;
  }
  if (weight <= 0) return TRANSMISSION_LOSS_BASE;
  const loss = TRANSMISSION_LOSS_BASE + TRANSMISSION_LOSS_POROSITY_SCALE * (porosity / weight);
  return Math.min(0.95, Math.max(0, loss));
}

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
export function createEnergyField(grid: VoxelGrid, box: BlastBox): EnergyField {
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
    loss: new Float32Array(count),
    distAir: new Float32Array(count),
    seeded: 0,
    dissipated: 0,
    iterations: 0,
  };

  // Pass 1: what is rock, and what does that rock cost to break in confinement.
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        const i = indexOf(field, x, y, z);
        const threshold = grid.densityAt(x, y, z) > 0 ? computeVoxelThreshold(grid, x, y, z) : 0;
        if (threshold <= 0) {
          field.air[i] = 1;
          continue;
        }
        field.threshold[i] = threshold;
        field.loss[i] = transmissionLossOf(grid, x, y, z);
      }
    }
  }

  // Pass 2: distance to the nearest free face needs the finished air mask, and
  // the thresholds need that distance — rock near a face breaks for less.
  fillDistanceToAir(field);
  for (let i = 0; i < count; i++) {
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
 * mass occupies — `CHARGE_KG_PER_METRE` of hole per kilogram — with the rest of
 * the hole above it inert. Its energy is split evenly over those voxels, so
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
): EnergySeed[] {
  if (!(totalEnergy > 0) || depth <= 0 || amountKg <= 0) return [];

  // A hole cannot be drilled below the bottom of the world. Clamping here
  // rather than letting the out-of-bounds part of the column fall on the floor
  // keeps the charge whole: seeds outside the field are dropped, so an
  // over-deep hole would otherwise lose that share of its explosive silently.
  const bottomY = Math.max(floorY, Math.floor(surfaceY - depth));
  const chargeCells = Math.max(1, Math.round(amountKg / CHARGE_KG_PER_METRE));
  // Nor can the charge reach past the collar, however much of it there is.
  const topY = Math.max(bottomY, Math.min(surfaceY - 1, bottomY + chargeCells - 1));
  const cellCount = topY - bottomY + 1;
  const perCell = totalEnergy / cellCount;

  const seeds: EnergySeed[] = [];
  for (let y = bottomY; y <= topY; y++) seeds.push({ x, y, z, energy: perCell });
  return seeds;
}

/**
 * Deposit `seeds` and let the overflow spread until it is spent.
 *
 * Each pass moves whatever overflowed in the previous pass one voxel outward,
 * so the number of passes bounds how far energy can travel. Every joule ends up
 * either retained in a voxel (`effective`) or accounted for in `dissipated` —
 * damped away, vented into air, or stranded when the iteration guard trips.
 */
export function seedEnergy(field: EnergyField, seeds: readonly EnergySeed[]): void {
  let current = new Map<number, number>();

  for (const seed of seeds) {
    if (!Number.isFinite(seed.energy) || seed.energy <= PROPAGATION_ENERGY_EPSILON) continue;
    if (!contains(field, seed.x, seed.y, seed.z)) continue;
    const i = indexOf(field, seed.x, seed.y, seed.z);
    field.seeded += seed.energy;
    // A charge sitting in air (an already-blasted pocket) has nothing to push.
    if (field.air[i] === 1) {
      field.dissipated += seed.energy;
      continue;
    }
    current.set(i, (current.get(i) ?? 0) + seed.energy);
  }

  const { nx, ny, box } = field;
  let iterations = 0;

  while (current.size > 0 && iterations < MAX_PROPAGATION_ITERATIONS) {
    iterations++;
    const next = new Map<number, number>();

    for (const [i, incoming] of current) {
      if (incoming <= PROPAGATION_ENERGY_EPSILON) {
        field.dissipated += incoming;
        continue;
      }

      const capacity = field.threshold[i]! - field.effective[i]!;
      const absorbed = Math.min(incoming, Math.max(0, capacity));
      if (absorbed > 0) field.effective[i] = field.effective[i]! + absorbed;

      const leftover = incoming - absorbed;
      if (leftover <= PROPAGATION_ENERGY_EPSILON) {
        field.dissipated += leftover;
        continue;
      }
      field.overflowOut[i] = field.overflowOut[i]! + leftover;

      const lost = leftover * field.loss[i]!;
      field.dissipated += lost;
      const transmit = leftover - lost;

      // Decode the flat index back to world coordinates to walk neighbours.
      const local = i;
      const lx = local % nx;
      const ly = Math.floor(local / nx) % ny;
      const lz = Math.floor(local / (nx * ny));
      const x = lx + box.minX;
      const y = ly + box.minY;
      const z = lz + box.minZ;

      const ownDistAir = field.distAir[i]!;

      let weightTotal = 0;
      const targets: number[] = [];
      const weights: number[] = [];
      for (const [dx, dy, dz, dist] of NEIGHBOUR_OFFSETS) {
        const nxx = x + dx, nyy = y + dy, nzz = z + dz;
        if (!contains(field, nxx, nyy, nzz)) continue;
        const ni = indexOf(field, nxx, nyy, nzz);
        if (field.air[ni] === 1) continue;
        if (field.effective[ni]! >= field.threshold[ni]!) continue;
        // Gas takes the path that offers relief. Spreading overflow evenly in
        // every direction makes the blast a sphere that dies at a fixed radius
        // and never reaches the surface, however large the charge — the burden
        // has to fail *toward* the free face, the way a real bench blast does.
        const relief = Math.max(0, ownDistAir - field.distAir[ni]!);
        const w = (1 / dist) * (1 + FREE_FACE_BIAS * relief);
        targets.push(ni);
        weights.push(w);
        weightTotal += w;
      }

      if (weightTotal <= 0) {
        // Fully enclosed by air, saturated rock, or the box edge: this energy
        // has nowhere left to go.
        field.dissipated += transmit;
        continue;
      }

      for (let k = 0; k < targets.length; k++) {
        const share = transmit * (weights[k]! / weightTotal);
        next.set(targets[k]!, (next.get(targets[k]!) ?? 0) + share);
      }
    }

    current = next;
  }

  // Whatever is still in flight when the guard trips is energy we chose not to
  // keep tracking — count it so the conservation invariant still holds.
  for (const remaining of current.values()) field.dissipated += remaining;

  field.iterations = iterations;
}
