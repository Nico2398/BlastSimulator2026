// BlastSimulator2026 — shared fixtures for the ore island tests (#2284).

import { buildTerrainContext, type TerrainConfig, type TerrainContext } from '../../src/core/world/TerrainGen.js';
import { buildProtectedStructures, type ProtectedStructures } from '../../src/core/world/Structures.js';
import type { OreIslands } from '../../src/core/world/OreIslands.js';

/** Seeds the Contract names as the reference worlds. */
export const REFERENCE_SEEDS = [1, 2, 3, 42, 12345] as const;
export const SITE_SIZE = 64;
export const SPAWN = { x: SITE_SIZE / 2, z: SITE_SIZE / 2 } as const;

/** A progression-site (ore deposits on) config over the default 64 m site. */
export function islandConfig(seed: number, ...flag: [oreDeposits?: boolean]): TerrainConfig {
  const oreDeposits = flag.length === 0 ? true : flag[0];
  return {
    sizeX: SITE_SIZE, sizeZ: SITE_SIZE, datum: Math.floor(SITE_SIZE * 0.55),
    seed, climateBias: [0, 0],
    ...(oreDeposits !== undefined ? { oreDeposits } : {}),
  };
}

export function islandContext(seed: number, ...flag: [oreDeposits?: boolean]): TerrainContext {
  return buildTerrainContext(islandConfig(seed, ...flag));
}

/** The seed's ore islands; fails loudly when the context carries none. */
export function islandsOf(seed: number): OreIslands {
  const islands = islandContext(seed).oreIslands;
  if (!islands) throw new Error(`seed ${seed}: terrain context has no ore islands`);
  return islands;
}

const structureCache = new Map<number, ProtectedStructures>();

/** The seed's villages, rivers and landmarks, built the way the claim path builds them. */
export function structuresOf(seed: number): ProtectedStructures {
  const cached = structureCache.get(seed);
  if (cached) return cached;
  const { fields, shapingAt, playableRect } = islandContext(seed).worldGen;
  const built = buildProtectedStructures(seed, fields, shapingAt, playableRect);
  structureCache.set(seed, built);
  return built;
}

export function distanceFromSpawn(x: number, z: number): number {
  return Math.hypot(x - SPAWN.x, z - SPAWN.z);
}
