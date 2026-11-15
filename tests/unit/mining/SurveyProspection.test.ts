// BlastSimulator2026 — Long-range prospection (#2286): a coarse island map, noisy at low skill, exact at the top.

import { describe, it, expect } from 'vitest';
import { prospectIslands, type ProspectedIsland } from '../../../src/core/mining/SurveyProspection.js';
import type { OreIsland } from '../../../src/core/world/OreIslands.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  SURVEY_COVERAGE_RADIUS, PROSPECTION_POSITION_ERROR_M, PROSPECTION_FALSE_LEAD_MAX,
  PROSPECTION_RADIUS_STEP_M, PROSPECTION_TOP_SKILL,
} from '../../../src/core/config/balance.js';

const CENTRE = { centerX: 100, centerZ: 200 } as const;
const RANGE = SURVEY_COVERAGE_RADIUS.prospection;

function island(dx: number, dz: number, radius: number, oreIds: readonly string[]): OreIsland {
  const x = CENTRE.centerX + dx;
  const z = CENTRE.centerZ + dz;
  return { x, z, radius, oreIds, distance: Math.hypot(dx, dz) };
}

/** Well separated (>= 150 m apart) so a reported entry can only belong to one island. Radii avoid .5 steps. */
const SPREAD: OreIsland[] = [
  island(250, 0, 18, ['craktonite']),
  island(-250, 10, 26, ['absurdium']),
  island(0, 260, 30, ['craktonite', 'absurdium']),
  island(10, -260, 14, ['absurdium', 'craktonite']),
  island(180, 180, 38, ['absurdium']),
  island(-180, -180, 22, ['craktonite']),
  island(-190, 190, 12, ['craktonite']),
  island(190, -190, 34, ['absurdium']),
];

const run = (islands: readonly OreIsland[], skillLevel: number, seed: number): ProspectedIsland[] =>
  prospectIslands(islands, { ...CENTRE, skillLevel }, new Random(seed));

const roundedRadius = (r: number): number => Math.round(r / PROSPECTION_RADIUS_STEP_M) * PROSPECTION_RADIUS_STEP_M;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
/** Rounding of a reported position to whole metres may add a little to the bound. */
const POSITION_SLACK_M = 1;

/** Entries of `out` sitting within the position error of a true island. */
function entriesNear(out: readonly ProspectedIsland[], truth: OreIsland): ProspectedIsland[] {
  return out.filter((o) => dist(o, truth) <= PROSPECTION_POSITION_ERROR_M + POSITION_SLACK_M);
}

describe('prospectIslands — top skill (C4)', () => {
  it('reports every in-range island exactly once, no more', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const out = run(SPREAD, PROSPECTION_TOP_SKILL, seed);
      expect(out).toHaveLength(SPREAD.length);
      for (const truth of SPREAD) expect(entriesNear(out, truth)).toHaveLength(1);
    }
  });

  it('reports the exact centre of each island', () => {
    for (const seed of [1, 7, 31]) {
      const out = run(SPREAD, PROSPECTION_TOP_SKILL, seed);
      for (const truth of SPREAD) {
        expect(out.some((o) => o.x === truth.x && o.z === truth.z)).toBe(true);
      }
    }
  });

  it('names the first ore id as the dominant ore, also for a two-ore island', () => {
    for (const seed of [1, 7, 31]) {
      const out = run(SPREAD, PROSPECTION_TOP_SKILL, seed);
      for (const truth of SPREAD) {
        const entry = out.find((o) => o.x === truth.x && o.z === truth.z)!;
        expect(entry.oreId).toBe(truth.oreIds[0]);
      }
    }
  });

  it('reports the true radius rounded to the radius step', () => {
    const out = run(SPREAD, PROSPECTION_TOP_SKILL, 5);
    for (const truth of SPREAD) {
      const entry = out.find((o) => o.x === truth.x && o.z === truth.z)!;
      expect(entry.radius).toBe(roundedRadius(truth.radius));
      expect(entry.radius % PROSPECTION_RADIUS_STEP_M).toBe(0);
    }
  });

  it('never reports an island whose centre is out of range', () => {
    const outside = [island(RANGE + 25, 0, 20, ['craktonite']), island(0, -(RANGE + 100), 20, ['absurdium'])];
    for (const seed of [1, 2, 3]) {
      expect(run(outside, PROSPECTION_TOP_SKILL, seed)).toEqual([]);
    }
  });

  it('keeps an island just inside the range and drops one just outside', () => {
    const inside = island(RANGE - 2, 0, 20, ['craktonite']);
    const beyond = island(0, RANGE + 2, 20, ['absurdium']);
    const out = run([inside, beyond], PROSPECTION_TOP_SKILL, 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBe(inside.x);
    expect(out[0]!.z).toBe(inside.z);
  });

  it('measures the range from the survey centre, not from the origin', () => {
    // Far from (0,0) yet next to the survey centre.
    const near = island(5, 5, 20, ['craktonite']);
    expect(run([near], PROSPECTION_TOP_SKILL, 1)).toHaveLength(1);
    // Close to the origin but beyond the radius from the survey centre.
    const farFromCentre: OreIsland = { x: 0, z: 0, radius: 20, oreIds: ['craktonite'], distance: 0 };
    expect(prospectIslands([farFromCentre], { centerX: RANGE + 50, centerZ: 0, skillLevel: PROSPECTION_TOP_SKILL }, new Random(1))).toEqual([]);
  });

  it('an empty island list yields an empty report, at any skill', () => {
    for (const skill of [1, 3, PROSPECTION_TOP_SKILL]) {
      expect(run([], skill, 9)).toEqual([]);
    }
  });

  it('does not mutate the islands it reads', () => {
    const before = JSON.parse(JSON.stringify(SPREAD)) as OreIsland[];
    run(SPREAD, 1, 11);
    run(SPREAD, PROSPECTION_TOP_SKILL, 11);
    expect(SPREAD).toEqual(before);
  });
});

describe('prospectIslands — skill 1 noise (C5)', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

  it('drops no island and keeps every reported position within the error bound of its island', () => {
    for (const seed of seeds) {
      const out = run(SPREAD, 1, seed);
      for (const truth of SPREAD) {
        expect(entriesNear(out, truth), `seed ${seed} island ${truth.x},${truth.z}`).toHaveLength(1);
      }
    }
  });

  it('adds at most PROSPECTION_FALSE_LEAD_MAX entries beyond the real islands', () => {
    for (const seed of seeds) {
      const out = run(SPREAD, 1, seed);
      expect(out.length).toBeGreaterThanOrEqual(SPREAD.length);
      expect(out.length).toBeLessThanOrEqual(SPREAD.length + PROSPECTION_FALSE_LEAD_MAX);
    }
  });

  it('some seed jitters a position off the true centre', () => {
    const jittered = seeds.some((seed) => {
      const out = run(SPREAD, 1, seed);
      return SPREAD.some((truth) => !out.some((o) => o.x === truth.x && o.z === truth.z));
    });
    expect(jittered).toBe(true);
  });

  it('some seed misreads the dominant ore of an island', () => {
    const misread = seeds.some((seed) => {
      const out = run(SPREAD, 1, seed);
      return SPREAD.some((truth) => entriesNear(out, truth).some((o) => o.oreId !== truth.oreIds[0]));
    });
    expect(misread).toBe(true);
  });

  it('some seed adds a false lead', () => {
    expect(seeds.some((seed) => run(SPREAD, 1, seed).length > SPREAD.length)).toBe(true);
  });

  it('every reported entry carries a non-empty ore id and a non-negative radius', () => {
    for (const seed of seeds.slice(0, 20)) {
      for (const o of run(SPREAD, 1, seed)) {
        expect(typeof o.oreId).toBe('string');
        expect(o.oreId.length).toBeGreaterThan(0);
        expect(o.radius).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('reports the radius rounded to the radius step for every real island', () => {
    for (const seed of seeds.slice(0, 20)) {
      const out = run(SPREAD, 1, seed);
      for (const truth of SPREAD) {
        expect(entriesNear(out, truth)[0]!.radius).toBe(roundedRadius(truth.radius));
      }
    }
  });

  it('the same seed gives the identical report', () => {
    for (const seed of [1, 5, 17]) {
      expect(run(SPREAD, 1, seed)).toEqual(run(SPREAD, 1, seed));
    }
  });

  it('different seeds can differ', () => {
    const reports = new Set(seeds.map((seed) => JSON.stringify(run(SPREAD, 1, seed))));
    expect(reports.size).toBeGreaterThan(1);
  });

  it('still never reports an out-of-range island, false leads aside', () => {
    const lone = island(RANGE + 50, 0, 20, ['craktonite']);
    for (const seed of seeds) {
      const out = run([lone], 1, seed);
      expect(entriesNear(out, lone)).toEqual([]);
    }
  });

  it('an empty island list adds no more than the false-lead cap', () => {
    for (const seed of seeds) {
      expect(run([], 1, seed).length).toBeLessThanOrEqual(PROSPECTION_FALSE_LEAD_MAX);
    }
  });
});

describe('prospectIslands — noise falls with skill', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

  function meanDisplacement(skill: number): number {
    let sum = 0;
    let n = 0;
    for (const seed of seeds) {
      const out = run(SPREAD, skill, seed);
      for (const truth of SPREAD) {
        const near = out.reduce((best, o) => Math.min(best, dist(o, truth)), Infinity);
        sum += near;
        n++;
      }
    }
    return sum / n;
  }

  it('a skill 3 surveyor is off by less on average than a skill 1 surveyor', () => {
    expect(meanDisplacement(3)).toBeLessThan(meanDisplacement(1));
  });

  it('the top skill is off by nothing', () => {
    expect(meanDisplacement(PROSPECTION_TOP_SKILL)).toBe(0);
  });

  it('the top skill never adds a false lead nor misreads an ore', () => {
    for (const seed of seeds) {
      const out = run(SPREAD, PROSPECTION_TOP_SKILL, seed);
      expect(out).toHaveLength(SPREAD.length);
      for (const truth of SPREAD) {
        expect(out.find((o) => o.x === truth.x && o.z === truth.z)!.oreId).toBe(truth.oreIds[0]);
      }
    }
  });
});
