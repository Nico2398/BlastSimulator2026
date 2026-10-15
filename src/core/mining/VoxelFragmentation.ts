// BlastSimulator2026 — Blast step 2: which voxels break, and what falls with them
//
// A voxel breaks once it has retained enough energy for its own rock. Rock that
// survives but is left hanging — an arch over a blasted pocket, a ledge whose
// footing is gone — comes down too: it has nothing holding it up, and leaving it
// floating is the single most obvious way a voxel game looks broken.
//
// See the gameplay-blast-system skill, "Step 2 — What Breaks".

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { FRAGMENTATION_MULTIPLIER, CRACKED_VOXEL_ENERGY_RATIO, CRACKED_VOXEL_WEAKENING, BURDEN_BREAKOUT_MAX, BLAST_SLICE_CELLS, BLAST_GRADE_MAX_CUT_M } from '../config/balance.js';
import { type EnergyField, indexOf, contains } from './EnergyPropagation.js';
import { drain, type Steps } from '../engine/Steps.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';

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
  /** How many voxels were floored to grade (rock left standing below the charge). */
  readonly gradedCount: number;
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
export function identifyFragmentedVoxels(
  field: EnergyField,
  grid: VoxelGrid,
  weakenCracked = true,
): FragmentationResult {
  return drain(identifyFragmentedVoxelsSteps(field, grid, weakenCracked));
}

/** `identifyFragmentedVoxels`, yielding between slabs of the box (#1603). */
export function* identifyFragmentedVoxelsSteps(
  field: EnergyField,
  grid: VoxelGrid,
  weakenCracked = true,
): Steps<FragmentationResult> {
  const { box } = field;
  const mask = new Uint8Array(field.effective.length);
  const cracked: VoxelCoord[] = [];

  // ── Pass 1: energy ────────────────────────────────────────────────────────
  for (let z = box.minZ; z < box.maxZ; z++) {
    yield;
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
  const liftedCount = yield* liftUnderminedBurden(field, mask);

  // ── Pass 2b: floor to grade ───────────────────────────────────────────────
  const gradedCount = floorToGrade(field, mask);

  // ── Pass 3: rock left with nothing under it ───────────────────────────────
  yield;
  const detached = yield* collectUnsupported(field, mask);
  for (const i of detached) mask[i] = 1;

  // Collect in a stable order so downstream seeding and tests are deterministic.
  const fragmented: VoxelCoord[] = [];
  for (let z = box.minZ; z < box.maxZ; z++) {
    yield;
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        if (mask[indexOf(field, x, y, z)] === 1) fragmented.push({ x, y, z });
      }
    }
  }

  // Cracked rock is weaker next time somebody blasts here. A read-only caller
  // (a pre-blast estimate) passes `weakenCracked = false` so it leaves the grid alone.
  for (let c = 0; weakenCracked && c < cracked.length; c++) {
    if ((c & (BLAST_SLICE_CELLS - 1)) === 0) yield;
    const { x, y, z } = cracked[c]!;
    grid.scaleFractureAt(x, y, z, CRACKED_VOXEL_WEAKENING);
  }

  return { fragmented, mask, cracked, detachedCount: detached.length, liftedCount, gradedCount };
}

/**
 * Floor the blast to grade: mark rock between the grade plane and the charge
 * bottoms as fragmented, and report how many voxels it took. Runs before the
 * unsupported-rock pass.
 */
export function floorToGrade(field: EnergyField, mask: Uint8Array): number {
  const { box, gradeY } = field;
  if (gradeY === null) return 0;
  let graded = 0;
  const { nx } = field;
  const columns = nx * (box.maxZ - box.minZ);
  // Per footprint column: the lowest broken voxel once flooring is done (-1
  // when none), whichever pass broke it.
  const lowest = new Int32Array(columns).fill(-1);
  // 1 where a column holds a broken voxel (a sentinel in `lowest` would clash with negative-y boxes).
  const footprint = new Uint8Array(columns);
  // 1 where a column's broken zone reaches its own top: the cap lifted off there.
  const opened = new Uint8Array(columns);
  const columnOf = (x: number, z: number): number => (x - box.minX) + nx * (z - box.minZ);

  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let x = box.minX; x < box.maxX; x++) {
      // Footprint column: highest and lowest voxel the energy pass already broke.
      let topBroken: number | null = null;
      let lowBroken = 0;
      for (let y = box.maxY - 1; y >= box.minY; y--) {
        if (mask[indexOf(field, x, y, z)] !== 1) continue;
        if (topBroken === null) topBroken = y;
        lowBroken = y;
      }
      if (topBroken === null) continue;
      lowest[columnOf(x, z)] = lowBroken;
      footprint[columnOf(x, z)] = 1;
      let solidTop = box.maxY - 1;
      while (solidTop >= box.minY && field.air[indexOf(field, x, solidTop, z)] === 1) solidTop--;
      if (topBroken >= solidTop) opened[columnOf(x, z)] = 1;

      // Grade plane, held within the cut cap of this column's own floor so a
      // deep outlier hole cannot gouge the pit.
      const floorY = Math.max(gradeY, lowBroken - BLAST_GRADE_MAX_CUT_M);
      // Walk down the broken zone: standing rock whose upper neighbour is
      // air or broken is open to it and goes down to grade with it.
      for (let y = topBroken - 1; y >= floorY && y >= box.minY; y--) {
        const i = indexOf(field, x, y, z);
        if (field.air[i] === 1) continue;
        if (mask[i] === 1) continue;
        mask[i] = 1;
        graded++;
        if (y < lowest[columnOf(x, z)]!) lowest[columnOf(x, z)] = y;
      }
    }
  }

  graded += floorEnclosedPillars(field, mask, lowest, footprint, opened, columnOf);

  // A hole breaks about one voxel under its own charge. Beside any column
  // ending at grade, whichever pass broke it, that is a 1 m pit under every
  // hole of the pattern: a step over NAV_MAX_SLOPE_DEGREES on every side, so
  // the crater floor would be a grid of islands. Leave that sub-grade voxel
  // standing there, so the floor is flush with grade. At close spacing the
  // pocket between holes has only sub-grade neighbours, so the lift floods:
  // a group of 8-connected one-voxel-deep columns lifts whole when any member
  // touches a column at grade. Deeper breakage (an outlier hole) is real
  // excavation and neither lifts nor carries the fill, and a lone hole's pit,
  // with no group member at grade, stays. A neighbour whose cut the cap clamped
  // ends above grade and does not count. Everything reads a snapshot taken
  // before any lifting.
  const subGradeY = Math.ceil(gradeY) - 1;
  const lift = subGradeColumnsToLift(lowest, columnOf, box, subGradeY, Math.ceil(gradeY));
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let x = box.minX; x < box.maxX; x++) {
      if (lift[columnOf(x, z)] === 1) mask[indexOf(field, x, subGradeY, z)] = 0;
    }
  }
  return graded;
}

/**
 * Flag every non-footprint column that no 4-connected path of non-footprint
 * columns joins to the box shell: an unbroken pillar ringed by broken columns.
 * Linear in footprint columns.
 */
function enclosedColumns(
  footprint: Uint8Array,
  columnOf: (x: number, z: number) => number,
  box: EnergyField['box'],
): Uint8Array {
  const open = new Uint8Array(footprint.length);
  const stack: number[] = [];
  const reach = (x: number, z: number): void => {
    if (x < box.minX || x >= box.maxX || z < box.minZ || z >= box.maxZ) return;
    const c = columnOf(x, z);
    if (footprint[c] === 1 || open[c] === 1) return;
    open[c] = 1;
    stack.push(x, z);
  };
  for (let x = box.minX; x < box.maxX; x++) {
    reach(x, box.minZ);
    reach(x, box.maxZ - 1);
  }
  for (let z = box.minZ; z < box.maxZ; z++) {
    reach(box.minX, z);
    reach(box.maxX - 1, z);
  }
  while (stack.length > 0) {
    const z = stack.pop()!;
    const x = stack.pop()!;
    reach(x + 1, z);
    reach(x - 1, z);
    reach(x, z + 1);
    reach(x, z - 1);
  }
  const enclosed = new Uint8Array(footprint.length);
  for (let c = 0; c < footprint.length; c++) {
    if (footprint[c] === 0 && open[c] === 0) enclosed[c] = 1;
  }
  return enclosed;
}

/**
 * Break unbroken pillars standing wholly inside the broken footprint (the
 * centre of a square of close holes) down to grade. A region of enclosed
 * columns floors at grade, held within the cut cap of its lowest bordering
 * footprint column. Only a region bordered by a column whose broken zone
 * reached its own top is floored: where no cap lifted off, the shot failed to
 * break out and stays sealed (#1724). Returns the voxels newly broken and lowers `lowest` there.
 */
function floorEnclosedPillars(
  field: EnergyField,
  mask: Uint8Array,
  lowest: Int32Array,
  footprint: Uint8Array,
  opened: Uint8Array,
  columnOf: (x: number, z: number) => number,
): number {
  const { box, gradeY } = field;
  const enclosed = enclosedColumns(footprint, columnOf, box);
  const seen = new Uint8Array(enclosed.length);
  let graded = 0;
  for (let z0 = box.minZ; z0 < box.maxZ; z0++) {
    for (let x0 = box.minX; x0 < box.maxX; x0++) {
      const start = columnOf(x0, z0);
      if (enclosed[start] === 0 || seen[start] === 1) continue;
      // Collect the 4-connected region and the lowest column bordering it.
      const region: number[] = [];
      let minBorderLow = Infinity;
      let borderOpened = false;
      seen[start] = 1;
      const stack = [x0, z0];
      while (stack.length > 0) {
        const z = stack.pop()!;
        const x = stack.pop()!;
        region.push(x, z);
        forEachNeighbourColumn(box, columnOf, x, z, (n, px, pz) => {
          if (footprint[n] === 1) {
            if (lowest[n]! < minBorderLow) minBorderLow = lowest[n]!;
            if (opened[n] === 1) borderOpened = true;
          } else if (enclosed[n] === 1 && seen[n] === 0 && (px === x || pz === z)) {
            seen[n] = 1;
            stack.push(px, pz);
          }
        });
      }
      // A shot whose ring never lifted its cap off stays sealed (#1724).
      if (!borderOpened) continue;
      const floorY = Math.max(gradeY!, minBorderLow - BLAST_GRADE_MAX_CUT_M);
      for (let r = 0; r < region.length; r += 2) {
        const x = region[r]!;
        const z = region[r + 1]!;
        let y = box.maxY - 1;
        while (y >= box.minY && field.air[indexOf(field, x, y, z)] === 1) y--;
        for (; y >= floorY && y >= box.minY; y--) {
          const i = indexOf(field, x, y, z);
          if (field.air[i] === 1 || mask[i] === 1) continue;
          mask[i] = 1;
          graded++;
          const c = columnOf(x, z);
          if (lowest[c]! === -1 || y < lowest[c]!) lowest[c] = y;
        }
      }
    }
  }
  return graded;
}

/** Visit the in-box 8-neighbours of footprint cell (x, z) as (column, x, z). */
function forEachNeighbourColumn(
  box: EnergyField['box'],
  columnOf: (x: number, z: number) => number,
  x: number,
  z: number,
  visit: (column: number, nx: number, nz: number) => void,
): void {
  for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
    const px = x + dx;
    const pz = z + dz;
    if (px < box.minX || px >= box.maxX || pz < box.minZ || pz >= box.maxZ) continue;
    visit(columnOf(px, pz), px, pz);
  }
}

/**
 * Flag every column ending at `subGradeY` that belongs to an 8-connected group
 * of such columns with at least one member next to a column ending at
 * `gradeCeil`. Linear in footprint columns.
 */
function subGradeColumnsToLift(
  lowest: Int32Array,
  columnOf: (x: number, z: number) => number,
  box: EnergyField['box'],
  subGradeY: number,
  gradeCeil: number,
): Uint8Array {
  const lift = new Uint8Array(lowest.length);
  const visited = new Uint8Array(lowest.length);
  // Flood stack holds footprint coordinates, so column layout stays in columnOf.
  const stackX: number[] = [];
  const stackZ: number[] = [];
  const enqueue = (c: number, x: number, z: number): void => {
    visited[c] = 1;
    stackX.push(x);
    stackZ.push(z);
  };
  // Seed from every sub-grade column beside a grade column, then spread
  // through sub-grade columns only.
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let x = box.minX; x < box.maxX; x++) {
      const c = columnOf(x, z);
      if (lowest[c] !== subGradeY || visited[c] === 1) continue;
      let touchesGrade = false;
      forEachNeighbourColumn(box, columnOf, x, z, (n) => {
        if (lowest[n] === gradeCeil) touchesGrade = true;
      });
      if (!touchesGrade) continue;
      enqueue(c, x, z);
      while (stackX.length > 0) {
        const cx = stackX.pop()!;
        const cz = stackZ.pop()!;
        lift[columnOf(cx, cz)] = 1;
        forEachNeighbourColumn(box, columnOf, cx, cz, (n, px, pz) => {
          if (visited[n] === 1 || lowest[n] !== subGradeY) return;
          enqueue(n, px, pz);
        });
      }
    }
  }
  return lift;
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
function* liftUnderminedBurden(field: EnergyField, mask: Uint8Array): Steps<number> {
  const { box } = field;
  let lifted = 0;

  for (let z = box.minZ; z < box.maxZ; z++) {
    yield;
    for (let x = box.minX; x < box.maxX; x++) {
      // Highest broken voxel in this column — the roof of the excavation.
      // `null`, not a numeric sentinel: a box entirely below y=0 has every
      // legitimate topBroken negative too, so `-1` would misread as "none
      // found" and skip the lift on every such column (#1186).
      let topBroken: number | null = null;
      for (let y = box.maxY - 1; y >= box.minY; y--) {
        if (mask[indexOf(field, x, y, z)] === 1) { topBroken = y; break; }
      }
      if (topBroken === null) continue;

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
function* collectUnsupported(field: EnergyField, mask: Uint8Array): Steps<number[]> {
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
    if (((z - box.minZ) & 15) === 0) yield;
    for (let y = box.minY; y < box.maxY; y++) {
      seed(box.minX, y, z);
      seed(box.maxX - 1, y, z);
    }
  }
  // The two Y faces anchor the box's literal edge row, same as the X/Z faces.
  // No per-column "nearest solid voxel" fallback: that heuristic looked
  // plausible (a real slab's candidate always has a face-adjacent solid
  // neighbour of its own) but the same is true of a multi-voxel *disconnected*
  // island sitting mid-crater — it has neighbours within itself, just none
  // reaching the world outside the box. "Has any neighbour" cannot tell a
  // slab's crust from a detached chunk sitting on nothing, and level1's own
  // ordinary blast proved it: an entirely real, in-bounds blast (box.minY=10,
  // nowhere near the below-y=0 case this row was written for) went from 10
  // genuinely detached voxels to 0 the moment this fallback started running,
  // because it happily anchored debris pockets the flood fill was supposed to
  // catch. The literal row is enough — real confined rock (the
  // blast-execution.test.ts molite slab, the below-y=0 crater case) is always
  // reachable through the X/Z side walls, which already span the box's full
  // Y range and seed every column's true surface via lateral connectivity
  // through the contiguous mass; a Y face landing on padding past where the
  // rock ends (BLAST_ZONE_RADIUS overshooting the real surface, unrelated to
  // #1186) is exactly the ordinary case seed()'s own air check already no-ops
  // on, same as it always has.
  for (let z = box.minZ; z < box.maxZ; z++) {
    if (((z - box.minZ) & 15) === 0) yield;
    for (let x = box.minX; x < box.maxX; x++) {
      seed(x, box.minY, z);
      seed(x, box.maxY - 1, z);
    }
  }
  for (let y = box.minY; y < box.maxY; y++) {
    if (((y - box.minY) & 15) === 0) yield;
    for (let x = box.minX; x < box.maxX; x++) {
      seed(x, y, box.minZ);
      seed(x, y, box.maxZ - 1);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    if ((head & (BLAST_SLICE_CELLS - 1)) === 0) yield;
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
    yield;
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        const i = indexOf(field, x, y, z);
        if (field.air[i] === 0 && mask[i] === 0 && visited[i] === 0) unsupported.push(i);
      }
    }
  }
  return unsupported;
}
