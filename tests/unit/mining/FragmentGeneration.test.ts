import { describe, it, expect } from 'vitest';
import { generateFragments, seedCountForIntensity } from '../../../src/core/mining/FragmentGeneration.js';
import {
  createEnergyField,
  seedEnergy,
  type BlastBox,
} from '../../../src/core/mining/EnergyPropagation.js';
import { identifyFragmentedVoxels } from '../../../src/core/mining/VoxelFragmentation.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { Random } from '../../../src/core/math/Random.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/config/balance.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rockVoxel(rockId: string, ores: Record<string, number> = {}): VoxelData {
  return {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: ores,
    fractureModifier: 1.0,
  };
}

function solidGrid(size: number, rockId = 'cruite'): VoxelGrid {
  const grid = new VoxelGrid(size, size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) grid.setVoxel(x, y, z, rockVoxel(rockId));
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

const CRUITE = getRock('cruite')!.energyAbsorption;

/** Blast a grid and carve the result into fragments. */
function blastAndCarve(grid: VoxelGrid, energy: number, seed = 7, at = { x: 5, y: 5, z: 5 }) {
  const field = createEnergyField(grid, wholeGrid(grid));
  seedEnergy(field, [{ ...at, energy }]);
  const fragmentation = identifyFragmentedVoxels(field, grid);
  const result = generateFragments(fragmentation, field, grid, new Random(seed));
  return { field, fragmentation, ...result };
}

// ── Seed counts ───────────────────────────────────────────────────────────────

describe('FragmentGeneration — seedCountForIntensity', () => {
  it('a barely-broken voxel usually contributes no seed, so its rock joins a neighbour', () => {
    const rng = new Random(1);
    let none = 0;
    for (let i = 0; i < 200; i++) if (seedCountForIntensity(1.0, rng) === 0) none++;
    expect(none).toBeGreaterThan(100);
  });

  it('a violently hit voxel contributes several seeds', () => {
    const rng = new Random(1);
    let total = 0;
    for (let i = 0; i < 100; i++) total += seedCountForIntensity(8, rng);
    expect(total / 100).toBeGreaterThan(3);
  });

  it('seed count rises with intensity', () => {
    const rng = new Random(3);
    const mean = (intensity: number): number => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += seedCountForIntensity(intensity, rng);
      return total / 300;
    };
    expect(mean(6)).toBeGreaterThan(mean(2));
    expect(mean(2)).toBeGreaterThan(mean(1));
  });

  it('is capped so one voxel cannot produce unbounded dust', () => {
    const rng = new Random(5);
    for (let i = 0; i < 50; i++) expect(seedCountForIntensity(1e6, rng)).toBeLessThanOrEqual(8);
  });

  it('never returns a negative count for unbroken rock', () => {
    const rng = new Random(5);
    expect(seedCountForIntensity(0, rng)).toBe(0);
  });
});

// ── Volume conservation ───────────────────────────────────────────────────────

describe('FragmentGeneration — volume conservation', () => {
  it('the fragments account for exactly the rock that was removed', () => {
    const grid = solidGrid(13);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 300, 11, { x: 6, y: 6, z: 6 });

    expect(fragments.length).toBeGreaterThan(0);
    const total = fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(total).toBeCloseTo(fragmentation.fragmented.length, 6);
  });

  it('holds for a small blast too', () => {
    const grid = solidGrid(9);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 12, 4, { x: 4, y: 4, z: 4 });

    const total = fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(total).toBeCloseTo(fragmentation.fragmented.length, 6);
  });

  it('produces nothing when nothing broke', () => {
    const grid = solidGrid(7);
    const { fragments } = blastAndCarve(grid, CRUITE * 0.2, 2, { x: 3, y: 3, z: 3 });

    expect(fragments).toEqual([]);
  });
});

// ── Fragment size responds to the blast ───────────────────────────────────────

describe('FragmentGeneration — fragment size follows the blast', () => {
  it('a heavier charge breaks the same rock into smaller pieces', () => {
    const gentle = solidGrid(15);
    const violent = solidGrid(15);

    const a = blastAndCarve(gentle, CRUITE * 40, 21, { x: 7, y: 7, z: 7 });
    const b = blastAndCarve(violent, CRUITE * 600, 21, { x: 7, y: 7, z: 7 });

    const meanSize = (fs: Array<{ volumeM3: number }>): number =>
      fs.reduce((s, f) => s + f.volumeM3, 0) / fs.length;

    expect(meanSize(b.fragments)).toBeLessThan(meanSize(a.fragments));
  });

  it('a modest blast leaves oversized boulders a hauler cannot take', () => {
    const grid = solidGrid(15);
    const { fragments } = blastAndCarve(grid, CRUITE * 40, 33, { x: 7, y: 7, z: 7 });

    const oversized = fragments.filter(f => f.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD);
    expect(oversized.length).toBeGreaterThan(0);
  });

  it('a heavier charge leaves a smaller share of the rock as oversized boulders', () => {
    const gentle = blastAndCarve(solidGrid(15), CRUITE * 40, 33, { x: 7, y: 7, z: 7 });
    const violent = blastAndCarve(solidGrid(15), CRUITE * 600, 33, { x: 7, y: 7, z: 7 });

    const oversizedShare = (fs: Array<{ volumeM3: number }>): number =>
      fs.filter(f => f.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD).length / fs.length;

    expect(oversizedShare(violent.fragments)).toBeLessThan(oversizedShare(gentle.fragments));
  });

  it('fragments span more than one voxel where the rock barely broke', () => {
    const grid = solidGrid(15);
    const { fragments } = blastAndCarve(grid, CRUITE * 40, 33, { x: 7, y: 7, z: 7 });

    // A fragment drawing on several source voxels is one that bridged them.
    expect(fragments.some(f => f.sources.length > 1)).toBe(true);
  });

  it('no fragment is larger than the rock that was removed', () => {
    const grid = solidGrid(11);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 100, 8, { x: 5, y: 5, z: 5 });

    for (const f of fragments) {
      expect(f.volumeM3).toBeLessThanOrEqual(fragmentation.fragmented.length);
      expect(f.volumeM3).toBeGreaterThan(0);
    }
  });
});

// ── Composition, mass and shape ───────────────────────────────────────────────

describe('FragmentGeneration — fragment properties', () => {
  it('mass follows volume and rock density', () => {
    const grid = solidGrid(11, 'cruite');
    const density = getRock('cruite')!.density;
    const { fragments } = blastAndCarve(grid, CRUITE * 80, 6, { x: 5, y: 5, z: 5 });

    for (const f of fragments) {
      expect(f.massKg).toBeCloseTo(f.volumeM3 * density, 4);
    }
  });

  it('a fragment carved from two strata carries the mix of both', () => {
    const grid = new VoxelGrid(11, 11, 11);
    for (let z = 0; z < 11; z++) {
      for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 11; x++) {
          grid.setVoxel(x, y, z, rockVoxel(y < 5 ? 'cruite' : 'sandite'));
        }
      }
    }
    const { fragments } = blastAndCarve(grid, CRUITE * 200, 9, { x: 5, y: 4, z: 5 });

    const mixed = fragments.filter(f => f.composition.rocks.length > 1);
    expect(mixed.length).toBeGreaterThan(0);
    for (const f of mixed) {
      const total = f.composition.rocks.reduce((s, r) => s + r.coefficient, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it('carries ore through from the ground it came from', () => {
    const grid = new VoxelGrid(11, 11, 11);
    for (let z = 0; z < 11; z++) {
      for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 11; x++) {
          grid.setVoxel(x, y, z, rockVoxel('cruite', { rustite: 0.4 }));
        }
      }
    }
    const { fragments } = blastAndCarve(grid, CRUITE * 120, 12, { x: 5, y: 5, z: 5 });

    expect(fragments.every(f => (f.oreDensities['rustite'] ?? 0) > 0)).toBe(true);
  });

  it('gives every fragment a real bounding box and a dominant rock', () => {
    const grid = solidGrid(11);
    const { fragments } = blastAndCarve(grid, CRUITE * 120, 15, { x: 5, y: 5, z: 5 });

    for (const f of fragments) {
      expect(f.halfExtents.x).toBeGreaterThan(0);
      expect(f.halfExtents.y).toBeGreaterThan(0);
      expect(f.halfExtents.z).toBeGreaterThan(0);
      expect(f.rockId).toBe('cruite');
      expect(Number.isFinite(f.origin.x)).toBe(true);
    }
  });

  it('carves every fragment out of rock the blast actually broke', () => {
    const grid = solidGrid(11);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 120, 17, { x: 5, y: 5, z: 5 });

    const broken = new Set(fragmentation.fragmented.map(v => `${v.x},${v.y},${v.z}`));
    for (const f of fragments) {
      for (const source of f.sources) {
        const key = `${source.x},${source.y},${source.z}`;
        expect(broken.has(key), `fragment drew on unbroken voxel ${key}`).toBe(true);
      }
    }
  });

  it('claims each piece of broken rock exactly once', () => {
    const { fragments } = blastAndCarve(solidGrid(11), CRUITE * 120, 17, { x: 5, y: 5, z: 5 });

    // Summed per source voxel, the weights fragments took can never exceed the
    // 1 m³ that voxel had to give.
    const taken = new Map<string, number>();
    for (const f of fragments) {
      for (const s of f.sources) {
        const key = `${s.x},${s.y},${s.z}`;
        taken.set(key, (taken.get(key) ?? 0) + s.weight);
      }
    }
    for (const [key, weight] of taken) {
      expect(weight, `voxel ${key} over-claimed`).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('FragmentGeneration — determinism', () => {
  it('the same blast and seed carve the same fragments', () => {
    const a = blastAndCarve(solidGrid(11), CRUITE * 150, 42, { x: 5, y: 5, z: 5 });
    const b = blastAndCarve(solidGrid(11), CRUITE * 150, 42, { x: 5, y: 5, z: 5 });

    expect(b.fragments.length).toBe(a.fragments.length);
    expect(b.fragments.map(f => f.volumeM3)).toEqual(a.fragments.map(f => f.volumeM3));
    expect(b.fragments.map(f => f.origin)).toEqual(a.fragments.map(f => f.origin));
  });

  it('a different seed carves the same rock differently', () => {
    const a = blastAndCarve(solidGrid(11), CRUITE * 150, 1, { x: 5, y: 5, z: 5 });
    const b = blastAndCarve(solidGrid(11), CRUITE * 150, 999, { x: 5, y: 5, z: 5 });

    // Same volume of rock either way — just cut differently.
    const volA = a.fragments.reduce((s, f) => s + f.volumeM3, 0);
    const volB = b.fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(volB).toBeCloseTo(volA, 6);
    expect(b.fragments.map(f => f.origin)).not.toEqual(a.fragments.map(f => f.origin));
  });
});
