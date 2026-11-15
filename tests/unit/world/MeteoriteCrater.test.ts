// MeteoriteCrater — the one G3 impact crater of a progression world: a bowl with a raised rim over a
// body of ultra-hard meteoritic rock hosting treranium, placed far out, seeded and lazy (#2287)

import { describe, it, expect } from 'vitest';
import { MeteoriteCrater } from '../../../src/core/world/MeteoriteCrater.js';
import { rectTouchesProtectedStructure } from '../../../src/core/world/Structures.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import {
  METEORITE_ROCK_ID, METEORITE_CRATER_MIN_DISTANCE_M, METEORITE_CRATER_MAX_DISTANCE_M,
  METEORITE_CRATER_OUTER_RADIUS_M, METEORITE_CRATER_RIM_RADIUS_M, METEORITE_CRATER_DEPTH_M,
  METEORITE_CRATER_RIM_HEIGHT_M, METEORITE_BODY_RADIUS_M, METEORITE_BODY_DEPTH_M,
  METEORITE_CRATER_PLACEMENT_ATTEMPTS, ORE_ISLAND_MAX_DISTANCE_M, ORE_ISLAND_RADIUS_MAX_M,
  MAX_CLAIM_BRIDGE_CHUNKS,
} from '../../../src/core/config/balance.js';
import { CHUNK_SIZE } from '../../../src/core/world/VoxelGrid.js';
import {
  REFERENCE_SEEDS, SPAWN, islandContext, islandsOf, structuresOf, distanceFromSpawn,
} from '../../helpers/oreIslandSite.js';

/** A camera reach no base reaches past: the whole footprint must lie beyond it. */
const BASE_VIEW_M = 300;

function craterOf(seed: number, spawn: { x: number; z: number } = SPAWN): MeteoriteCrater {
  return new MeteoriteCrater(seed, spawn);
}

function infoOf(seed: number, spawn: { x: number; z: number } = SPAWN) {
  const info = craterOf(seed, spawn).info;
  if (!info) throw new Error(`seed ${seed}: no crater placed`);
  return info;
}

function squareAround(x: number, z: number, r: number): Rect {
  return { minX: x - r, minZ: z - r, maxX: x + r, maxZ: z + r };
}

describe('MeteoriteCrater — balance constants', () => {
  it('names the meteoritic rock id', () => {
    expect(METEORITE_ROCK_ID).toBe('meteorite');
  });

  it('keeps the placement range ordered, past every ore island and inside the claim bridge (C2)', () => {
    expect(METEORITE_CRATER_MIN_DISTANCE_M).toBeLessThanOrEqual(METEORITE_CRATER_MAX_DISTANCE_M);
    expect(METEORITE_CRATER_MIN_DISTANCE_M)
      .toBeGreaterThanOrEqual(ORE_ISLAND_MAX_DISTANCE_M + ORE_ISLAND_RADIUS_MAX_M - METEORITE_CRATER_OUTER_RADIUS_M);
    expect(METEORITE_CRATER_MAX_DISTANCE_M).toBeLessThanOrEqual(MAX_CLAIM_BRIDGE_CHUNKS * CHUNK_SIZE);
  });

  it('nests the crater: body inside the rim, rim inside the outer radius', () => {
    expect(METEORITE_BODY_RADIUS_M).toBeLessThan(METEORITE_CRATER_RIM_RADIUS_M);
    expect(METEORITE_CRATER_RIM_RADIUS_M).toBeLessThan(METEORITE_CRATER_OUTER_RADIUS_M);
  });
});

describe('MeteoriteCrater.info (C1, C2)', () => {
  it('places one crater for every reference seed', () => {
    for (const seed of REFERENCE_SEEDS) expect(craterOf(seed).info, `seed ${seed}`).not.toBeNull();
  });

  it('is deterministic: the same seed and spawn give the same placement', () => {
    for (const seed of REFERENCE_SEEDS) {
      expect(craterOf(seed).info).toEqual(craterOf(seed).info);
    }
  });

  it('returns the same placement on every read of one instance', () => {
    const crater = craterOf(42);
    expect(crater.info).toEqual(crater.info);
  });

  it('differs between seeds for most seeds', () => {
    const centres = new Set(REFERENCE_SEEDS.map(seed => {
      const { x, z } = infoOf(seed);
      return `${x},${z}`;
    }));
    expect(centres.size).toBeGreaterThanOrEqual(REFERENCE_SEEDS.length - 1);
  });

  it('lies between the min and max distance from spawn, and reports its own distance', () => {
    for (const seed of REFERENCE_SEEDS) {
      const info = infoOf(seed);
      const measured = distanceFromSpawn(info.x, info.z);
      expect(measured, `seed ${seed}`).toBeGreaterThanOrEqual(METEORITE_CRATER_MIN_DISTANCE_M - 1e-6);
      expect(measured, `seed ${seed}`).toBeLessThanOrEqual(METEORITE_CRATER_MAX_DISTANCE_M + 1e-6);
      expect(Math.abs(info.distance - measured)).toBeLessThan(1);
    }
  });

  it('reports a positive radius', () => {
    for (const seed of REFERENCE_SEEDS) expect(infoOf(seed).radius).toBeGreaterThan(0);
  });

  it('follows the spawn it is given: the range is measured from that point', () => {
    const spawn = { x: 500, z: -300 };
    for (const seed of [1, 42]) {
      const info = infoOf(seed, spawn);
      const d = Math.hypot(info.x - spawn.x, info.z - spawn.z);
      expect(d).toBeGreaterThanOrEqual(METEORITE_CRATER_MIN_DISTANCE_M - 1e-6);
      expect(d).toBeLessThanOrEqual(METEORITE_CRATER_MAX_DISTANCE_M + 1e-6);
    }
  });

  it('keeps the centre chunk within the reach of one claim bridge', () => {
    for (const seed of REFERENCE_SEEDS) {
      const info = infoOf(seed);
      expect(distanceFromSpawn(info.x, info.z)).toBeLessThanOrEqual(MAX_CLAIM_BRIDGE_CHUNKS * CHUNK_SIZE);
    }
  });

  it('keeps the body clear of every ore island', () => {
    for (const seed of REFERENCE_SEEDS) {
      const info = infoOf(seed);
      for (const island of islandsOf(seed).list()) {
        expect(Math.hypot(island.x - info.x, island.z - info.z), `seed ${seed}`)
          .toBeGreaterThanOrEqual(island.radius + METEORITE_BODY_RADIUS_M);
      }
    }
  });
});

describe('MeteoriteCrater protected-ground veto (C3)', () => {
  it('places no crater when the predicate vetoes every square', () => {
    const crater = new MeteoriteCrater(42, SPAWN, () => true);
    expect(crater.info).toBeNull();
  });

  it('a crater that was not placed adds no relief and holds no body', () => {
    const crater = new MeteoriteCrater(42, SPAWN, () => true);
    const real = infoOf(42);
    expect(crater.reliefAt(real.x, real.z)).toBe(0);
    expect(crater.bodyAt(real.x, real.z, 5)).toBeNull();
    expect(crater.reliefAt(SPAWN.x, SPAWN.z)).toBe(0);
  });

  it('gives up after a bounded number of candidate spots', () => {
    let asked = 0;
    const crater = new MeteoriteCrater(42, SPAWN, () => { asked++; return true; });
    expect(crater.info).toBeNull();
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThanOrEqual(METEORITE_CRATER_PLACEMENT_ATTEMPTS);
  });

  it('asks about a bounding square that covers the outer radius of the crater it keeps', () => {
    const asked: Rect[] = [];
    const info = new MeteoriteCrater(42, SPAWN, rect => { asked.push(rect); return false; }).info;
    expect(info).not.toBeNull();
    const covered = asked.some(r =>
      r.minX <= info!.x - METEORITE_CRATER_OUTER_RADIUS_M && r.maxX >= info!.x + METEORITE_CRATER_OUTER_RADIUS_M
      && r.minZ <= info!.z - METEORITE_CRATER_OUTER_RADIUS_M && r.maxZ >= info!.z + METEORITE_CRATER_OUTER_RADIUS_M);
    expect(covered).toBe(true);
  });

  it('keeps no crater whose square the predicate vetoes', () => {
    const veto = (rect: Rect): boolean => rect.minX < SPAWN.x;
    const info = new MeteoriteCrater(42, SPAWN, veto).info;
    if (info) expect(veto(squareAround(info.x, info.z, METEORITE_CRATER_OUTER_RADIUS_M))).toBe(false);
  });

  it('moves to another spot when the first candidate is vetoed', () => {
    const free = infoOf(42);
    let calls = 0;
    const moved = new MeteoriteCrater(42, SPAWN, () => ++calls === 1).info;
    expect(moved).not.toBeNull();
    expect(`${moved!.x},${moved!.z}`).not.toBe(`${free.x},${free.z}`);
  });

  it('no crater on a reference world touches a village, river or landmark', () => {
    for (const seed of REFERENCE_SEEDS) {
      const structures = structuresOf(seed);
      // The wired crater: the veto is the protected-structure set itself, as the claim path builds it.
      const wired = islandContext(seed).crater?.info;
      if (!wired) throw new Error(`seed ${seed}: no crater placed`);
      const square = squareAround(wired.x, wired.z, METEORITE_CRATER_OUTER_RADIUS_M);
      expect(rectTouchesProtectedStructure(structures, square), `seed ${seed}`).toBe(false);
    }
  });
});

describe('MeteoriteCrater.reliefAt (C4)', () => {
  it('is deep below the natural ground at the centre', () => {
    for (const seed of REFERENCE_SEEDS) {
      const { x, z } = infoOf(seed);
      const relief = craterOf(seed).reliefAt(x, z);
      expect(relief, `seed ${seed}`).toBeLessThan(-METEORITE_CRATER_DEPTH_M * 0.75);
      expect(relief, `seed ${seed}`).toBeGreaterThan(-METEORITE_CRATER_DEPTH_M * 1.25);
    }
  });

  it('stands above the natural ground on the rim ring, in every direction', () => {
    for (const seed of REFERENCE_SEEDS) {
      const crater = craterOf(seed);
      const { x, z } = infoOf(seed);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const relief = crater.reliefAt(x + dx * METEORITE_CRATER_RIM_RADIUS_M, z + dz * METEORITE_CRATER_RIM_RADIUS_M);
        expect(relief, `seed ${seed} dir ${dx},${dz}`).toBeGreaterThan(METEORITE_CRATER_RIM_HEIGHT_M * 0.75);
        expect(relief, `seed ${seed} dir ${dx},${dz}`).toBeLessThan(METEORITE_CRATER_RIM_HEIGHT_M * 1.25);
      }
    }
  });

  it('is lower inside the bowl than on the rim and sinks below the ground half way in', () => {
    const crater = craterOf(42);
    const { x, z } = infoOf(42);
    expect(crater.reliefAt(x + METEORITE_CRATER_RIM_RADIUS_M / 2, z)).toBeLessThan(0);
    expect(crater.reliefAt(x, z)).toBeLessThan(crater.reliefAt(x + METEORITE_CRATER_RIM_RADIUS_M, z));
  });

  it('is 0 beyond the outer radius', () => {
    for (const seed of REFERENCE_SEEDS) {
      const crater = craterOf(seed);
      const { x, z } = infoOf(seed);
      for (const extra of [0.5, 5, 50]) {
        expect(crater.reliefAt(x + METEORITE_CRATER_OUTER_RADIUS_M + extra, z)).toBe(0);
        expect(crater.reliefAt(x, z - METEORITE_CRATER_OUTER_RADIUS_M - extra)).toBe(0);
      }
    }
  });

  it('fades out at the outer radius rather than stepping', () => {
    const crater = craterOf(42);
    const { x, z } = infoOf(42);
    expect(Math.abs(crater.reliefAt(x + METEORITE_CRATER_OUTER_RADIUS_M - 0.05, z))).toBeLessThan(0.5);
  });

  it('is 0 near spawn and at far-off columns', () => {
    for (const seed of REFERENCE_SEEDS) {
      const crater = craterOf(seed);
      for (const [x, z] of [[SPAWN.x, SPAWN.z], [0, 0], [63, 63], [150, -90], [-400, 220], [1000, 1000]] as const) {
        expect(crater.reliefAt(x, z), `seed ${seed} at ${x},${z}`).toBe(0);
      }
    }
  });

  it('is deterministic', () => {
    const a = craterOf(7);
    const b = craterOf(7);
    const { x, z } = infoOf(7);
    for (const r of [0, 5, 12, 19, 22]) expect(a.reliefAt(x + r, z)).toBe(b.reliefAt(x + r, z));
  });
});

describe('MeteoriteCrater.bodyAt (C5)', () => {
  it('holds meteoritic rock with treranium below the floor at the centre', () => {
    for (const seed of REFERENCE_SEEDS) {
      const crater = craterOf(seed);
      const { x, z } = infoOf(seed);
      for (const depth of [3, 6, 10]) {
        const body = crater.bodyAt(x, z, depth);
        expect(body, `seed ${seed} depth ${depth}`).not.toBeNull();
        expect(body!.rockId).toBe(METEORITE_ROCK_ID);
        expect(body!.oreDensities.treranium, `seed ${seed} depth ${depth}`).toBeGreaterThan(0);
      }
    }
  });

  it('holds treranium at the core at about the core density or less, never above 1', () => {
    const { x, z } = infoOf(42);
    const body = craterOf(42).bodyAt(x, z, 5)!;
    for (const density of Object.values(body.oreDensities)) {
      expect(density).toBeGreaterThanOrEqual(0);
      expect(density).toBeLessThanOrEqual(1);
    }
  });

  it('holds the body half way out to its radius', () => {
    const { x, z } = infoOf(42);
    const body = craterOf(42).bodyAt(x + METEORITE_BODY_RADIUS_M / 2, z, 3);
    expect(body).not.toBeNull();
    expect(body!.rockId).toBe(METEORITE_ROCK_ID);
  });

  it('leaves ordinary ground on top of the body', () => {
    const { x, z } = infoOf(42);
    expect(craterOf(42).bodyAt(x, z, 0)).toBeNull();
  });

  it('ends below the body depth', () => {
    const { x, z } = infoOf(42);
    expect(craterOf(42).bodyAt(x, z, METEORITE_BODY_DEPTH_M + 2)).toBeNull();
  });

  it('ends beyond the body radius', () => {
    const crater = craterOf(42);
    const { x, z } = infoOf(42);
    for (const depth of [2, 5, 10]) {
      expect(crater.bodyAt(x + METEORITE_BODY_RADIUS_M + 2, z, depth)).toBeNull();
      expect(crater.bodyAt(x, z + METEORITE_CRATER_OUTER_RADIUS_M, depth)).toBeNull();
    }
  });

  it('is null near spawn and at far-off columns', () => {
    for (const seed of REFERENCE_SEEDS) {
      const crater = craterOf(seed);
      for (const [x, z] of [[SPAWN.x, SPAWN.z], [100, 100], [-400, 220]] as const) {
        for (const depth of [0, 5, 12]) expect(crater.bodyAt(x, z, depth)).toBeNull();
      }
    }
  });

  it('is deterministic', () => {
    const { x, z } = infoOf(3);
    expect(craterOf(3).bodyAt(x + 3, z - 2, 7)).toEqual(craterOf(3).bodyAt(x + 3, z - 2, 7));
  });
});

describe('MeteoriteCrater is out of sight and lazy (C6, C8)', () => {
  it('keeps the whole footprint beyond the view distance of the base', () => {
    for (const seed of REFERENCE_SEEDS) {
      const info = infoOf(seed);
      expect(distanceFromSpawn(info.x, info.z) - METEORITE_CRATER_OUTER_RADIUS_M, `seed ${seed}`).toBeGreaterThan(BASE_VIEW_M);
    }
  });

  it('never calls the protected-structure veto for a column near spawn', () => {
    let asked = 0;
    const crater = new MeteoriteCrater(42, SPAWN, () => { asked++; return false; });
    expect(crater.reliefAt(SPAWN.x, SPAWN.z)).toBe(0);
    expect(crater.reliefAt(SPAWN.x + 20, SPAWN.z - 20)).toBe(0);
    expect(crater.bodyAt(SPAWN.x, SPAWN.z, 5)).toBeNull();
    expect(asked).toBe(0);
  });

  it('does not ask the veto at construction, only when the placement is first needed', () => {
    let asked = 0;
    const crater = new MeteoriteCrater(42, SPAWN, () => { asked++; return false; });
    expect(asked).toBe(0);
    expect(crater.info).not.toBeNull();
    expect(asked).toBeGreaterThan(0);
  });

  it('places once: a second read does not ask the veto again', () => {
    let asked = 0;
    const crater = new MeteoriteCrater(42, SPAWN, () => { asked++; return false; });
    void crater.info;
    const afterFirst = asked;
    void crater.info;
    void crater.reliefAt(SPAWN.x, SPAWN.z);
    expect(asked).toBe(afterFirst);
  });
});
