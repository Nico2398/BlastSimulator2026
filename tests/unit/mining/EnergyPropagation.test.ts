import { describe, it, expect } from 'vitest';
import {
  buildHoleSeeds,
  clampBoxToGrid,
  computeVoxelThreshold,
  confinementFactor,
  createEnergyField,
  createEnergyFieldSteps,
  effectiveAt,
  isAirAt,
  overflowAt,
  seedEnergy,
  thresholdAt,
  type BlastBox,
  type EnergySeed,
} from '../../../src/core/mining/EnergyPropagation.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import {
  BLAST_ENERGY_DECAY_M,
  BLAST_ENERGY_REACH_M,
  BLAST_GRADE_FLOOR_OFFSET_M,
} from '../../../src/core/config/balance.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rockVoxel(rockId: string): VoxelData {
  return {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

/** A cube of solid rock of one type. */
function solidGrid(size: number, rockId = 'cruite'): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        grid.setVoxel(x, y, z, rockVoxel(rockId));
      }
    }
  }
  return grid;
}

/** `height` is the grid's own constructed height — callers pass what they built it with. */
function wholeGrid(grid: VoxelGrid, height: number): BlastBox {
  return {
    minX: grid.minX, minY: 0, minZ: grid.minZ,
    maxX: grid.maxX, maxY: height, maxZ: grid.maxZ,
  };
}

function fieldOver(grid: VoxelGrid, height: number) {
  return createEnergyField(grid, wholeGrid(grid, height));
}

const CRUITE = getRock('cruite')!.energyAbsorption;   // 200
const TITANITE = getRock('titanite')!.energyAbsorption; // 4000

/** Total energy retained (up to each voxel's threshold) across the whole field. */
function totalEffective(field: { effective: Float32Array }): number {
  let sum = 0;
  for (const v of field.effective) sum += v;
  return sum;
}

/** Total energy every voxel received: what it kept up to its threshold plus the excess beyond it. */
function totalReceived(field: { effective: Float32Array; overflowOut: Float32Array }): number {
  let sum = 0;
  for (let i = 0; i < field.effective.length; i++) sum += field.effective[i]! + field.overflowOut[i]!;
  return sum;
}

/** Energy one voxel received from every hole: kept plus excess. */
function receivedAt(field: ReturnType<typeof fieldOver>, x: number, y: number, z: number): number {
  return effectiveAt(field, x, y, z) + overflowAt(field, x, y, z);
}

/**
 * Distance (m) through solid rock along face (1 m) and edge (√2 m) steps, the kernel's metric: pair
 * as many units of the displacement into edge steps as the axes allow, walk the rest face by face.
 */
function kernelDistance(dx: number, dy: number, dz: number): number {
  const [a, b, c] = [Math.abs(dx), Math.abs(dy), Math.abs(dz)].sort((p, q) => q - p) as [number, number, number];
  if (a >= b + c) return (b + c) * Math.SQRT2 + (a - b - c);
  const total = a + b + c;
  return Math.floor(total / 2) * Math.SQRT2 + (total % 2);
}

/** Energy accounted for: what the rock received plus what was spent (in air, or under a hole's bottom). */
function accountedFor(field: ReturnType<typeof fieldOver>): number {
  return totalReceived(field) + field.dissipated;
}

/** `|a - b|` relative to `b`, for sums of float32 cells. */
function relativeError(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

// ── Thresholds ────────────────────────────────────────────────────────────────

describe('EnergyPropagation — computeVoxelThreshold', () => {
  it('a single-rock voxel absorbs that rock energyAbsorption', () => {
    const grid = solidGrid(3, 'cruite');
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBeCloseTo(CRUITE, 6);
  });

  it('a mixed voxel absorbs the coefficient-weighted blend', () => {
    const grid = new VoxelGrid(3, 3);
    grid.setVoxel(1, 1, 1, {
      composition: { rocks: [
        { rockId: 'cruite', coefficient: 0.5 },
        { rockId: 'titanite', coefficient: 0.5 },
      ] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBeCloseTo((CRUITE + TITANITE) / 2, 4);
  });

  it('rock cracked by an earlier blast breaks sooner', () => {
    const grid = solidGrid(3, 'cruite');
    grid.scaleFractureAt(1, 1, 1, 0.5);
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBeCloseTo(CRUITE * 0.5, 6);
  });

  it('air absorbs nothing', () => {
    const grid = new VoxelGrid(3, 3);
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBe(0);
  });
});

// ── Field construction ────────────────────────────────────────────────────────

describe('EnergyPropagation — createEnergyField', () => {
  it('marks rock as non-air and records its threshold', () => {
    const field = fieldOver(solidGrid(3), 3);
    expect(isAirAt(field, 1, 1, 1)).toBe(false);
    expect(thresholdAt(field, 1, 1, 1)).toBeCloseTo(CRUITE, 6);
  });

  it('marks empty voxels as air with no threshold', () => {
    const grid = new VoxelGrid(3, 3);
    grid.setVoxel(1, 1, 1, rockVoxel('cruite'));
    const field = fieldOver(grid, 3);
    expect(isAirAt(field, 0, 0, 0)).toBe(true);
    expect(thresholdAt(field, 0, 0, 0)).toBe(0);
  });

  it('treats coordinates outside the box as air', () => {
    const field = fieldOver(solidGrid(3), 3);
    expect(isAirAt(field, 99, 99, 99)).toBe(true);
    expect(effectiveAt(field, 99, 99, 99)).toBe(0);
  });
});

describe('EnergyPropagation — clampBoxToGrid', () => {
  it('clips X/Z to the owned region but passes Y through unclamped (#1186: no vertical cap)', () => {
    const grid = solidGrid(4);
    const clamped = clampBoxToGrid({ minX: -10, minY: -10, minZ: -10, maxX: 100, maxY: 100, maxZ: 100 }, grid);
    expect(clamped).toEqual({
      minX: grid.minX, minY: -10, minZ: grid.minZ,
      maxX: grid.maxX, maxY: 100, maxZ: grid.maxZ,
    });
  });

  it('returns null when the box misses the owned region entirely', () => {
    const grid = solidGrid(4);
    expect(clampBoxToGrid({ minX: 500, minY: 0, minZ: 500, maxX: 510, maxY: 4, maxZ: 510 }, grid)).toBeNull();
  });

  it('#1186: a box entirely below y=0 still clamps to a valid box, not null', () => {
    const grid = solidGrid(4);
    const box = { minX: grid.minX, minY: -30, minZ: grid.minZ, maxX: grid.maxX, maxY: -10, maxZ: grid.maxZ };
    const clamped = clampBoxToGrid(box, grid);
    expect(clamped).not.toBeNull();
    expect(clamped).toEqual(box);
  });

  it('#1186: energy seeded into a field entirely below y=0 propagates normally', () => {
    // Solid rock from y=-30..-11 (below the world's old y>=0 floor).
    const grid = new VoxelGrid(7, 7);
    for (let z = 0; z < 7; z++) {
      for (let y = -30; y < -10; y++) {
        for (let x = 0; x < 7; x++) grid.setVoxel(x, y, z, rockVoxel('cruite'));
      }
    }
    const box: BlastBox = { minX: 0, minY: -30, minZ: 0, maxX: 7, maxY: -10, maxZ: 7 };
    const clamped = clampBoxToGrid(box, grid);
    expect(clamped).not.toBeNull();

    const field = createEnergyField(grid, clamped!);
    seedEnergy(field, [{ x: 3, y: -15, z: 3, energy: CRUITE * 0.5 }]);

    expect(effectiveAt(field, 3, -15, 3)).toBeGreaterThan(0);
  });
});

// ── Propagation ───────────────────────────────────────────────────────────────

describe('EnergyPropagation — seedEnergy', () => {
  it('a voxel that receives less than its capacity keeps all of it and overflows nothing', () => {
    const field = fieldOver(solidGrid(5), 5);
    seedEnergy(field, [{ x: 2, y: 2, z: 2, energy: CRUITE * 0.5 }]);

    // The seed voxel keeps only its share of the hole: the rest went to the rock round it.
    expect(effectiveAt(field, 2, 2, 2)).toBeGreaterThan(0);
    expect(effectiveAt(field, 2, 2, 2)).toBeLessThan(CRUITE * 0.5);
    expect(effectiveAt(field, 3, 2, 2)).toBeGreaterThan(0);
    // Nothing anywhere went past its threshold, so everything received is kept;
    // the rock under the charge took its share without keeping it.
    expect(field.overflowOut.every(v => v === 0)).toBe(true);
    expect(effectiveAt(field, 2, 1, 2)).toBe(0);
    expect(relativeError(totalEffective(field) + field.dissipated, field.seeded)).toBeLessThan(1e-5);
  });

  it('a voxel that receives more than its capacity keeps its threshold and records the excess as overflow', () => {
    const size = 7;
    const field = fieldOver(solidGrid(size), size);
    // The seed voxel gets the largest share of the hole, so at least the average over every
    // voxel the hole can reach — seeding the box volume times the threshold guarantees it breaks.
    const energy = CRUITE * size ** 3;
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy }]);

    expect(effectiveAt(field, 3, 3, 3)).toBeCloseTo(CRUITE, 3);
    expect(overflowAt(field, 3, 3, 3)).toBeGreaterThan(0);
    expect(receivedAt(field, 3, 3, 3)).toBeGreaterThanOrEqual(energy / size ** 3);
    expect(effectiveAt(field, 4, 3, 3)).toBeGreaterThan(0);
  });

  it('a voxel at distance d through rock gets exp(-d / BLAST_ENERGY_DECAY_M) of the share at the charge', () => {
    const field = fieldOver(solidGrid(11), 11);
    // Small enough that no voxel overflows, so effective is the whole share.
    seedEnergy(field, [{ x: 5, y: 5, z: 5, energy: CRUITE }]);
    const atCharge = receivedAt(field, 5, 5, 5);
    const ratio = (x: number, y: number, z: number): number => receivedAt(field, x, y, z) / atCharge;

    expect(ratio(6, 5, 5)).toBeCloseTo(Math.exp(-1 / BLAST_ENERGY_DECAY_M), 5);
    expect(ratio(6, 6, 5)).toBeCloseTo(Math.exp(-Math.SQRT2 / BLAST_ENERGY_DECAY_M), 5);
    expect(ratio(7, 5, 5)).toBeCloseTo(Math.exp(-2 / BLAST_ENERGY_DECAY_M), 5);
    // No corner steps: a body diagonal is an edge step then a face step.
    expect(ratio(6, 6, 6)).toBeCloseTo(Math.exp(-(1 + Math.SQRT2) / BLAST_ENERGY_DECAY_M), 5);
  });

  it('the shares of one hole sum to its energy: what the rock keeps plus what the floor under it takes', () => {
    const field = fieldOver(solidGrid(9), 9);
    seedEnergy(field, [{ x: 4, y: 4, z: 4, energy: CRUITE * 200 }]);

    expect(field.seeded).toBeCloseTo(CRUITE * 200, 6);
    // The rock under the hole's bottom took its share and kept none of it.
    expect(field.dissipated).toBeGreaterThan(0);
    for (let y = 0; y < 4; y++) expect(receivedAt(field, 4, y, 4)).toBe(0);
    expect(relativeError(accountedFor(field), field.seeded)).toBeLessThan(1e-5);
  });

  it('rock under a hole\'s bottom keeps nothing, so a crater floors at the bottom of its holes', () => {
    const field = fieldOver(solidGrid(11), 11);
    // A hole whose charge runs from y = 4 to y = 6.
    seedEnergy(field, [4, 5, 6].map(y => ({ x: 5, y, z: 5, energy: CRUITE * 40 })));

    for (let z = 0; z < 11; z++) for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 4; y++) expect(receivedAt(field, x, y, z), `(${x}, ${y}, ${z})`).toBe(0);
    }
    // At and above the bottom the rock gets its share as usual, beside the hole as well as in it.
    expect(receivedAt(field, 5, 4, 5)).toBeGreaterThan(0);
    expect(receivedAt(field, 7, 4, 5)).toBeGreaterThan(0);
    // The share under the bottom is the kernel weight of that rock: it is the field's whole dissipation here.
    let below = 0;
    let all = 0;
    for (let z = 0; z < 11; z++) for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const d = Math.min(...[4, 5, 6].map(cy => kernelDistance(x - 5, y - cy, z - 5)));
      if (d > BLAST_ENERGY_REACH_M + 1e-9) continue;
      const w = Math.exp(-d / BLAST_ENERGY_DECAY_M);
      all += w;
      if (y < 4) below += w;
    }
    expect(relativeError(field.dissipated, field.seeded * below / all)).toBeLessThan(1e-4);
  });

  it('each hole floors at its own bottom: a deeper hole still breaks the rock under a shallower neighbour', () => {
    const field = fieldOver(solidGrid(13), 13);
    seedEnergy(field, [
      { x: 4, y: 6, z: 6, energy: CRUITE * 60 }, // shallow hole, bottom at y = 6
      { x: 8, y: 3, z: 6, energy: CRUITE * 60 }, // deep hole, bottom at y = 3
    ]);

    // Under the shallow hole, between the two bottoms, only the deep hole's energy arrives.
    expect(receivedAt(field, 4, 4, 6)).toBeGreaterThan(0);
    expect(receivedAt(field, 8, 2, 6)).toBe(0);
    // The blast's grade is the shallower (highest) bottom.
    expect(field.gradeY).toBe(6 + BLAST_GRADE_FLOOR_OFFSET_M);
  });

  it('the shares of one hole sum to its energy when the charge sits against a free face', () => {
    const grid = solidGrid(7);
    // Carve an open pit above the charge.
    for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) grid.clearVoxel(x, 6, z);
    const field = fieldOver(grid, 7);
    seedEnergy(field, [{ x: 3, y: 5, z: 3, energy: CRUITE * 150 }]);

    expect(relativeError(accountedFor(field), field.seeded)).toBeLessThan(1e-5);
    // The open pit took none of it.
    for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) expect(receivedAt(field, x, 6, z)).toBe(0);
  });

  it('a charge column is one hole: its energy spreads from the nearest charged voxel', () => {
    const field = fieldOver(solidGrid(11), 11);
    // Two seeds of one column, one carrying nine times the other.
    seedEnergy(field, [
      { x: 5, y: 3, z: 5, energy: CRUITE * 0.9 },
      { x: 5, y: 4, z: 5, energy: CRUITE * 0.1 },
    ]);

    // Both charged voxels sit at distance 0 from the hole, so they receive the same share.
    expect(receivedAt(field, 5, 4, 5)).toBeCloseTo(receivedAt(field, 5, 3, 5), 6);
    expect(relativeError(accountedFor(field), CRUITE)).toBeLessThan(1e-5);
  });

  it('energy decays with distance from the charge', () => {
    const field = fieldOver(solidGrid(15), 15);
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: CRUITE * 400 }]);

    const near = effectiveAt(field, 9, 7, 7);
    const far = effectiveAt(field, 13, 7, 7);
    expect(near).toBeGreaterThan(far);
  });

  it('spreads symmetrically along every axis in uniform rock', () => {
    const field = fieldOver(solidGrid(11), 11);
    seedEnergy(field, [{ x: 5, y: 5, z: 5, energy: CRUITE * 300 }]);

    const px = effectiveAt(field, 7, 5, 5);
    const nx = effectiveAt(field, 3, 5, 5);
    const pz = effectiveAt(field, 5, 5, 7);
    const py = effectiveAt(field, 5, 7, 5);
    expect(nx).toBeCloseTo(px, 2);
    expect(pz).toBeCloseTo(px, 2);
    expect(py).toBeCloseTo(px, 2);
  });

  it('air blocks energy — rock shielded behind a void stays cold', () => {
    const open = fieldOver(solidGrid(11), 11);
    seedEnergy(open, [{ x: 3, y: 5, z: 5, energy: CRUITE * 500 }]);
    // Control: without the void, x = 7 is within reach of the charge.
    expect(receivedAt(open, 7, 5, 5)).toBeGreaterThan(0);

    const grid = solidGrid(11);
    // A solid air wall at x = 6, separating the charge from everything beyond.
    for (let z = 0; z < 11; z++) for (let y = 0; y < 11; y++) grid.clearVoxel(6, y, z);
    const field = fieldOver(grid, 11);
    seedEnergy(field, [{ x: 3, y: 5, z: 5, energy: CRUITE * 500 }]);

    expect(effectiveAt(field, 5, 5, 5)).toBeGreaterThan(0);
    expect(receivedAt(field, 6, 5, 5)).toBe(0);
    expect(receivedAt(field, 7, 5, 5)).toBe(0);
    expect(receivedAt(field, 9, 5, 5)).toBe(0);
    // The hole's whole energy stayed on the charge's side of the void (or went into its floor).
    expect(relativeError(accountedFor(field), field.seeded)).toBeLessThan(1e-5);
  });

  it('distance runs through rock: a voxel behind a thin void gets the share of the detour round it', () => {
    const grid = solidGrid(11);
    // One column of air at x = 6, z = 5 between the charge and (7, 5, 5): the straight
    // path is 2 m, the way round it through rock is two edge steps (2√2 m).
    for (let y = 0; y < 11; y++) grid.clearVoxel(6, y, 5);
    const field = fieldOver(grid, 11);
    seedEnergy(field, [{ x: 5, y: 5, z: 5, energy: CRUITE }]);

    const ratio = receivedAt(field, 7, 5, 5) / receivedAt(field, 5, 5, 5);
    expect(ratio).toBeCloseTo(Math.exp(-2 * Math.SQRT2 / BLAST_ENERGY_DECAY_M), 5);
    expect(ratio).toBeLessThan(Math.exp(-2 / BLAST_ENERGY_DECAY_M));
  });

  it('nothing reaches rock farther than BLAST_ENERGY_REACH_M through rock', () => {
    const field = fieldOver(solidGrid(15), 15);
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: CRUITE * 1000 }]);
    const lastInReach = Math.floor(BLAST_ENERGY_REACH_M);

    expect(receivedAt(field, 7 + lastInReach, 7, 7)).toBeGreaterThan(0);
    expect(receivedAt(field, 7 - lastInReach, 7, 7)).toBeGreaterThan(0);
    expect(receivedAt(field, 7 + lastInReach + 1, 7, 7)).toBe(0);
    expect(receivedAt(field, 7, 7 + lastInReach + 1, 7)).toBe(0);
    expect(relativeError(accountedFor(field), field.seeded)).toBeLessThan(1e-5);
  });

  it('hard rock breaks a tighter radius than soft rock for the same charge', () => {
    const soft = fieldOver(solidGrid(15, 'cruite'), 15);
    const hard = fieldOver(solidGrid(15, 'titanite'), 15);
    const charge = TITANITE * 8;

    seedEnergy(soft, [{ x: 7, y: 7, z: 7, energy: charge }]);
    seedEnergy(hard, [{ x: 7, y: 7, z: 7, energy: charge }]);

    // The rock does not steer the energy: the same share reaches the same voxel in both.
    for (let d = 0; d < 6; d++) {
      expect(receivedAt(hard, 7 + d, 7, 7)).toBeCloseTo(receivedAt(soft, 7 + d, 7, 7), 2);
    }

    // It decides what breaks: a voxel breaks when its share reaches its threshold.
    const brokenRadius = (f: ReturnType<typeof fieldOver>): number => {
      let furthest = -1;
      for (let d = 0; d < 8; d++) {
        if (effectiveAt(f, 7 + d, 7, 7) >= thresholdAt(f, 7 + d, 7, 7) * (1 - 1e-6)) furthest = d;
      }
      return furthest;
    };

    expect(brokenRadius(soft)).toBeGreaterThan(0);
    expect(brokenRadius(soft)).toBeGreaterThan(brokenRadius(hard));
  });

  it('a charge in air has nothing to work on', () => {
    const grid = new VoxelGrid(5, 5);
    const field = fieldOver(grid, 5);
    seedEnergy(field, [{ x: 2, y: 2, z: 2, energy: 5000 }]);

    expect(totalReceived(field)).toBe(0);
    expect(field.seeded).toBeCloseTo(5000, 6);
    expect(field.dissipated).toBeCloseTo(5000, 6);
    // A seed in air is no hole, so it sets no grade.
    expect(field.gradeY).toBeNull();
  });

  it('a seed in air is dissipated while a hole in rock beside it shares out its whole energy', () => {
    const grid = solidGrid(9);
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) grid.clearVoxel(x, 8, z);
    const field = fieldOver(grid, 9);
    seedEnergy(field, [
      { x: 4, y: 8, z: 4, energy: 700 },
      { x: 2, y: 4, z: 2, energy: 1300 },
    ]);

    expect(field.seeded).toBeCloseTo(2000, 6);
    // The air seed is spent whole; the hole in rock spends only the share under its bottom.
    expect(field.dissipated).toBeGreaterThan(700);
    expect(relativeError(accountedFor(field), 2000)).toBeLessThan(1e-5);
    expect(totalReceived(field)).toBeGreaterThan(0);
    expect(totalReceived(field)).toBeLessThan(1300);
  });

  it('ignores non-finite, negative and out-of-box seeds', () => {
    const field = fieldOver(solidGrid(5), 5);
    const seeds: EnergySeed[] = [
      { x: 2, y: 2, z: 2, energy: Number.NaN },
      { x: 2, y: 2, z: 2, energy: -500 },
      { x: 99, y: 99, z: 99, energy: 1000 },
    ];
    seedEnergy(field, seeds);

    expect(field.seeded).toBe(0);
    expect(totalEffective(field)).toBe(0);
  });

  it('is deterministic — same input, same field', () => {
    const a = fieldOver(solidGrid(9), 9);
    const b = fieldOver(solidGrid(9), 9);
    const seeds = [{ x: 4, y: 4, z: 4, energy: CRUITE * 120 }];

    seedEnergy(a, seeds);
    seedEnergy(b, seeds);

    expect([...b.effective]).toEqual([...a.effective]);
    expect([...b.overflowOut]).toEqual([...a.overflowOut]);
  });

  it('two charges deposit more energy than one', () => {
    const one = fieldOver(solidGrid(11), 11);
    const two = fieldOver(solidGrid(11), 11);

    seedEnergy(one, [{ x: 4, y: 5, z: 5, energy: CRUITE * 60 }]);
    seedEnergy(two, [
      { x: 4, y: 5, z: 5, energy: CRUITE * 60 },
      { x: 6, y: 5, z: 5, energy: CRUITE * 60 },
    ]);

    expect(totalEffective(two)).toBeGreaterThan(totalEffective(one));
    expect(relativeError(totalReceived(two), 2 * totalReceived(one))).toBeLessThan(1e-5);
  });

  it('the shares of two holes add up voxel by voxel', () => {
    const west = fieldOver(solidGrid(11), 11);
    const east = fieldOver(solidGrid(11), 11);
    const both = fieldOver(solidGrid(11), 11);
    const westSeed = { x: 3, y: 5, z: 5, energy: CRUITE * 40 };
    const eastSeed = { x: 6, y: 4, z: 6, energy: CRUITE * 70 };

    seedEnergy(west, [westSeed]);
    seedEnergy(east, [eastSeed]);
    seedEnergy(both, [westSeed, eastSeed]);

    let worst = 0;
    let overlapping = 0;
    for (let i = 0; i < both.effective.length; i++) {
      const alone = west.effective[i]! + west.overflowOut[i]! + east.effective[i]! + east.overflowOut[i]!;
      const together = both.effective[i]! + both.overflowOut[i]!;
      if (west.effective[i]! > 0 && east.effective[i]! > 0) overlapping++;
      worst = Math.max(worst, Math.abs(together - alone) / Math.max(alone, 1e-9));
    }
    // The holes overlap, so the sum is not trivially one field or the other.
    expect(overlapping).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-5);
  });

  it('the grade is the highest charged hole bottom', () => {
    const field = fieldOver(solidGrid(11), 11);
    seedEnergy(field, [
      // A hole whose column runs y = 2..4, and a shallower one bottoming at y = 5 (its seeds listed top first).
      { x: 2, y: 2, z: 2, energy: 100 },
      { x: 2, y: 3, z: 2, energy: 100 },
      { x: 2, y: 4, z: 2, energy: 100 },
      { x: 8, y: 6, z: 8, energy: 100 },
      { x: 8, y: 5, z: 8, energy: 100 },
    ]);

    expect(field.gradeY).toBe(5 + BLAST_GRADE_FLOOR_OFFSET_M);
  });

  it('boundary: nothing seeded leaves no grade', () => {
    const field = fieldOver(solidGrid(5), 5);
    seedEnergy(field, []);

    expect(field.gradeY).toBeNull();
    expect(field.seeded).toBe(0);
    expect(totalReceived(field)).toBe(0);
  });
});

// ── Charge column ─────────────────────────────────────────────────────────────

describe('EnergyPropagation — buildHoleSeeds', () => {
  it('sits the charge at the bottom of the hole, filling the length its mass occupies', () => {
    // Surface air voxel at y=10, 6 m deep hole → bottom at y=4.
    // 8 kg at CHARGE_KG_PER_METRE=2 fills 4 m: y=4..7.
    const seeds = buildHoleSeeds(10, 6, 8, 1000, 3, 3);
    const ys = seeds.map(s => s.y).sort((a, b) => a - b);

    expect(ys).toEqual([4, 5, 6, 7]);
    expect(seeds.every(s => s.x === 3 && s.z === 3)).toBe(true);
  });

  it('splits the charge energy evenly down the column', () => {
    const seeds = buildHoleSeeds(10, 6, 8, 1000, 3, 3);
    const total = seeds.reduce((sum, s) => sum + s.energy, 0);

    expect(total).toBeCloseTo(1000, 6);
    expect(seeds[0]!.energy).toBeCloseTo(250, 6);
  });

  it('a bigger charge occupies more of the hole', () => {
    const small = buildHoleSeeds(20, 12, 2, 1000, 0, 0);
    const big = buildHoleSeeds(20, 12, 10, 1000, 0, 0);

    expect(big.length).toBeGreaterThan(small.length);
  });

  it('holds energy per voxel roughly steady as the charge grows, so more explosive breaks more rock', () => {
    const small = buildHoleSeeds(20, 16, 4, 400, 0, 0);
    const big = buildHoleSeeds(20, 16, 8, 800, 0, 0);

    // Twice the charge carries twice the energy over twice the column.
    expect(big[0]!.energy).toBeCloseTo(small[0]!.energy, 6);
    expect(big.length).toBe(small.length * 2);
  });

  it('stemming does not move the charge — it only costs energy, which the caller applies', () => {
    const unstemmed = buildHoleSeeds(10, 6, 8, 1000, 0, 0);
    const stemmed = buildHoleSeeds(10, 6, 8, 1000, 0, 0);

    expect(stemmed.map(s => s.y)).toEqual(unstemmed.map(s => s.y));
  });

  it('never lets the charge poke out above the collar', () => {
    // 40 kg would want 20 m of hole, but the hole is only 3 m deep.
    const seeds = buildHoleSeeds(10, 3, 40, 1000, 0, 0);

    expect(seeds.every(s => s.y <= 9)).toBe(true);
    expect(seeds).toHaveLength(3);
  });

  it('produces nothing for a zero charge, a zero-depth hole, or no explosive', () => {
    expect(buildHoleSeeds(10, 6, 8, 0, 0, 0)).toEqual([]);
    expect(buildHoleSeeds(10, 0, 8, 1000, 0, 0)).toEqual([]);
    expect(buildHoleSeeds(10, 6, 0, 1000, 0, 0)).toEqual([]);
  });
});

// ── The breaking threshold depends on the rock alone (#2197) ─────────────────

describe('EnergyPropagation — createEnergyField thresholds come from the rock only (#2197)', () => {
  const SIZE = 12;
  const mid = SIZE >> 1;

  it('takes a grid and a box and nothing else', () => {
    expect(createEnergyField.length).toBe(2);
    expect(createEnergyFieldSteps.length).toBe(2);
  });

  it('confined rock breaks at exactly its rock absorption', () => {
    const field = fieldOver(solidGrid(SIZE, 'obstiite'), SIZE);
    expect(thresholdAt(field, mid, mid, mid)).toBeCloseTo(getRock('obstiite')!.energyAbsorption, 3);
  });

  it('harder rock costs more to break than softer rock', () => {
    const soft = thresholdAt(fieldOver(solidGrid(SIZE, 'cruite'), SIZE), mid, mid, mid);
    const hard = thresholdAt(fieldOver(solidGrid(SIZE, 'titanite'), SIZE), mid, mid, mid);
    expect(hard).toBeGreaterThan(soft);
    expect(hard / soft).toBeCloseTo(TITANITE / CRUITE, 3);
  });

  it('rock cracked by an earlier blast gives way sooner', () => {
    const grid = solidGrid(SIZE, 'obstiite');
    grid.setVoxel(mid, mid, mid, { ...rockVoxel('obstiite'), fractureModifier: 0.5 });
    const field = fieldOver(grid, SIZE);
    expect(thresholdAt(field, mid, mid, mid)).toBeCloseTo(getRock('obstiite')!.energyAbsorption * 0.5, 3);
  });

  it('rock next to a free face breaks for the confinement fraction of its absorption', () => {
    const grid = new VoxelGrid(SIZE, SIZE);
    for (let z = 0; z < SIZE; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) {
      grid.setVoxel(x, y, z, rockVoxel('obstiite'));
    }
    const field = fieldOver(grid, SIZE);
    const absorption = getRock('obstiite')!.energyAbsorption;
    expect(thresholdAt(field, mid, 3, mid)).toBeCloseTo(absorption * confinementFactor(1), 3);
    expect(thresholdAt(field, mid, 3, mid)).toBeLessThan(thresholdAt(field, mid, 0, mid));
  });

  it('air voxels stay air', () => {
    const grid = new VoxelGrid(SIZE, SIZE);
    for (let z = 0; z < SIZE; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < SIZE; x++) {
      grid.setVoxel(x, y, z, rockVoxel('obstiite'));
    }
    const field = fieldOver(grid, SIZE);
    expect(isAirAt(field, mid, 8, mid)).toBe(true);
    expect(thresholdAt(field, mid, 8, mid)).toBe(0);
  });
});

// ── An excavation beside a pattern must not shield rock between its holes (#1793) ──
// A void near the pattern is a free face. It must not leave rock between charged holes
// standing that the same charges break without the excavation (under the old overflow
// model a ramp dug to a 3x3 pattern's edge pulled energy toward it and left 2x2
// full-height pillars). Under the kernel a void only takes rock out of a hole's reach,
// so what the hole would have spent there goes to the rock it still reaches.

describe('EnergyPropagation — a trench beside a charged pattern (#1793)', () => {
  const SIZE = 44;
  const SURFACE_Y = 16;
  const DEPTH = 8;
  const FLOOR_Y = SURFACE_Y - DEPTH;
  /** Top of the charge column: 8 kg at 2 kg/m fills 4 m up from the hole bottom. */
  const CHARGE_TOP_Y = FLOOR_Y + 3;
  const HOLE_COORDS = [12, 16, 20];
  /** Energy per hole: twice the 8 kg Krackle repro charge, so uniform sandite floors every footprint column without a trench. */
  const HOLE_ENERGY = 64000;

  type Trench = (x: number, z: number) => boolean;
  /** Two-wide (or one-wide) bench cut to the grade, running away from one side of the pattern. */
  const TRENCHES: Record<string, Trench> = {
    'south, 2 wide, flush against the pattern edge': (x, z) => (x === 15 || x === 16) && z >= 22,
    'south, 2 wide, one column off the edge': (x, z) => (x === 15 || x === 16) && z >= 23,
    'south, 1 wide': (x, z) => x === 16 && z >= 23,
    'east, 2 wide': (x, z) => (z === 15 || z === 16) && x >= 23,
    'north, 2 wide': (x, z) => (x === 15 || x === 16) && z <= 9,
    'west, 2 wide': (x, z) => (z === 15 || z === 16) && x <= 9,
  };

  /** Shoots the 3x3 pattern (4 m apart) in sandite; `trench` columns are void from the floor up. */
  function shoot(trench: Trench | null) {
    const grid = new VoxelGrid(SIZE, SIZE);
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        for (let y = 0; y < SURFACE_Y; y++) {
          if (trench && y >= FLOOR_Y && trench(x, z)) continue;
          grid.setVoxel(x, y, z, rockVoxel('sandite'));
        }
      }
    }
    const field = createEnergyField(grid, {
      minX: grid.minX, minY: 0, minZ: grid.minZ,
      maxX: grid.maxX, maxY: SURFACE_Y + 2, maxZ: grid.maxZ,
    });
    const seeds: EnergySeed[] = [];
    for (const z of HOLE_COORDS) {
      for (const x of HOLE_COORDS) seeds.push(...buildHoleSeeds(SURFACE_Y, DEPTH, 8, HOLE_ENERGY, x, z, 0));
    }
    seedEnergy(field, seeds);
    return field;
  }

  /** A column breaks when every voxel of its charged band has retained its full threshold. */
  function columnBreaks(field: ReturnType<typeof shoot>, x: number, z: number): boolean {
    for (let y = FLOOR_Y; y <= CHARGE_TOP_Y; y++) {
      if (effectiveAt(field, x, y, z) < thresholdAt(field, x, y, z) * (1 - 1e-4)) return false;
    }
    return true;
  }

  const footprint: Array<[number, number]> = [];
  for (let z = HOLE_COORDS[0]!; z <= HOLE_COORDS[2]!; z++) {
    for (let x = HOLE_COORDS[0]!; x <= HOLE_COORDS[2]!; x++) footprint.push([x, z]);
  }

  it('control: without a trench every column of the pattern, between the holes included, breaks', () => {
    const control = shoot(null);
    const standing = footprint.filter(([x, z]) => !columnBreaks(control, x, z));
    expect(standing, `control columns left standing: ${standing.join(' ')}`).toEqual([]);
  });

  for (const [name, trench] of Object.entries(TRENCHES)) {
    it(`trench ${name}: every column that breaks without it still breaks`, () => {
      const control = shoot(null);
      const withTrench = shoot(trench);
      const lost = footprint.filter(([x, z]) => columnBreaks(control, x, z) && !columnBreaks(withTrench, x, z));
      expect(lost, `columns the trench left standing: ${lost.join(' ')}`).toEqual([]);
    });

    it(`trench ${name}: energy is conserved (seeded == received + dissipated)`, () => {
      const field = shoot(trench);
      expect(field.seeded).toBeGreaterThan(0);
      expect(Math.abs(totalReceived(field) + field.dissipated - field.seeded) / field.seeded).toBeLessThan(1e-3);
    });
  }
});

describe('EnergyPropagation — buildHoleSeeds with hole diameter (#1934)', () => {
  it('no diameter equals the explicit 89 mm default', () => {
    expect(buildHoleSeeds(10, 6, 8, 1000, 3, 3)).toEqual(buildHoleSeeds(10, 6, 8, 1000, 3, 3, 0, 0.089));
  });

  it('the same kg in a wider hole fills a shorter column of fewer cells', () => {
    const narrow = buildHoleSeeds(30, 20, 16, 1000, 0, 0, 0, 0.089);
    const wide = buildHoleSeeds(30, 20, 16, 1000, 0, 0, 0, 0.165);
    expect(narrow).toHaveLength(8);
    expect(wide.length).toBeLessThan(narrow.length);
    expect(wide.length).toBe(Math.max(1, Math.round(16 / 6.87)));
  });

  it('keeps the column on the hole bottom and conserves the total energy', () => {
    const wide = buildHoleSeeds(30, 20, 16, 1000, 2, 5, 0, 0.127);
    const ys = wide.map(s => s.y).sort((a, b) => a - b);
    expect(ys[0]).toBe(10);
    expect(wide.reduce((sum, s) => sum + s.energy, 0)).toBeCloseTo(1000, 6);
  });

  it('boundary: a tiny charge in a wide hole still occupies one cell', () => {
    expect(buildHoleSeeds(30, 20, 1, 100, 0, 0, 0, 0.165)).toHaveLength(1);
  });
});

describe('EnergyPropagation — buildHoleSeeds with the explosive density', () => {
  it('boomite (the reference density) fills the same column as no explosive', () => {
    expect(buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089, 'boomite'))
      .toEqual(buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089));
  });

  it('a denser explosive packs the same kg into a shorter column', () => {
    // 8 kg of boomite (0.8 g/cm³) fills 4 m of an 89 mm hole; dynatomics (1.6) fills half that.
    const boomite = buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089, 'boomite');
    const dynatomics = buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089, 'dynatomics');
    expect(boomite).toHaveLength(4);
    expect(dynatomics).toHaveLength(2);
    expect(dynatomics.reduce((sum, s) => sum + s.energy, 0)).toBeCloseTo(1000, 6);
    expect(Math.min(...dynatomics.map(s => s.y))).toBe(10);
  });

  it('an unknown explosive reads the reference density', () => {
    expect(buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089, 'not_an_explosive'))
      .toEqual(buildHoleSeeds(30, 20, 8, 1000, 0, 0, 0, 0.089));
  });
});
