// BlastSimulator2026 — Blast step 2: which voxels break, and what falls with them
//
// A voxel breaks once it has retained enough energy for its own rock. Rock that
// survives but is left hanging — an arch over a blasted pocket, a ledge whose
// footing is gone — comes down too: it has nothing holding it up, and leaving it
// floating is the single most obvious way a voxel game looks broken.
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A2.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { FRAGMENTATION_MULTIPLIER, CRACKED_VOXEL_ENERGY_RATIO, CRACKED_VOXEL_WEAKENING, BURDEN_BREAKOUT_MAX } from '../config/balance.js';
import { type EnergyField, indexOf, contains } from './EnergyPropagation.js';

/** Face-adjacent offsets — connectivity for the support flood fill. */
const FACE_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export interface FragmentationResult {
  /** Every voxel that turns to air, in ascending (z, y, x) order. */
  readonly fragmented: VoxelCoord[];
  /** 1 per field cell where the voxel fragmented. */
  readonly mask: Uint8Array;
  /** Voxels that took real energy but held together; their rock is now weaker. */
  readonly cracked: VoxelCoord[];
  /** How many of `fragmented` broke because their support went, not from energy. */
  readonly detachedCount: number;
  /** How many were undermined burden that lifted rather than being crushed. */
  readonly liftedCount: number;
}

/** True when the field cell at these coordinates is marked fragmented. */
export function isFragmented(result: FragmentationResult, field: EnergyField, x: number, y: number, z: number): boolean {
  return contains(field, x, y, z) && result.mask[indexOf(field, x, y, z)] === 1;
}

/**
 * Decide which voxels break.
 *
 * Two passes. The first breaks any voxel whose retained energy reached
 * `FRAGMENTATION_MULTIPLIER × threshold`. The second finds rock the first pass
 * left unsupported: flood-fill the surviving rock inward from the box's own
 * shell, and anything the fill never reaches is standing on nothing.
 *
 * Seeding from the shell treats rock at the box edge as attached to the world
 * beyond it, which is the conservative reading — the alternative, seeding from
 * the ground plane, would drop every overhang the blast never touched.
 */
export function identifyFragmentedVoxels(field: EnergyField, grid: VoxelGrid): FragmentationResult {
  const { box } = field;
  const mask = new Uint8Array(field.effective.length);
  const cracked: VoxelCoord[] = [];

  // ── Pass 1: energy ────────────────────────────────────────────────────────
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        const i = indexOf(field, x, y, z);
        if (field.air[i] === 1) continue;

        const threshold = field.threshold[i]!;
        const energy = field.effective[i]!;
        if (threshold <= 0) continue;

        if (energy >= FRAGMENTATION_MULTIPLIER * threshold) {
          mask[i] = 1;
        } else if (energy >= CRACKED_VOXEL_ENERGY_RATIO * threshold) {
          cracked.push({ x, y, z });
        }
      }
    }
  }

  // ── Pass 2: burden that has been undermined ───────────────────────────────
  const liftedCount = liftUnderminedBurden(field, mask);

  // ── Pass 3: rock left with nothing under it ───────────────────────────────
  const detached = collectUnsupported(field, mask);
  for (const i of detached) mask[i] = 1;

  // Collect in a stable order so downstream seeding and tests are deterministic.
  const fragmented: VoxelCoord[] = [];
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        if (mask[indexOf(field, x, y, z)] === 1) fragmented.push({ x, y, z });
      }
    }
  }

  // Cracked rock is weaker next time somebody blasts here.
  for (const { x, y, z } of cracked) grid.scaleFractureAt(x, y, z, CRACKED_VOXEL_WEAKENING);

  return { fragmented, mask, cracked, detachedCount: detached.length, liftedCount };
}

/**
 * Break the thin cap of rock left standing over a broken zone, and report how
 * many voxels it took.
 *
 * The energy pass is a crushing model: every voxel has to individually absorb
 * its own threshold before it breaks. Real blasting does not work that way — a
 * bench blast does not pulverise its burden, it *displaces* it. Rock that has
 * been undermined and has open air above it cannot bridge the gap, so it lifts
 * and comes down as muck whether or not the shock wave had enough left to crush
 * it on the way past.
 *
 * Without this a charge carves a sealed cavity underground and leaves the
 * surface intact however large it is, which is both wrong and invisible.
 * A cap thicker than `BURDEN_BREAKOUT_MAX` still holds, which is what makes an
 * over-buried charge fail to break out — the classic too-much-burden mistake.
 */
function liftUnderminedBurden(field: EnergyField, mask: Uint8Array): number {
  const { box } = field;
  let lifted = 0;

  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let x = box.minX; x < box.maxX; x++) {
      // Highest broken voxel in this column — the roof of the excavation.
      let topBroken = -1;
      for (let y = box.maxY - 1; y >= box.minY; y--) {
        if (mask[indexOf(field, x, y, z)] === 1) { topBroken = y; break; }
      }
      if (topBroken < 0) continue;

      // Walk the intact rock above it. It only lifts if it is thin enough and
      // actually reaches open air — a cap that runs to the top of the box might
      // continue beyond what we can see, so it stays put.
      const cap: number[] = [];
      let reachedAir = false;
      for (let y = topBroken + 1; y < box.maxY; y++) {
        const i = indexOf(field, x, y, z);
        if (field.air[i] === 1) { reachedAir = true; break; }
        if (mask[i] === 1) continue;
        cap.push(y);
        if (cap.length > BURDEN_BREAKOUT_MAX) break;
      }

      if (!reachedAir || cap.length === 0 || cap.length > BURDEN_BREAKOUT_MAX) continue;
      for (const y of cap) {
        mask[indexOf(field, x, y, z)] = 1;
        lifted++;
      }
    }
  }

  return lifted;
}

/**
 * Flat indices of surviving rock that no longer connects to the box shell.
 *
 * Flood-fills the *supported* rock and returns the complement, so the cost is
 * one pass over the box regardless of how much of it broke.
 */
function collectUnsupported(field: EnergyField, mask: Uint8Array): number[] {
  const { box } = field;
  const visited = new Uint8Array(field.effective.length);
  const queue: number[] = [];

  const isSolidSurvivor = (x: number, y: number, z: number): boolean => {
    if (!contains(field, x, y, z)) return false;
    const i = indexOf(field, x, y, z);
    return field.air[i] === 0 && mask[i] === 0;
  };

  const seed = (x: number, y: number, z: number): void => {
    if (!isSolidSurvivor(x, y, z)) return;
    const i = indexOf(field, x, y, z);
    if (visited[i] === 1) return;
    visited[i] = 1;
    queue.push(i);
  };

  // Every voxel on the six faces of the box is treated as anchored.
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      seed(box.minX, y, z);
      seed(box.maxX - 1, y, z);
    }
  }
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let x = box.minX; x < box.maxX; x++) {
      seed(x, box.minY, z);
      seed(x, box.maxY - 1, z);
    }
  }
  for (let y = box.minY; y < box.maxY; y++) {
    for (let x = box.minX; x < box.maxX; x++) {
      seed(x, y, box.minZ);
      seed(x, y, box.maxZ - 1);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const lx = i % field.nx;
    const ly = Math.floor(i / field.nx) % field.ny;
    const lz = Math.floor(i / (field.nx * field.ny));
    const x = lx + box.minX;
    const y = ly + box.minY;
    const z = lz + box.minZ;

    for (const [dx, dy, dz] of FACE_OFFSETS) {
      seed(x + dx, y + dy, z + dz);
    }
  }

  const unsupported: number[] = [];
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        const i = indexOf(field, x, y, z);
        if (field.air[i] === 0 && mask[i] === 0 && visited[i] === 0) unsupported.push(i);
      }
    }
  }
  return unsupported;
}
