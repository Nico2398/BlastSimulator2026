// BlastSimulator2026 — The blast pipeline has to answer to plan changes.
//
// These are balance guards, not physics tests. Each one varies exactly one
// thing a player controls and checks the result moves the way the player would
// expect. They assert relationships rather than numbers, so retuning the
// constants keeps them meaningful instead of forcing a rewrite.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast, type BlastResult } from '../../src/core/mining/BlastExecution.js';
import { summariseMuckPile } from '../../src/core/mining/MuckPileSummary.js';

interface Shot {
  rock?: string;
  explosive?: string;
  kg?: number;
  stemming?: number;
  spacing?: number;
  depth?: number;
  rows?: number;
  cols?: number;
}

/** A block of one rock, 21×11×21, surface at y=10. */
function bench(rock: string): VoxelGrid {
  const grid = new VoxelGrid(40, 20, 40);
  for (let z = 5; z <= 25; z++) {
    for (let y = 0; y <= 10; y++) {
      for (let x = 5; x <= 25; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

function fire(shot: Shot): BlastResult {
  return fireOnto(shot).result;
}

/** As `fire`, but hands back the ground the rock landed on too. */
function fireOnto(shot: Shot): { result: BlastResult; grid: VoxelGrid } {
  const {
    rock = 'molite', explosive = 'boomite', kg = 8, stemming = 2,
    spacing = 4, depth = 8, rows = 2, cols = 3,
  } = shot;

  resetHoleIds();
  const grid = bench(rock);
  const holes = createGridPlan({ x: 12, z: 12 }, rows, cols, spacing, depth, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, kg, stemming);
  const plan = assembleBlastPlan(holes, charges, autoVPattern(holes, 25));

  const result = executeBlast(plan, grid, []);
  expect(result, 'blast plan was rejected').not.toBeNull();
  return { result: result!, grid };
}

const meanFragmentSize = (r: BlastResult): number =>
  r.fragmentCount > 0 ? r.totalRockVolume / r.fragmentCount : 0;

beforeEach(() => resetHoleIds());

describe('Blast balance — more explosive does more', () => {
  it('breaks more rock', () => {
    expect(fire({ kg: 8 }).clearedVoxels).toBeGreaterThan(fire({ kg: 2 }).clearedVoxels);
  });

  it('breaks it into more pieces', () => {
    expect(fire({ kg: 8 }).fragmentCount).toBeGreaterThan(fire({ kg: 2 }).fragmentCount);
  });

  it('a stronger explosive at the same weight breaks more', () => {
    // 4 kg is inside the valid loading range of both.
    expect(fire({ explosive: 'dynatomics', kg: 4 }).clearedVoxels)
      .toBeGreaterThan(fire({ explosive: 'boomite', kg: 4 }).clearedVoxels);
  });
});

describe('Blast balance — stemming decides whether rock is thrown', () => {
  it('a minimally stemmed hole throws rock further than a stemmed one', () => {
    expect(fire({ stemming: 0.5 }).maxThrowDistance)
      .toBeGreaterThan(fire({ stemming: 3 }).maxThrowDistance);
  });

  it('a properly stemmed shot produces no dangerous projections', () => {
    expect(fire({ stemming: 3 }).projectionCount).toBe(0);
  });

  it('a minimally stemmed overcharge does', () => {
    expect(fire({ stemming: 0.5, kg: 8 }).projectionCount).toBeGreaterThan(0);
  });

  it('and is rated worse for it', () => {
    const careless = fire({ stemming: 0.5, kg: 8 });
    const careful = fire({ stemming: 3, kg: 8 });

    expect(['bad', 'catastrophic']).toContain(careless.rating);
    expect(['perfect', 'good']).toContain(careful.rating);
  });

  it('stemming does not cost breakage — the careful shot still moves rock', () => {
    // The stemmed shot keeps its energy in the rock, so it must break at least
    // as much as the one that vented up the hole.
    expect(fire({ stemming: 3 }).clearedVoxels).toBeGreaterThanOrEqual(fire({ stemming: 0.5 }).clearedVoxels);
  });
});

describe('Blast balance — the rock fights back', () => {
  it('harder rock resists a charge that shatters soft rock', () => {
    expect(fire({ rock: 'cruite' }).clearedVoxels)
      .toBeGreaterThan(fire({ rock: 'titanite' }).clearedVoxels);
  });

  it('harder rock leaves coarser muck for the same charge', () => {
    expect(meanFragmentSize(fire({ rock: 'titanite' })))
      .toBeGreaterThanOrEqual(meanFragmentSize(fire({ rock: 'cruite' })));
  });
});

describe('Blast balance — pattern geometry', () => {
  // Spacing is the lever that actually controls fragment size. Charge weight
  // mostly decides how much rock comes out: a bigger charge reaches further, so
  // it breaks more rock at a similar powder factor rather than pulverising the
  // same rock. Bringing the holes closer overlaps their energy in the same
  // burden, which is what makes the muck finer.
  it('holes spaced tighter leave finer muck', () => {
    expect(meanFragmentSize(fire({ spacing: 2 }))).toBeLessThan(meanFragmentSize(fire({ spacing: 6 })));
  });

  it('holes spaced tighter leave fewer oversized boulders', () => {
    const share = (r: BlastResult): number => r.oversizedFragments / Math.max(1, r.fragmentCount);
    expect(share(fire({ spacing: 2 }))).toBeLessThan(share(fire({ spacing: 6 })));
  });

  it('holes spread too thin throw rock instead of breaking it', () => {
    // Widely spaced holes have no neighbour to work against, so more of each
    // charge vents to the free face and heaves rock across the pit.
    expect(fire({ spacing: 6 }).maxThrowDistance).toBeGreaterThan(fire({ spacing: 2 }).maxThrowDistance);
  });

  it('more holes break more rock', () => {
    expect(fire({ rows: 3, cols: 3 }).clearedVoxels).toBeGreaterThan(fire({ rows: 1, cols: 2 }).clearedVoxels);
  });

  it('a charge buried too deep fails to break out to the surface', () => {
    const shallow = fire({ depth: 8 });
    const buried = fire({ depth: 8, kg: 2, spacing: 6, rows: 1, cols: 1 });

    // The small deep charge still breaks rock around itself, but nothing like
    // the pattern that reaches daylight.
    expect(buried.clearedVoxels).toBeLessThan(shallow.clearedVoxels);
  });
});

describe('Blast balance — the pipeline stays coherent', () => {
  it('every blast accounts for its rock exactly once', () => {
    const r = fire({ kg: 8 });
    const fragmentVolume = r.fragments.reduce((s, f) => s + f.volume, 0);

    expect(fragmentVolume).toBeCloseTo(r.totalRockVolume, 4);
  });

  it('never flies more projectiles than fragments', () => {
    const r = fire({ stemming: 0.5, kg: 8 });
    expect(r.projectileCount).toBeLessThanOrEqual(r.fragmentCount);
  });

  it('gives every fragment a flight', () => {
    const r = fire({ kg: 8 });
    expect(r.flights.length).toBe(r.fragmentCount);
  });

  it('leaves no rock hanging in the air, however hard it was thrown', () => {
    // The one failure the other channels cannot see: a fragment whose resting
    // place has nothing under it. It reads as a floating boulder on screen and
    // as a perfectly ordinary blast in every number the report carries.
    for (const shot of [{ kg: 8 }, { kg: 8, stemming: 0.5 }, { kg: 20, stemming: 0.5, explosive: 'dynatomics' }]) {
      const { result, grid } = fireOnto(shot);
      const pile = summariseMuckPile(result.fragments, grid);

      expect(pile.floating, `${JSON.stringify(shot)} left ${pile.floating} fragments airborne`).toBe(0);
    }
  });

  it('is reproducible — the same plan on the same rock blasts the same way', () => {
    const a = fire({ kg: 8 });
    const b = fire({ kg: 8 });

    expect(b.clearedVoxels).toBe(a.clearedVoxels);
    expect(b.fragmentCount).toBe(a.fragmentCount);
    expect(b.maxThrowDistance).toBeCloseTo(a.maxThrowDistance, 9);
    expect(b.fragments.map(f => f.position)).toEqual(a.fragments.map(f => f.position));
  });
});
