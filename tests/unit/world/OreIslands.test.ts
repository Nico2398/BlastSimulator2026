// OreIslands — G2 ore lives only in discrete, sparse, shallow patches far from spawn (#2284)

import { describe, it, expect } from 'vitest';
import { OreIslands, type OreIsland } from '../../../src/core/world/OreIslands.js';
import { rectTouchesProtectedStructure } from '../../../src/core/world/Structures.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import {
  ORE_ISLAND_MIN_DISTANCE_M, ORE_ISLAND_MAX_DISTANCE_M, ORE_ISLAND_DEPTH_M, ORE_ISLAND_ORE_IDS,
  ORE_ISLAND_RADIUS_MIN_M, ORE_ISLAND_RADIUS_MAX_M,
} from '../../../src/core/config/balance.js';
import { CHUNK_SIZE } from '../../../src/core/world/VoxelGrid.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import {
  REFERENCE_SEEDS, SPAWN, islandContext, islandsOf, structuresOf, distanceFromSpawn,
} from '../../helpers/oreIslandSite.js';

const DEPTHS = [0, 2, 5, 8, ORE_ISLAND_DEPTH_M] as const;

function hasOre(densities: Record<string, number>): boolean {
  return Object.values(densities).some(d => d > 0);
}

/** True when any island ore sits in the column (x, z) at one of the sampled depths. */
function columnHoldsOre(islands: OreIslands, x: number, z: number): boolean {
  return DEPTHS.some(depth => hasOre(islands.densitiesAt(x, z, depth)));
}

function squareOf(island: OreIsland): Rect {
  return {
    minX: island.x - island.radius, minZ: island.z - island.radius,
    maxX: island.x + island.radius, maxZ: island.z + island.radius,
  };
}

describe('OreIslands — construction and the balance constants', () => {
  it('names G2 ores only, and every one is in the catalog', () => {
    expect(ORE_ISLAND_ORE_IDS.length).toBeGreaterThan(0);
    for (const id of ORE_ISLAND_ORE_IDS) expect(getOre(id)?.permitGrade).toBe(2);
  });

  it('keeps the ring wide enough for a whole island to sit inside it', () => {
    expect(ORE_ISLAND_MAX_DISTANCE_M).toBeGreaterThan(ORE_ISLAND_MIN_DISTANCE_M + ORE_ISLAND_RADIUS_MAX_M);
    expect(ORE_ISLAND_RADIUS_MIN_M).toBeLessThanOrEqual(ORE_ISLAND_RADIUS_MAX_M);
  });
});

describe('OreIslands.list', () => {
  it('is deterministic: the same seed and spawn give the same islands', () => {
    const a = new OreIslands(42, SPAWN).list();
    const b = new OreIslands(42, SPAWN).list();
    expect(a).toEqual(b);
  });

  it('differs between seeds', () => {
    const a = new OreIslands(1, SPAWN).list();
    const b = new OreIslands(2, SPAWN).list();
    expect(a).not.toEqual(b);
  });

  it('returns the islands sorted nearest spawn first', () => {
    for (const seed of REFERENCE_SEEDS) {
      const distances = new OreIslands(seed, SPAWN).list().map(i => i.distance);
      expect(distances).toEqual([...distances].sort((p, q) => p - q));
    }
  });

  it('reports each island distance as its centre distance from spawn', () => {
    for (const island of new OreIslands(42, SPAWN).list()) {
      expect(Math.abs(island.distance - distanceFromSpawn(island.x, island.z))).toBeLessThan(1);
    }
  });

  it('holds islands within the radius range and with ores drawn from the island ore list', () => {
    for (const seed of REFERENCE_SEEDS) {
      for (const island of new OreIslands(seed, SPAWN).list()) {
        expect(island.radius).toBeGreaterThanOrEqual(ORE_ISLAND_RADIUS_MIN_M);
        expect(island.radius).toBeLessThanOrEqual(ORE_ISLAND_RADIUS_MAX_M);
        expect(island.oreIds.length).toBeGreaterThan(0);
        for (const id of island.oreIds) expect(ORE_ISLAND_ORE_IDS).toContain(id);
      }
    }
  });

  it('every island centre lies within the max distance and its ore edge no closer than the min distance (C3)', () => {
    for (const seed of REFERENCE_SEEDS) {
      for (const island of new OreIslands(seed, SPAWN).list()) {
        expect(island.distance).toBeLessThanOrEqual(ORE_ISLAND_MAX_DISTANCE_M);
        expect(island.distance - island.radius).toBeGreaterThanOrEqual(ORE_ISLAND_MIN_DISTANCE_M - 1e-6);
      }
    }
  });

  it('follows the spawn it is given: the ring is measured from that point', () => {
    const spawn = { x: 500, z: -300 };
    const islands = new OreIslands(42, spawn).list();
    expect(islands.length).toBeGreaterThan(0);
    for (const island of islands) {
      expect(Math.hypot(island.x - spawn.x, island.z - spawn.z)).toBeLessThanOrEqual(ORE_ISLAND_MAX_DISTANCE_M);
      expect(island.distance - island.radius).toBeGreaterThanOrEqual(ORE_ISLAND_MIN_DISTANCE_M - 1e-6);
    }
  });

  it('every reference seed has at least 3 islands (C4)', () => {
    for (const seed of REFERENCE_SEEDS) {
      expect(islandsOf(seed).list().length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('OreIslands protected-ground veto', () => {
  it('drops every island when the predicate vetoes every square', () => {
    expect(new OreIslands(42, SPAWN, () => true).list()).toEqual([]);
  });

  it('asks about a bounding square that covers each island it keeps', () => {
    const asked: Rect[] = [];
    const islands = new OreIslands(42, SPAWN, rect => { asked.push(rect); return false; }).list();
    expect(islands.length).toBeGreaterThan(0);
    for (const island of islands) {
      const covered = asked.some(r =>
        r.minX <= island.x - island.radius && r.maxX >= island.x + island.radius
        && r.minZ <= island.z - island.radius && r.maxZ >= island.z + island.radius);
      expect(covered, `island at ${island.x},${island.z}`).toBe(true);
    }
  });

  it('keeps no island whose square the predicate vetoes', () => {
    const veto = (rect: Rect): boolean => rect.minX < SPAWN.x;
    const islands = new OreIslands(42, SPAWN, veto).list();
    for (const island of islands) expect(veto(squareOf(island))).toBe(false);
  });

  it('no island on a reference world touches a village, river or landmark (C3)', () => {
    for (const seed of REFERENCE_SEEDS) {
      const structures = structuresOf(seed);
      for (const island of islandsOf(seed).list()) {
        expect(rectTouchesProtectedStructure(structures, squareOf(island)), `seed ${seed} island ${island.x},${island.z}`).toBe(false);
      }
    }
  });
});

describe('OreIslands.densitiesAt', () => {
  it('holds ore at the heart of every island, at some depth within the island depth', () => {
    for (const seed of REFERENCE_SEEDS) {
      for (const island of islandsOf(seed).list()) {
        let found = false;
        for (let dx = -2; dx <= 2 && !found; dx++) {
          for (let dz = -2; dz <= 2 && !found; dz++) {
            found = columnHoldsOre(islandsOf(seed), island.x + dx, island.z + dz);
          }
        }
        expect(found, `seed ${seed} island ${island.x},${island.z}`).toBe(true);
      }
    }
  });

  it('only names island ores, with a density in 0..1 stored to 2 decimals', () => {
    for (const island of islandsOf(42).list()) {
      for (let dx = -island.radius; dx <= island.radius; dx += 2) {
        for (let dz = -island.radius; dz <= island.radius; dz += 2) {
          for (const depth of DEPTHS) {
            const result = islandsOf(42).densitiesAt(island.x + dx, island.z + dz, depth);
            for (const [id, density] of Object.entries(result)) {
              expect(island.oreIds).toContain(id);
              expect(density).toBeGreaterThanOrEqual(0);
              expect(density).toBeLessThanOrEqual(1);
              expect(Math.round(density * 100) / 100).toBe(density);
            }
          }
        }
      }
    }
  });

  it('is empty below the island depth (shallow ore only)', () => {
    for (const seed of REFERENCE_SEEDS) {
      const islands = islandsOf(seed);
      for (const island of islands.list()) {
        for (let dx = -island.radius; dx <= island.radius; dx += 3) {
          for (let dz = -island.radius; dz <= island.radius; dz += 3) {
            for (const depth of [ORE_ISLAND_DEPTH_M + 1, ORE_ISLAND_DEPTH_M + 10, 45]) {
              expect(islands.densitiesAt(island.x + dx, island.z + dz, depth)).toEqual({});
            }
          }
        }
      }
    }
  });

  it('is empty just outside an island that no other island covers', () => {
    const islands = islandsOf(42);
    const list = islands.list();
    for (const island of list) {
      const x = island.x + island.radius + 3;
      const z = island.z;
      const covered = list.some(o => Math.hypot(o.x - x, o.z - z) <= o.radius + 3);
      if (covered) continue;
      for (const depth of DEPTHS) expect(islands.densitiesAt(x, z, depth)).toEqual({});
    }
  });

  it('is empty at spawn and everywhere within the min distance of it (C1)', () => {
    for (const seed of REFERENCE_SEEDS) {
      const islands = islandsOf(seed);
      for (let x = SPAWN.x - ORE_ISLAND_MIN_DISTANCE_M; x <= SPAWN.x + ORE_ISLAND_MIN_DISTANCE_M; x += 4) {
        for (let z = SPAWN.z - ORE_ISLAND_MIN_DISTANCE_M; z <= SPAWN.z + ORE_ISLAND_MIN_DISTANCE_M; z += 4) {
          if (distanceFromSpawn(x, z) >= ORE_ISLAND_MIN_DISTANCE_M) continue;
          for (const depth of [0, 5, ORE_ISLAND_DEPTH_M]) {
            expect(islands.densitiesAt(x, z, depth), `seed ${seed} at ${x},${z}`).toEqual({});
          }
        }
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = new OreIslands(42, SPAWN);
    const b = new OreIslands(42, SPAWN);
    for (const island of a.list()) {
      expect(a.densitiesAt(island.x, island.z, 3)).toEqual(b.densitiesAt(island.x, island.z, 3));
    }
  });

  it('is empty everywhere when the predicate vetoes every island', () => {
    const none = new OreIslands(42, SPAWN, () => true);
    for (const island of new OreIslands(42, SPAWN).list()) {
      expect(none.densitiesAt(island.x, island.z, 2)).toEqual({});
    }
  });
});

describe('OreIslands sparsity (C2)', () => {
  it('fewer than 15% of the 16x16 chunks in the island ring hold G2 ore', () => {
    for (const seed of [1, 42]) {
      const islands = islandsOf(seed);
      let chunks = 0;
      let withOre = 0;
      const reach = Math.ceil(ORE_ISLAND_MAX_DISTANCE_M / CHUNK_SIZE) + 1;
      const c0x = Math.floor(SPAWN.x / CHUNK_SIZE);
      const c0z = Math.floor(SPAWN.z / CHUNK_SIZE);
      for (let cx = c0x - reach; cx <= c0x + reach; cx++) {
        for (let cz = c0z - reach; cz <= c0z + reach; cz++) {
          const midX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
          const midZ = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
          const d = distanceFromSpawn(midX, midZ);
          if (d < ORE_ISLAND_MIN_DISTANCE_M || d > ORE_ISLAND_MAX_DISTANCE_M) continue;
          chunks++;
          let holds = false;
          for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE && !holds; x += 2) {
            for (let z = cz * CHUNK_SIZE; z < (cz + 1) * CHUNK_SIZE && !holds; z += 2) {
              holds = columnHoldsOre(islands, x, z);
            }
          }
          if (holds) withOre++;
        }
      }
      expect(chunks).toBeGreaterThan(300);
      expect(withOre / chunks, `seed ${seed}`).toBeLessThan(0.15);
    }
  });
});

describe('TerrainContext.oreIslands (C5)', () => {
  it('is present on a progression site and carries the islands of the same seed and spawn', () => {
    const islands = islandContext(42).oreIslands;
    expect(islands).not.toBeNull();
    expect(islands!.list().length).toBeGreaterThanOrEqual(3);
  });

  it('is null when ore deposits are off', () => {
    expect(islandContext(42, false).oreIslands).toBeNull();
  });

  it('is null when the oreDeposits flag is absent (campaign sites)', () => {
    expect(islandContext(42, undefined).oreIslands).toBeNull();
  });

  it('differs between seeds', () => {
    expect(islandsOf(1).list()).not.toEqual(islandsOf(2).list());
  });
});
