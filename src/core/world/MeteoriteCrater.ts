// BlastSimulator2026 — Meteorite crater (#2287)
// One impact crater per progression world, far beyond the ore islands: a round depression with a raised rim,
// over a body of ultra-hard meteoritic rock that hosts treranium. Seeded and lazy.

import {
  METEORITE_BODY_DEPTH_M, METEORITE_BODY_RADIUS_M, METEORITE_BODY_TOP_DEPTH_M, METEORITE_CRATER_DEPTH_M,
  METEORITE_CRATER_MAX_DISTANCE_M, METEORITE_CRATER_MIN_DISTANCE_M, METEORITE_CRATER_OUTER_RADIUS_M,
  METEORITE_CRATER_PLACEMENT_ATTEMPTS, METEORITE_CRATER_RIM_HEIGHT_M, METEORITE_CRATER_RIM_RADIUS_M,
  METEORITE_ROCK_ID, METEORITE_TRERANIUM_CORE_DENSITY,
} from '../config/balance.js';
import { cellRand, subSeed } from '../math/Hash.js';
import { smoothstep } from '../math/Smoothstep.js';
import { MIN_STORED_DENSITY } from './OreVeins.js';
import type { Rect } from './WorldGen.js';

/** The crater's placement: centre, outer radius and distance from spawn, in metres. */
interface MeteoriteCraterInfo {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly distance: number;
}

/** What the crater body holds at one voxel. */
interface CraterBody {
  readonly rockId: string;
  readonly oreDensities: Readonly<Record<string, number>>;
}

/** Extra clearance around the crater's outer radius when asking whether it touches a protected structure. */
const PROTECTED_CLEARANCE_M = 8;

export class MeteoriteCrater {
  private readonly seed: number;
  private placed: MeteoriteCraterInfo | null | undefined;

  /** `isProtected` vetoes a spot whose bounding square touches ground a site may never claim. */
  constructor(
    seed: number,
    private readonly spawn: { readonly x: number; readonly z: number },
    private readonly isProtected?: (rect: Rect) => boolean,
  ) {
    this.seed = subSeed(seed, 'meteorite-crater');
  }

  /** The crater, or null when no free spot exists. Placed on first ask. */
  get info(): MeteoriteCraterInfo | null {
    if (this.placed === undefined) this.placed = this.place();
    return this.placed;
  }

  /** Metres added to the natural ground at a column: negative in the bowl, positive on the rim, 0 elsewhere. */
  reliefAt(x: number, z: number): number {
    const crater = this.craterNear(x, z);
    if (!crater) return 0;
    const d = Math.hypot(x - crater.x, z - crater.z);
    if (d < METEORITE_CRATER_RIM_RADIUS_M) {
      return -METEORITE_CRATER_DEPTH_M
        + (METEORITE_CRATER_RIM_HEIGHT_M + METEORITE_CRATER_DEPTH_M) * smoothstep(0, 1, d / METEORITE_CRATER_RIM_RADIUS_M);
    }
    const fall = (d - METEORITE_CRATER_RIM_RADIUS_M) / (METEORITE_CRATER_OUTER_RADIUS_M - METEORITE_CRATER_RIM_RADIUS_M);
    return METEORITE_CRATER_RIM_HEIGHT_M * (1 - smoothstep(0, 1, fall));
  }

  /** The body's rock and treranium at a column and depth below the (crater-modified) surface; null outside it. */
  bodyAt(x: number, z: number, depth: number): CraterBody | null {
    const crater = this.craterNear(x, z);
    if (!crater || depth < METEORITE_BODY_TOP_DEPTH_M) return null;
    const horizontal = Math.hypot(x - crater.x, z - crater.z) / METEORITE_BODY_RADIUS_M;
    const vertical = (depth - METEORITE_BODY_TOP_DEPTH_M) / (METEORITE_BODY_DEPTH_M - METEORITE_BODY_TOP_DEPTH_M);
    const r = Math.hypot(horizontal, vertical);
    if (r >= 1) return null;
    const density = Math.round(METEORITE_TRERANIUM_CORE_DENSITY * smoothstep(0, 1, 1 - r) * 100) / 100;
    return {
      rockId: METEORITE_ROCK_ID,
      oreDensities: density > MIN_STORED_DENSITY ? { treranium: density } : {},
    };
  }

  /** The crater when the column is inside its footprint; a distance test first so far columns never trigger placement. */
  private craterNear(x: number, z: number): MeteoriteCraterInfo | null {
    const fromSpawn = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    if (fromSpawn < METEORITE_CRATER_MIN_DISTANCE_M - METEORITE_CRATER_OUTER_RADIUS_M) return null;
    if (fromSpawn > METEORITE_CRATER_MAX_DISTANCE_M + METEORITE_CRATER_OUTER_RADIUS_M) return null;
    const crater = this.info;
    if (!crater || Math.hypot(x - crater.x, z - crater.z) >= METEORITE_CRATER_OUTER_RADIUS_M) return null;
    return crater;
  }

  private place(): MeteoriteCraterInfo | null {
    const reach = METEORITE_CRATER_OUTER_RADIUS_M + PROTECTED_CLEARANCE_M;
    for (let attempt = 0; attempt < METEORITE_CRATER_PLACEMENT_ATTEMPTS; attempt++) {
      const angle = cellRand(this.seed, attempt, 0, 1) * Math.PI * 2;
      const distance = METEORITE_CRATER_MIN_DISTANCE_M
        + cellRand(this.seed, attempt, 0, 2) * (METEORITE_CRATER_MAX_DISTANCE_M - METEORITE_CRATER_MIN_DISTANCE_M);
      const x = Math.round(this.spawn.x + Math.cos(angle) * distance);
      const z = Math.round(this.spawn.z + Math.sin(angle) * distance);
      const actual = Math.hypot(x - this.spawn.x, z - this.spawn.z);
      if (actual < METEORITE_CRATER_MIN_DISTANCE_M || actual > METEORITE_CRATER_MAX_DISTANCE_M) continue;
      if (this.isProtected?.({ minX: x - reach, maxX: x + reach, minZ: z - reach, maxZ: z + reach })) continue;
      return { x, z, radius: METEORITE_CRATER_OUTER_RADIUS_M, distance: actual };
    }
    return null;
  }
}
