// BlastSimulator2026 — The blast pipeline has to answer to plan changes.
//
// These are balance guards, not physics tests. Each one varies exactly one
// thing a player controls and checks the result moves the way the player would
// expect. They assert relationships rather than numbers, so retuning the
// constants keeps them meaningful instead of forcing a rewrite.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast, type BlastResult } from '../../src/core/mining/BlastExecution.js';
import { summariseMuckPile } from '../../src/core/mining/MuckPileSummary.js';
import { buildPlanEnergyField } from '../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels } from '../../src/core/mining/VoxelFragmentation.js';
import { getAllExplosives } from '../../src/core/world/ExplosiveCatalog.js';

const holeCounter = { nextHoleId: 1 };

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
  const grid = new VoxelGrid(40, 40);
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

  holeCounter.nextHoleId = 1;
  const grid = bench(rock);
  const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, rows, cols, spacing, depth, 0.089);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, kg, stemming);
  const plan = assembleBlastPlan(holes, charges);

  const result = executeBlast(plan, grid, []);
  expect(result, 'blast plan was rejected').not.toBeNull();
  return { result: result!, grid };
}

const meanFragmentSize = (r: BlastResult): number =>
  r.fragmentCount > 0 ? r.totalRockVolume / r.fragmentCount : 0;

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('Blast balance — more explosive does more', () => {
  it('breaks more rock', () => {
    expect(fire({ kg: 8 }).clearedVoxels).toBeGreaterThan(fire({ kg: 2 }).clearedVoxels);
  });

  it('breaks it into more pieces', () => {
    expect(fire({ kg: 8 }).fragmentCount).toBeGreaterThan(fire({ kg: 2 }).fragmentCount);
  });

  it('a stronger explosive at the same weight breaks more on hard rock too', () => {
    expect(fire({ rock: 'obstiite', explosive: 'dynatomics', kg: 4, depth: 6 }).clearedVoxels)
      .toBeGreaterThan(fire({ rock: 'obstiite', explosive: 'boomite', kg: 4, depth: 6 }).clearedVoxels);
  });

  it('a stronger explosive at the same weight breaks more', () => {
    // 4 kg is inside the valid loading range of both.
    expect(fire({ explosive: 'dynatomics', kg: 4 }).clearedVoxels)
      .toBeGreaterThan(fire({ explosive: 'boomite', kg: 4 }).clearedVoxels);
  });
});

describe('Blast balance — stemming decides whether rock is thrown', () => {
  it('a minimally stemmed hole throws rock further than a stemmed one', () => {
    expect(fire({ rock: 'cruite', stemming: 0.5 }).maxThrowDistance)
      .toBeGreaterThan(fire({ rock: 'cruite', stemming: 3 }).maxThrowDistance);
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
    expect(meanFragmentSize(fire({ rock: 'titanite', explosive: 'dynatomics' })))
      .toBeGreaterThanOrEqual(meanFragmentSize(fire({ rock: 'cruite', explosive: 'dynatomics' })));
  });
});

describe('Blast balance — the explosive never changes the rock (#2197)', () => {
  /** The breaking-threshold array of the energy field a shot builds over a block of `rock`. */
  function thresholdsOf(shot: Shot): number[] {
    const { rock = 'obstiite', explosive = 'boomite', kg = 3, stemming = 2, depth = 6 } = shot;
    holeCounter.nextHoleId = 1;
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, depth, 0.089);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, kg, stemming);
    const field = buildPlanEnergyField(assembleBlastPlan(holes, charges), bench(rock));
    expect(field, 'plan was rejected').not.toBeNull();
    return Array.from(field!.threshold);
  }

  it('every catalog explosive builds the same breaking thresholds over the same rock', () => {
    const reference = thresholdsOf({ explosive: 'dynatomics' });
    expect(reference.some(v => v > 0)).toBe(true);
    for (const e of getAllExplosives()) {
      expect(thresholdsOf({ explosive: e.id, kg: e.minChargeKg }), e.id).toEqual(reference);
    }
  });

  it('two explosives delivering equal energy break the same rock identically', () => {
    // 340 x 4 = 400 x 3.4 = 1360: boomite and krackle sat a tier apart before #2197, and molite
    // (tier 2) used to cost boomite four times the energy it cost krackle.
    const boomite = fire({ rock: 'molite', explosive: 'boomite', kg: 4, depth: 6 });
    const krackle = fire({ rock: 'molite', explosive: 'krackle', kg: 3.4, depth: 6 });
    expect(boomite.clearedVoxels).toBeGreaterThan(0);
    expect(krackle.clearedVoxels).toBe(boomite.clearedVoxels);
  });

  it('equal energy also breaks tougher rock identically, whatever the former tiers', () => {
    // clunkite (tier 3): boomite fell two tiers short before #2197 and broke none of it.
    const boomite = fire({ rock: 'clunkite', explosive: 'boomite', kg: 4, depth: 6 });
    const krackle = fire({ rock: 'clunkite', explosive: 'krackle', kg: 3.4, depth: 6 });
    expect(krackle.clearedVoxels).toBeGreaterThan(0);
    expect(boomite.clearedVoxels).toBe(krackle.clearedVoxels);
  });

  it('a weak explosive at its maximum charge still breaks some hard rock', () => {
    const popRock = fire({ rock: 'obstiite', explosive: 'pop_rock', kg: 3, depth: 6 });
    expect(popRock.clearedVoxels).toBeGreaterThan(0);
  });

  it('what a weak explosive breaks grows with its energy, not all-or-nothing', () => {
    const half = fire({ rock: 'obstiite', explosive: 'pop_rock', kg: 1.5, depth: 6 }).clearedVoxels;
    const full = fire({ rock: 'obstiite', explosive: 'pop_rock', kg: 3, depth: 6 }).clearedVoxels;
    const strong = fire({ rock: 'obstiite', explosive: 'dynatomics', kg: 3, depth: 6 }).clearedVoxels;
    expect(full).toBeGreaterThan(half);
    expect(strong).toBeGreaterThan(full);
  });

  it('breaks more rock as the explosive gets stronger at one weight, on hard rock', () => {
    const cleared = ['pop_rock', 'boomite', 'krackle', 'dynatomics']
      .map(explosive => fire({ rock: 'obstiite', explosive, kg: 3, depth: 6 }).clearedVoxels);
    for (let i = 1; i < cleared.length; i++) expect(cleared[i]!).toBeGreaterThanOrEqual(cleared[i - 1]!);
    expect(cleared[cleared.length - 1]!).toBeGreaterThan(cleared[0]!);
  });

  it('the real blast clears exactly the voxels the preview field predicts, weak explosive on hard rock', () => {
    const shot = { rock: 'obstiite', explosive: 'pop_rock', kg: 3, depth: 6 };
    const { result } = fireOnto(shot);
    holeCounter.nextHoleId = 1;
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, 6, 0.089);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 3, 2);
    const grid = bench('obstiite');
    const preview = buildPlanEnergyField(assembleBlastPlan(holes, charges), grid)!;
    expect(result.clearedVoxels).toBeGreaterThan(0);
    expect(identifyFragmentedVoxels(preview, grid).fragmented.length).toBe(result.clearedVoxels);
  });

  it('a minimum charge of the weakest explosive in the hardest rock breaks nothing, without failing the blast', () => {
    const r = fire({ rock: 'titanite', explosive: 'pop_rock', kg: 0.5, depth: 6 });
    expect(r.clearedVoxels).toBe(0);
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
    expect(share(fire({ rock: 'cruite', spacing: 2 }))).toBeLessThan(share(fire({ rock: 'cruite', spacing: 6 })));
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
    for (const shot of [{ kg: 8 }, { kg: 8, stemming: 0.5 }, { kg: 15, stemming: 0.5, explosive: 'dynatomics' }]) {
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
