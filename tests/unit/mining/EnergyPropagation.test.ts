import { describe, it, expect } from 'vitest';
import {
  buildHoleSeeds,
  clampBoxToGrid,
  computeVoxelThreshold,
  createEnergyField,
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
import { MAX_PROPAGATION_ITERATIONS } from '../../../src/core/config/balance.js';

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
  const grid = new VoxelGrid(size, size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        grid.setVoxel(x, y, z, rockVoxel(rockId));
      }
    }
  }
  return grid;
}

function wholeGrid(grid: VoxelGrid): BlastBox {
  return {
    minX: grid.minX, minY: 0, minZ: grid.minZ,
    maxX: grid.maxX, maxY: grid.sizeY, maxZ: grid.maxZ,
  };
}

function fieldOver(grid: VoxelGrid) {
  return createEnergyField(grid, wholeGrid(grid));
}

const CRUITE = getRock('cruite')!.energyAbsorption;   // 200
const TITANITE = getRock('titanite')!.energyAbsorption; // 4000

/** Total energy retained across the whole field. */
function totalEffective(field: { effective: Float32Array }): number {
  let sum = 0;
  for (const v of field.effective) sum += v;
  return sum;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

describe('EnergyPropagation — computeVoxelThreshold', () => {
  it('a single-rock voxel absorbs that rock energyAbsorption', () => {
    const grid = solidGrid(3, 'cruite');
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBeCloseTo(CRUITE, 6);
  });

  it('a mixed voxel absorbs the coefficient-weighted blend', () => {
    const grid = new VoxelGrid(3, 3, 3);
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
    const grid = new VoxelGrid(3, 3, 3);
    expect(computeVoxelThreshold(grid, 1, 1, 1)).toBe(0);
  });
});

// ── Field construction ────────────────────────────────────────────────────────

describe('EnergyPropagation — createEnergyField', () => {
  it('marks rock as non-air and records its threshold', () => {
    const field = fieldOver(solidGrid(3));
    expect(isAirAt(field, 1, 1, 1)).toBe(false);
    expect(thresholdAt(field, 1, 1, 1)).toBeCloseTo(CRUITE, 6);
  });

  it('marks empty voxels as air with no threshold', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, rockVoxel('cruite'));
    const field = fieldOver(grid);
    expect(isAirAt(field, 0, 0, 0)).toBe(true);
    expect(thresholdAt(field, 0, 0, 0)).toBe(0);
  });

  it('treats coordinates outside the box as air', () => {
    const field = fieldOver(solidGrid(3));
    expect(isAirAt(field, 99, 99, 99)).toBe(true);
    expect(effectiveAt(field, 99, 99, 99)).toBe(0);
  });
});

describe('EnergyPropagation — clampBoxToGrid', () => {
  it('clips a box that overhangs the owned region', () => {
    const grid = solidGrid(4);
    const clamped = clampBoxToGrid({ minX: -10, minY: -10, minZ: -10, maxX: 100, maxY: 100, maxZ: 100 }, grid);
    expect(clamped).toEqual({
      minX: grid.minX, minY: 0, minZ: grid.minZ,
      maxX: grid.maxX, maxY: grid.sizeY, maxZ: grid.maxZ,
    });
  });

  it('returns null when the box misses the owned region entirely', () => {
    const grid = solidGrid(4);
    expect(clampBoxToGrid({ minX: 500, minY: 0, minZ: 500, maxX: 510, maxY: 4, maxZ: 510 }, grid)).toBeNull();
  });
});

// ── Propagation ───────────────────────────────────────────────────────────────

describe('EnergyPropagation — seedEnergy', () => {
  it('energy below a voxel capacity is fully absorbed and never overflows', () => {
    const field = fieldOver(solidGrid(5));
    seedEnergy(field, [{ x: 2, y: 2, z: 2, energy: CRUITE * 0.5 }]);

    expect(effectiveAt(field, 2, 2, 2)).toBeCloseTo(CRUITE * 0.5, 3);
    expect(overflowAt(field, 2, 2, 2)).toBe(0);
    // Nothing reached the neighbours.
    expect(effectiveAt(field, 3, 2, 2)).toBe(0);
  });

  it('energy beyond a voxel capacity saturates it and spreads outward', () => {
    const field = fieldOver(solidGrid(7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 20 }]);

    expect(effectiveAt(field, 3, 3, 3)).toBeCloseTo(CRUITE, 3);
    expect(overflowAt(field, 3, 3, 3)).toBeGreaterThan(0);
    expect(effectiveAt(field, 4, 3, 3)).toBeGreaterThan(0);
  });

  it('conserves energy — everything is either retained or accounted as dissipated', () => {
    const field = fieldOver(solidGrid(9));
    seedEnergy(field, [{ x: 4, y: 4, z: 4, energy: CRUITE * 200 }]);

    expect(totalEffective(field) + field.dissipated).toBeCloseTo(field.seeded, 0);
  });

  it('conserves energy when the charge sits against a free face', () => {
    const grid = solidGrid(7);
    // Carve an open pit above the charge.
    for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) grid.clearVoxel(x, 6, z);
    const field = fieldOver(grid);
    seedEnergy(field, [{ x: 3, y: 5, z: 3, energy: CRUITE * 150 }]);

    expect(totalEffective(field) + field.dissipated).toBeCloseTo(field.seeded, 0);
  });

  it('energy decays with distance from the charge', () => {
    const field = fieldOver(solidGrid(15));
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: CRUITE * 400 }]);

    const near = effectiveAt(field, 9, 7, 7);
    const far = effectiveAt(field, 13, 7, 7);
    expect(near).toBeGreaterThan(far);
  });

  it('spreads symmetrically along every axis in uniform rock', () => {
    const field = fieldOver(solidGrid(11));
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
    const grid = solidGrid(11);
    // A solid air wall at x = 6, separating the charge from everything beyond.
    for (let z = 0; z < 11; z++) for (let y = 0; y < 11; y++) grid.clearVoxel(6, y, z);
    const field = fieldOver(grid);
    seedEnergy(field, [{ x: 3, y: 5, z: 5, energy: CRUITE * 500 }]);

    expect(effectiveAt(field, 5, 5, 5)).toBeGreaterThan(0);
    expect(effectiveAt(field, 7, 5, 5)).toBe(0);
    expect(effectiveAt(field, 9, 5, 5)).toBe(0);
  });

  it('hard rock keeps the blast tighter than soft rock for the same charge', () => {
    const soft = fieldOver(solidGrid(15, 'cruite'));
    const hard = fieldOver(solidGrid(15, 'titanite'));
    const charge = TITANITE * 8;

    seedEnergy(soft, [{ x: 7, y: 7, z: 7, energy: charge }]);
    seedEnergy(hard, [{ x: 7, y: 7, z: 7, energy: charge }]);

    const reach = (f: ReturnType<typeof fieldOver>): number => {
      let furthest = 0;
      for (let d = 1; d < 8; d++) if (effectiveAt(f, 7 + d, 7, 7) > 0) furthest = d;
      return furthest;
    };

    expect(reach(soft)).toBeGreaterThan(reach(hard));
  });

  it('a charge in air has nothing to work on', () => {
    const grid = new VoxelGrid(5, 5, 5);
    const field = fieldOver(grid);
    seedEnergy(field, [{ x: 2, y: 2, z: 2, energy: 5000 }]);

    expect(totalEffective(field)).toBe(0);
    expect(field.dissipated).toBeCloseTo(5000, 6);
  });

  it('ignores non-finite, negative and out-of-box seeds', () => {
    const field = fieldOver(solidGrid(5));
    const seeds: EnergySeed[] = [
      { x: 2, y: 2, z: 2, energy: Number.NaN },
      { x: 2, y: 2, z: 2, energy: -500 },
      { x: 99, y: 99, z: 99, energy: 1000 },
    ];
    seedEnergy(field, seeds);

    expect(field.seeded).toBe(0);
    expect(totalEffective(field)).toBe(0);
  });

  it('terminates well within the iteration guard', () => {
    const field = fieldOver(solidGrid(15));
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: CRUITE * 1000 }]);

    expect(field.iterations).toBeGreaterThan(0);
    expect(field.iterations).toBeLessThan(MAX_PROPAGATION_ITERATIONS);
  });

  it('is deterministic — same input, same field', () => {
    const a = fieldOver(solidGrid(9));
    const b = fieldOver(solidGrid(9));
    const seeds = [{ x: 4, y: 4, z: 4, energy: CRUITE * 120 }];

    seedEnergy(a, seeds);
    seedEnergy(b, seeds);

    expect([...b.effective]).toEqual([...a.effective]);
    expect([...b.overflowOut]).toEqual([...a.overflowOut]);
  });

  it('two charges deposit more energy than one', () => {
    const one = fieldOver(solidGrid(11));
    const two = fieldOver(solidGrid(11));

    seedEnergy(one, [{ x: 4, y: 5, z: 5, energy: CRUITE * 60 }]);
    seedEnergy(two, [
      { x: 4, y: 5, z: 5, energy: CRUITE * 60 },
      { x: 6, y: 5, z: 5, energy: CRUITE * 60 },
    ]);

    expect(totalEffective(two)).toBeGreaterThan(totalEffective(one));
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
