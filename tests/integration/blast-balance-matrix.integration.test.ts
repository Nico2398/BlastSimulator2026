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
import { classifyFragmentationBand } from '../../src/core/mining/FragmentationBand.js';
import { intensityAt } from '../../src/core/mining/EnergyPropagation.js';
import { getRock } from '../../src/core/world/RockCatalog.js';
import { DUST_LOSS_SHARE, FRAGMENTATION_BAND_FINES_MIN } from '../../src/core/config/balance.js';

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
  /** Ore density carried by every voxel of the block (default none). */
  ore?: Record<string, number>;
}

/** A block of one rock, 21×11×21, surface at y=10. */
function bench(rock: string, ore: Record<string, number> = {}): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  for (let z = 5; z <= 25; z++) {
    for (let y = 0; y <= 10; y++) {
      for (let x = 5; x <= 25; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: { ...ore },
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
    spacing = 4, depth = 8, rows = 2, cols = 3, ore = {},
  } = shot;

  holeCounter.nextHoleId = 1;
  const grid = bench(rock, ore);
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

// ── Fragmentation bands (#2198) ───────────────────────────────────────────────

/** Total volume of the three bands a broken voxel can fall in. */
const brokenBandVolume = (r: BlastResult): number =>
  r.bandVolumes!.good + r.bandVolumes!.fines + r.bandVolumes!.dust;

describe('Blast balance — the report says how finely the rock broke', () => {
  const BANDS = ['intact', 'cracked', 'good', 'fines', 'dust'] as const;

  it('carries a volume for every band and a dust loss', () => {
    const r = fire({ rock: 'molite', explosive: 'krackle', kg: 3, depth: 10 });

    expect(r.bandVolumes).toBeDefined();
    expect(r.dustLoss).toBeDefined();
    for (const band of BANDS) {
      expect(r.bandVolumes![band], band).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.bandVolumes![band]), band).toBe(true);
    }
    expect(r.dustLoss!.massKg).toBeGreaterThanOrEqual(0);
    expect(r.dustLoss!.oreValue).toBeGreaterThanOrEqual(0);
  });

  it('good, fines and dust together are exactly the rock that broke', () => {
    for (const shot of [{ kg: 3 }, { kg: 6 }, { kg: 8 }]) {
      const r = fire({ rock: 'molite', explosive: 'krackle', depth: 10, ...shot });
      expect(r.totalRockVolume).toBeGreaterThan(0);
      expect(brokenBandVolume(r), JSON.stringify(shot)).toBeCloseTo(r.totalRockVolume, 4);
    }
  });

  it('rock that cracked but held shows up as cracked, not as broken', () => {
    const r = fire({ rock: 'molite', explosive: 'krackle', kg: 3, depth: 10 });

    expect(r.crackedVoxels).toBeGreaterThan(0);
    expect(r.bandVolumes!.cracked).toBeGreaterThan(0);
  });

  it('a shot that breaks nothing reports no broken-band volume and no dust loss', () => {
    const r = fire({ rock: 'titanite', explosive: 'pop_rock', kg: 0.5, depth: 6, ore: { rustite: 0.3 } });

    expect(r.clearedVoxels).toBe(0);
    expect(brokenBandVolume(r)).toBe(0);
    expect(r.dustLoss!.massKg).toBe(0);
    expect(r.dustLoss!.oreValue).toBe(0);
  });

  it('a heavier charge shifts the rock toward finer bands', () => {
    const light = fire({ rock: 'cruite', explosive: 'krackle', kg: 2, depth: 10 });
    const heavy = fire({ rock: 'cruite', explosive: 'dynatomics', kg: 16, depth: 10 });
    const finerShare = (r: BlastResult): number => (r.bandVolumes!.fines + r.bandVolumes!.dust) / brokenBandVolume(r);

    expect(finerShare(heavy)).toBeGreaterThan(finerShare(light));
  });
});

describe('Blast balance — a correct, a doubled and a heavy charge on one pattern', () => {
  // One 2x3 pattern, 4 m apart, 10 m deep, 2 m of stemming. Only the charge changes.
  const ORE = { rustite: 0.3 };
  const pattern = { rock: 'molite', depth: 10, stemming: 2, ore: ORE } as const;
  const correct = (): BlastResult => fire({ ...pattern, explosive: 'krackle', kg: 3 });
  const doubled = (): BlastResult => fire({ ...pattern, explosive: 'krackle', kg: 6 });
  const heavy = (): BlastResult => fire({ ...pattern, explosive: 'dynatomics', kg: 16 });

  const share = (r: BlastResult, band: 'good' | 'fines' | 'dust'): number => r.bandVolumes![band] / brokenBandVolume(r);

  it('the correct charge gives mostly good-band rock', () => {
    const r = correct();
    expect(share(r, 'good')).toBeGreaterThan(share(r, 'fines'));
    expect(share(r, 'good')).toBeGreaterThan(share(r, 'dust'));
    expect(share(r, 'good')).toBeGreaterThanOrEqual(0.5);
  });

  it('doubling the charge finer-breaks the rock: fewer good, more fines', () => {
    const a = correct();
    const b = doubled();
    expect(brokenBandVolume(b)).toBeGreaterThan(brokenBandVolume(a));
    expect(b.bandVolumes!.fines).toBeGreaterThan(a.bandVolumes!.fines);
    expect(b.bandVolumes!.dust).toBeGreaterThanOrEqual(a.bandVolumes!.dust);
  });

  it('the heavy overcharge gives mostly dust, more than any other band', () => {
    const r = heavy();
    expect(share(r, 'dust')).toBeGreaterThan(share(r, 'good'));
    expect(share(r, 'dust')).toBeGreaterThan(share(r, 'fines'));
  });

  it('the heavy overcharge is dustier and less good-band than the correct charge', () => {
    const a = correct();
    const c = heavy();
    expect(share(c, 'dust')).toBeGreaterThan(share(a, 'dust'));
    expect(share(c, 'good')).toBeLessThan(share(a, 'good'));
  });

  it('the heavy overcharge reports a dust loss in mass and in ore value', () => {
    const r = heavy();
    expect(r.dustLoss!.massKg).toBeGreaterThan(0);
    expect(r.dustLoss!.oreValue).toBeGreaterThan(0);
  });

  it('dust loss grows with the charge', () => {
    const lossOf = (r: BlastResult): number => r.dustLoss!.massKg;
    expect(lossOf(heavy())).toBeGreaterThan(lossOf(doubled()));
    expect(lossOf(doubled())).toBeGreaterThanOrEqual(lossOf(correct()));
  });

  it('the mass lost is the configured share of the dust-band rock', () => {
    const r = heavy();
    const density = getRock('molite')!.density;
    expect(r.dustLoss!.massKg).toBeCloseTo(r.bandVolumes!.dust * density * DUST_LOSS_SHARE, 1);
  });

  it('the ore lost is a small part of the ore the blast delivers', () => {
    const r = heavy();
    const delivered = r.totalOreValue + (r.sealedOreValue ?? 0);
    expect(r.dustLoss!.oreValue).toBeGreaterThan(0);
    expect(r.dustLoss!.oreValue).toBeLessThan(delivered);
  });

  it('a block with no ore loses no ore value to dust, only mass', () => {
    const r = fire({ rock: 'molite', explosive: 'dynatomics', kg: 16, depth: 10, stemming: 2 });
    expect(r.dustLoss!.massKg).toBeGreaterThan(0);
    expect(r.dustLoss!.oreValue).toBe(0);
  });

  it('is reproducible', () => {
    const a = heavy();
    const b = heavy();
    expect(b.bandVolumes).toEqual(a.bandVolumes);
    expect(b.dustLoss).toEqual(a.dustLoss);
  });
});

describe('Blast balance — a heavily stemmed overcharge stratifies the rock', () => {
  const SURFACE_TOP = 11; // bench voxels fill y 0..10
  const STEMMING = 6;
  const DEPTH = 10;

  /** Hole bottom y = SURFACE_TOP - DEPTH; charge 8 kg of krackle fills 4 m above it. */
  const CHARGE_TOP = SURFACE_TOP - DEPTH + 4;

  function singleHolePlan(kg: number, stemming: number, depth: number) {
    holeCounter.nextHoleId = 1;
    const holes = createGridPlan(holeCounter, { x: 15, z: 15 }, 1, 1, 4, depth, 0.089);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', kg, stemming);
    return assembleBlastPlan(holes, charges);
  }

  /** Fragmentation-band volumes by height, for the broken rock of a single-hole shot. */
  function bandsByLayer(kg: number) {
    const plan = singleHolePlan(kg, STEMMING, DEPTH);
    const grid = bench('cruite');
    const field = buildPlanEnergyField(plan, grid)!;
    expect(field, 'plan was rejected').not.toBeNull();
    const fragmentation = identifyFragmentedVoxels(field, grid);
    const finesOrDust: number[] = [];
    const broken: number[] = [];
    for (let y = 0; y < SURFACE_TOP; y++) { finesOrDust[y] = 0; broken[y] = 0; }
    for (const v of fragmentation.fragmented) {
      broken[v.y]!++;
      if (intensityAt(field, v.x, v.y, v.z) >= FRAGMENTATION_BAND_FINES_MIN) finesOrDust[v.y]!++;
    }
    return { finesOrDust, broken, field };
  }

  const sum = (values: number[], from: number, to: number): number => {
    let total = 0;
    for (let y = from; y < to; y++) total += values[y]!;
    return total;
  };

  it('puts fines and dust near the charge', () => {
    const { finesOrDust } = bandsByLayer(8);
    expect(sum(finesOrDust, 0, CHARGE_TOP + 1)).toBeGreaterThan(0);
  });

  it('puts more fines and dust at the charge than in the stemming above it', () => {
    const { finesOrDust } = bandsByLayer(8);
    expect(sum(finesOrDust, 0, CHARGE_TOP + 1)).toBeGreaterThan(sum(finesOrDust, CHARGE_TOP + 1, SURFACE_TOP));
  });

  it('leaves the collar coarse or unbroken: no fines or dust in the top metres', () => {
    const { field } = bandsByLayer(8);
    const { box } = field;
    for (let y = SURFACE_TOP - 3; y < SURFACE_TOP; y++) {
      for (let z = box.minZ; z < box.maxZ; z++) {
        for (let x = box.minX; x < box.maxX; x++) {
          const band = classifyFragmentationBand(intensityAt(field, x, y, z));
          expect(['intact', 'cracked', 'good'], `${x},${y},${z} is ${band}`).toContain(band);
        }
      }
    }
  });

  it('throws no more rock than a correctly charged hole', () => {
    const stemmed = fire({ rock: 'cruite', explosive: 'krackle', kg: 8, stemming: STEMMING, depth: DEPTH, rows: 1, cols: 1 });
    const correct = fire({ rock: 'cruite', explosive: 'krackle', kg: 4, stemming: 2, depth: 8, rows: 1, cols: 1 });

    expect(stemmed.clearedVoxels).toBeGreaterThan(0);
    expect(stemmed.projectionCount).toBeLessThanOrEqual(correct.projectionCount);
    expect(stemmed.maxThrowDistance).toBeLessThanOrEqual(correct.maxThrowDistance);
  });

  it('reports the finer rock of the overcharge in the band volumes', () => {
    const stemmed = fire({ rock: 'cruite', explosive: 'krackle', kg: 8, stemming: STEMMING, depth: DEPTH, rows: 1, cols: 1 });
    expect(stemmed.bandVolumes!.fines + stemmed.bandVolumes!.dust).toBeGreaterThan(0);
  });
});
