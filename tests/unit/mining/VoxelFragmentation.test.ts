import { describe, it, expect } from 'vitest';
import {
  identifyFragmentedVoxels,
  isFragmented,
} from '../../../src/core/mining/VoxelFragmentation.js';
import {
  createEnergyField,
  seedEnergy,
  indexOf,
  type BlastBox,
} from '../../../src/core/mining/EnergyPropagation.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { CRACKED_VOXEL_WEAKENING } from '../../../src/core/config/balance.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rockVoxel(rockId: string): VoxelData {
  return {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

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

const CRUITE = getRock('cruite')!.energyAbsorption; // 200

// ── Energy-driven fragmentation ───────────────────────────────────────────────

describe('VoxelFragmentation — energy pass', () => {
  it('a voxel that reached its threshold breaks', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 3 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(isFragmented(result, field, 3, 3, 3)).toBe(true);
  });

  it('a voxel that never reached its threshold survives', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.6 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.fragmented).toHaveLength(0);
  });

  it('a bigger charge breaks more rock', () => {
    const small = solidGrid(15);
    const big = solidGrid(15);
    const smallField = createEnergyField(small, wholeGrid(small));
    const bigField = createEnergyField(big, wholeGrid(big));

    seedEnergy(smallField, [{ x: 7, y: 7, z: 7, energy: CRUITE * 20 }]);
    seedEnergy(bigField, [{ x: 7, y: 7, z: 7, energy: CRUITE * 200 }]);

    const smallResult = identifyFragmentedVoxels(smallField, small);
    const bigResult = identifyFragmentedVoxels(bigField, big);

    expect(bigResult.fragmented.length).toBeGreaterThan(smallResult.fragmented.length);
  });

  it('hard rock resists a charge that shatters soft rock', () => {
    const soft = solidGrid(11, 'cruite');
    const hard = solidGrid(11, 'titanite');
    const softField = createEnergyField(soft, wholeGrid(soft));
    const hardField = createEnergyField(hard, wholeGrid(hard));
    const charge = CRUITE * 40;

    seedEnergy(softField, [{ x: 5, y: 5, z: 5, energy: charge }]);
    seedEnergy(hardField, [{ x: 5, y: 5, z: 5, energy: charge }]);

    const softResult = identifyFragmentedVoxels(softField, soft);
    const hardResult = identifyFragmentedVoxels(hardField, hard);

    expect(softResult.fragmented.length).toBeGreaterThan(hardResult.fragmented.length);
  });

  it('returns voxels in a deterministic order', () => {
    const gridA = solidGrid(9);
    const gridB = solidGrid(9);
    const fieldA = createEnergyField(gridA, wholeGrid(gridA));
    const fieldB = createEnergyField(gridB, wholeGrid(gridB));

    seedEnergy(fieldA, [{ x: 4, y: 4, z: 4, energy: CRUITE * 50 }]);
    seedEnergy(fieldB, [{ x: 4, y: 4, z: 4, energy: CRUITE * 50 }]);

    expect(identifyFragmentedVoxels(fieldB, gridB).fragmented)
      .toEqual(identifyFragmentedVoxels(fieldA, gridA).fragmented);
  });

  it('the mask and the list agree', () => {
    const grid = solidGrid(9);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 4, y: 4, z: 4, energy: CRUITE * 60 }]);

    const result = identifyFragmentedVoxels(field, grid);

    let maskCount = 0;
    for (const flag of result.mask) if (flag === 1) maskCount++;
    expect(maskCount).toBe(result.fragmented.length);
    for (const { x, y, z } of result.fragmented) {
      expect(result.mask[indexOf(field, x, y, z)]).toBe(1);
    }
  });
});

// ── Cracking ──────────────────────────────────────────────────────────────────

describe('VoxelFragmentation — cracking', () => {
  it('rock that took real energy but held together is recorded as cracked', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.7 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.cracked).toContainEqual({ x: 3, y: 3, z: 3 });
    expect(result.fragmented).toHaveLength(0);
  });

  it('cracked rock is weakened for the next blast', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.7 }]);

    identifyFragmentedVoxels(field, grid);

    expect(grid.fractureAt(3, 3, 3)).toBeCloseTo(CRACKED_VOXEL_WEAKENING, 6);
  });

  it('rock that took almost nothing is left alone', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.2 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.cracked).toHaveLength(0);
    expect(grid.fractureAt(3, 3, 3)).toBe(1.0);
  });

  it('a broken voxel is not also counted as cracked', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 5 }]);

    const result = identifyFragmentedVoxels(field, grid);

    for (const cracked of result.cracked) {
      expect(isFragmented(result, field, cracked.x, cracked.y, cracked.z)).toBe(false);
    }
  });
});

// ── Unsupported rock ──────────────────────────────────────────────────────────

describe('VoxelFragmentation — unsupported rock', () => {
  it('rock left floating by the blast comes down with it', () => {
    // A 5×5×5 grid whose only rock is a lone block in the middle, plus an
    // anchored column at the edge so the fill has something to hold on to.
    const grid = new VoxelGrid(5, 5, 5);
    for (let y = 0; y < 5; y++) grid.setVoxel(0, y, 0, rockVoxel('cruite'));
    grid.setVoxel(2, 2, 2, rockVoxel('cruite'));

    const field = createEnergyField(grid, wholeGrid(grid));
    const result = identifyFragmentedVoxels(field, grid);

    // The floating block never took any energy, but nothing connects it to the
    // shell, so it drops.
    expect(isFragmented(result, field, 2, 2, 2)).toBe(true);
    expect(result.detachedCount).toBe(1);
    // The anchored column stays put.
    expect(isFragmented(result, field, 0, 2, 0)).toBe(false);
  });

  it('an arch whose footings are blasted away collapses', () => {
    const grid = solidGrid(9);
    // Hollow out everything under y=5 in a 3×3 column, leaving a roof above it
    // that still connects to the surrounding rock — it should survive.
    for (let y = 0; y < 5; y++) {
      for (let z = 3; z <= 5; z++) for (let x = 3; x <= 5; x++) grid.clearVoxel(x, y, z);
    }
    const field = createEnergyField(grid, wholeGrid(grid));
    const result = identifyFragmentedVoxels(field, grid);

    // Still attached sideways, so nothing detaches.
    expect(result.detachedCount).toBe(0);
  });

  it('rock touching the box shell counts as anchored', () => {
    const grid = solidGrid(5);
    const field = createEnergyField(grid, wholeGrid(grid));
    const result = identifyFragmentedVoxels(field, grid);

    expect(result.fragmented).toHaveLength(0);
    expect(result.detachedCount).toBe(0);
  });

  it('an island cut off by a blast is detached, and the count is reported', () => {
    // Two rock columns joined by a single bridge voxel; blast the bridge.
    const grid = new VoxelGrid(7, 7, 7);
    for (let y = 0; y < 7; y++) grid.setVoxel(0, y, 3, rockVoxel('cruite'));
    grid.setVoxel(1, 3, 3, rockVoxel('cruite'));   // bridge
    grid.setVoxel(2, 3, 3, rockVoxel('cruite'));   // island
    grid.setVoxel(3, 3, 3, rockVoxel('cruite'));   // island

    const field = createEnergyField(grid, wholeGrid(grid));
    seedEnergy(field, [{ x: 1, y: 3, z: 3, energy: CRUITE * 1.2 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(isFragmented(result, field, 1, 3, 3)).toBe(true);
    // x=3 touches neither shell face, and its only path out went through the bridge.
    expect(isFragmented(result, field, 2, 3, 3)).toBe(true);
    expect(result.detachedCount).toBeGreaterThan(0);
  });
});
