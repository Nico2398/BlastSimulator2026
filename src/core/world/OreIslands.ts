// BlastSimulator2026 — Ore islands (#2284)
// G2 ores (craktonite, absurdium) are not in ordinary ground. On progression sites they sit in discrete
// patches scattered beyond a minimum distance from spawn, shallow, and clear of villages, rivers and landmarks.
// Placement is per grid cell, lazy and seeded: a cell nobody generates costs nothing.

import {
  ORE_ISLAND_CELL_M, ORE_ISLAND_CHANCE, ORE_ISLAND_CORE_DENSITY, ORE_ISLAND_DEPTH_M, ORE_ISLAND_MAX_DISTANCE_M,
  ORE_ISLAND_MIN_DISTANCE_M, ORE_ISLAND_ORE_IDS, ORE_ISLAND_RADIUS_MAX_M, ORE_ISLAND_RADIUS_MIN_M,
} from '../config/balance.js';
import { cellRand, subSeed } from '../math/Hash.js';
import { MIN_STORED_DENSITY } from './OreVeins.js';
import type { Rect } from './WorldGen.js';

/** One island: centre cell, radius in metres, the ores it holds and its distance from spawn. */
export interface OreIsland {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly oreIds: readonly string[];
  readonly distance: number;
}

/** Sub-disc geometry of a two-ore island: each ore owns a disc this fraction of the radius, offset by this fraction. */
const PAIR_DISC_RADIUS = 0.65;
const PAIR_DISC_OFFSET = 0.35;
/** Share of single-ore islands holding the first ore; the rest of the draw splits second-ore-only and both. */
const FIRST_ORE_ONLY_SHARE = 0.5;
const SECOND_ORE_ONLY_SHARE = 0.75;
/** Extra clearance around an island's bounding square when asking whether it touches a protected structure. */
const PROTECTED_CLEARANCE_M = 8;

interface Disc { readonly x: number; readonly z: number; readonly r: number; readonly oreId: string }
interface Placed { readonly island: OreIsland; readonly discs: readonly Disc[] }

export class OreIslands {
  private readonly seed: number;
  private readonly cells = new Map<string, Placed | null>();
  private all: Placed[] | null = null;

  /** `isProtected` vetoes an island whose bounding square touches ground a site may never claim. */
  constructor(
    seed: number,
    private readonly spawn: { readonly x: number; readonly z: number },
    private readonly isProtected?: (rect: Rect) => boolean,
  ) {
    this.seed = subSeed(seed, 'ore-islands');
  }

  /** Every island of the world, nearest spawn first. */
  list(): OreIsland[] {
    return this.enumerate().map((p) => p.island);
  }

  /** Stored ore density per island ore at a column and depth below the surface; empty outside islands. */
  densitiesAt(x: number, z: number, depth: number): Record<string, number> {
    const result: Record<string, number> = {};
    if (depth < 0 || depth > ORE_ISLAND_DEPTH_M) return result;
    const placed = this.placedAt(Math.floor(x / ORE_ISLAND_CELL_M), Math.floor(z / ORE_ISLAND_CELL_M));
    if (!placed) return result;
    for (const disc of placed.discs) {
      const d = Math.hypot(x - disc.x, z - disc.z);
      if (d >= disc.r) continue;
      const t = 1 - d / disc.r;
      const density = Math.round(ORE_ISLAND_CORE_DENSITY * t * t * (3 - 2 * t) * 100) / 100;
      if (density <= MIN_STORED_DENSITY) continue;
      result[disc.oreId] = Math.max(result[disc.oreId] ?? 0, density);
    }
    return result;
  }

  private enumerate(): Placed[] {
    if (this.all) return this.all;
    const reach = Math.ceil((ORE_ISLAND_MAX_DISTANCE_M + ORE_ISLAND_RADIUS_MAX_M) / ORE_ISLAND_CELL_M);
    const cx0 = Math.floor(this.spawn.x / ORE_ISLAND_CELL_M);
    const cz0 = Math.floor(this.spawn.z / ORE_ISLAND_CELL_M);
    const found: Placed[] = [];
    for (let cz = cz0 - reach; cz <= cz0 + reach; cz++) {
      for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) {
        const placed = this.placedAt(cx, cz);
        if (placed) found.push(placed);
      }
    }
    found.sort((a, b) => a.island.distance - b.island.distance);
    this.all = found;
    return found;
  }

  private placedAt(cx: number, cz: number): Placed | null {
    const key = `${cx},${cz}`;
    const cached = this.cells.get(key);
    if (cached !== undefined) return cached;
    const placed = this.place(cx, cz);
    this.cells.set(key, placed);
    return placed;
  }

  private place(cx: number, cz: number): Placed | null {
    const rand = (salt: number): number => cellRand(this.seed, cx, cz, salt);
    if (rand(1) >= ORE_ISLAND_CHANCE) return null;
    const radius = Math.round(ORE_ISLAND_RADIUS_MIN_M + rand(2) * (ORE_ISLAND_RADIUS_MAX_M - ORE_ISLAND_RADIUS_MIN_M));
    const span = ORE_ISLAND_CELL_M - 2 * ORE_ISLAND_RADIUS_MAX_M;
    const x = Math.round(cx * ORE_ISLAND_CELL_M + ORE_ISLAND_RADIUS_MAX_M + rand(3) * span);
    const z = Math.round(cz * ORE_ISLAND_CELL_M + ORE_ISLAND_RADIUS_MAX_M + rand(4) * span);
    const distance = Math.hypot(x - this.spawn.x, z - this.spawn.z);
    if (distance - radius < ORE_ISLAND_MIN_DISTANCE_M || distance > ORE_ISLAND_MAX_DISTANCE_M) return null;
    const reach = radius + PROTECTED_CLEARANCE_M;
    if (this.isProtected?.({ minX: x - reach, maxX: x + reach, minZ: z - reach, maxZ: z + reach })) return null;

    const [first, second] = ORE_ISLAND_ORE_IDS as readonly [string, string];
    const pick = rand(5);
    const oreIds = pick < FIRST_ORE_ONLY_SHARE ? [first] : pick < SECOND_ORE_ONLY_SHARE ? [second] : [first, second];
    const discs: Disc[] = oreIds.length === 1
      ? [{ x, z, r: radius, oreId: oreIds[0]! }]
      : [-1, 1].map((sign, i): Disc => ({
        x: x + sign * PAIR_DISC_OFFSET * radius, z, r: PAIR_DISC_RADIUS * radius, oreId: oreIds[i]!,
      }));
    return { island: { x, z, radius, oreIds, distance }, discs };
  }
}
