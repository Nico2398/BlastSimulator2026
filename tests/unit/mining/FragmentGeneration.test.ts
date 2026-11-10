import { describe, it, expect } from 'vitest';
import { generateFragments, seedCountForIntensity } from '../../../src/core/mining/FragmentGeneration.js';
import {
  createEnergyField,
  seedEnergy,
  indexOf,
  intensityAt,
  type BlastBox,
} from '../../../src/core/mining/EnergyPropagation.js';
import { identifyFragmentedVoxels, type FragmentationResult, type VoxelCoord } from '../../../src/core/mining/VoxelFragmentation.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  FRAGMENTATION_MULTIPLIER,
  MAX_SEEDS_PER_VOXEL,
  OVERSIZED_FRAGMENT_THRESHOLD,
  SEEDS_BASE,
  SEEDS_PER_INTENSITY,
} from '../../../src/core/config/balance.js';

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
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) grid.setVoxel(x, y, z, rockVoxel(rockId));
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

const CRUITE = getRock('cruite')!.energyAbsorption;

/** Blast a grid and carve the result into fragments. `height` is the grid's own constructed height. */
function blastAndCarve(grid: VoxelGrid, energy: number, height: number, seed = 7, at = { x: 5, y: 5, z: 5 }) {
  const field = createEnergyField(grid, wholeGrid(grid, height));
  seedEnergy(field, [{ ...at, energy }]);
  const fragmentation = identifyFragmentedVoxels(field, grid);
  const result = generateFragments(fragmentation, field, grid, new Random(seed));
  return { field, fragmentation, ...result };
}

// ── Seed counts ───────────────────────────────────────────────────────────────

/** Mean seed count over many draws at one intensity. */
function meanSeeds(intensity: number, draws = 2000, seed = 1): number {
  const rng = new Random(seed);
  let total = 0;
  for (let i = 0; i < draws; i++) total += seedCountForIntensity(intensity, rng);
  return total / draws;
}

describe('FragmentGeneration — seedCountForIntensity', () => {
  it('a voxel at its breaking point contributes SEEDS_BASE seeds', () => {
    expect(Math.abs(meanSeeds(FRAGMENTATION_MULTIPLIER) - SEEDS_BASE)).toBeLessThan(0.05);
  });

  it('adds SEEDS_PER_INTENSITY seeds per unit of intensity above the breaking point', () => {
    for (const above of [0.5, 1.25]) {
      const expected = SEEDS_BASE + SEEDS_PER_INTENSITY * above;
      expect(Math.abs(meanSeeds(FRAGMENTATION_MULTIPLIER + above) - expected), `+${above}`).toBeLessThan(0.05);
    }
  });

  it('rock broken with less energy than its threshold seeds the base scaled by its intensity', () => {
    // Lifted burden, rock floored to grade, unsupported rock: broken without the energy to fragment it.
    for (const intensity of [0.1, 0.3]) {
      const expected = SEEDS_BASE * intensity / FRAGMENTATION_MULTIPLIER;
      expect(Math.abs(meanSeeds(intensity) - expected), `intensity ${intensity}`).toBeLessThan(0.05);
    }
  });

  it('so most rock broken with little energy contributes no seed, and its rock joins a neighbour', () => {
    const rng = new Random(1);
    let none = 0;
    for (let i = 0; i < 200; i++) if (seedCountForIntensity(0.1, rng) === 0) none++;
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
    expect(mean(1)).toBeGreaterThan(mean(0.5));
  });

  it('is capped so one voxel cannot produce unbounded dust', () => {
    const rng = new Random(5);
    for (let i = 0; i < 50; i++) expect(seedCountForIntensity(1e6, rng)).toBeLessThanOrEqual(MAX_SEEDS_PER_VOXEL);
  });

  it('never returns a negative count for unbroken rock', () => {
    const rng = new Random(5);
    expect(seedCountForIntensity(0, rng)).toBe(0);
    expect(seedCountForIntensity(-2, rng)).toBe(0);
  });
});

// ── Volume conservation ───────────────────────────────────────────────────────

describe('FragmentGeneration — volume conservation', () => {
  it('the fragments account for exactly the rock that was removed', () => {
    const grid = solidGrid(13);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 300, 13, 11, { x: 6, y: 6, z: 6 });

    expect(fragments.length).toBeGreaterThan(0);
    const total = fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(total).toBeCloseTo(fragmentation.fragmented.length, 6);
  });

  it('holds for a small blast too', () => {
    const grid = solidGrid(9);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 60, 9, 4, { x: 4, y: 4, z: 4 });

    expect(fragments.length).toBeGreaterThan(0);
    const total = fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(total).toBeCloseTo(fragmentation.fragmented.length, 6);
  });

  it('produces nothing when nothing broke', () => {
    const grid = solidGrid(7);
    const { fragments } = blastAndCarve(grid, CRUITE * 0.2, 7, 2, { x: 3, y: 3, z: 3 });

    expect(fragments).toEqual([]);
  });
});

// ── Fragment size responds to the blast ───────────────────────────────────────

// A charge 4 m under the surface of a bench (rock y 0..9, open air above). A modest one breaks
// the rock round it and lifts the cap above it — rock broken with less energy than its
// threshold, which seeds little and comes out in boulders. A heavier one fragments the cap too.
const BENCH_SIZE = 15;
const BENCH_TOP_Y = 9;
const BENCH_CHARGE = { x: 7, y: BENCH_TOP_Y - 4, z: 7 };
const MODEST_CHARGE = CRUITE * 60;
const HEAVY_CHARGE = CRUITE * 600;

function benchBlast(energy: number, seed: number) {
  const grid = new VoxelGrid(BENCH_SIZE, BENCH_SIZE);
  for (let z = 0; z < BENCH_SIZE; z++) {
    for (let y = 0; y <= BENCH_TOP_Y; y++) {
      for (let x = 0; x < BENCH_SIZE; x++) grid.setVoxel(x, y, z, rockVoxel('cruite'));
    }
  }
  return blastAndCarve(grid, energy, BENCH_SIZE, seed, BENCH_CHARGE);
}

describe('FragmentGeneration — fragment size follows the blast', () => {
  it('a heavier charge breaks the same rock into smaller pieces', () => {
    const a = benchBlast(MODEST_CHARGE, 21);
    const b = benchBlast(HEAVY_CHARGE, 21);

    const meanSize = (fs: Array<{ volumeM3: number }>): number =>
      fs.reduce((s, f) => s + f.volumeM3, 0) / fs.length;

    expect(meanSize(b.fragments)).toBeLessThan(meanSize(a.fragments));
  });

  it('a modest blast leaves oversized boulders a hauler cannot take', () => {
    const { fragmentation, fragments } = benchBlast(MODEST_CHARGE, 33);

    // The cap over the charge was lifted rather than fragmented.
    expect(fragmentation.liftedCount).toBeGreaterThan(0);
    const oversized = fragments.filter(f => f.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD);
    expect(oversized.length).toBeGreaterThan(0);
  });

  it('a heavier charge leaves a smaller share of the rock as oversized boulders', () => {
    const gentle = benchBlast(MODEST_CHARGE, 33);
    const violent = benchBlast(HEAVY_CHARGE, 33);

    const oversizedShare = (fs: Array<{ volumeM3: number }>): number =>
      fs.filter(f => f.volumeM3 > OVERSIZED_FRAGMENT_THRESHOLD).length / fs.length;

    expect(oversizedShare(violent.fragments)).toBeLessThan(oversizedShare(gentle.fragments));
  });

  it('fragments span more than one voxel where the rock barely broke', () => {
    const { field, fragments } = benchBlast(MODEST_CHARGE, 33);
    const barelyBroken = (s: { x: number; y: number; z: number }): boolean =>
      intensityAt(field, s.x, s.y, s.z) < FRAGMENTATION_MULTIPLIER;

    // Rock that took less than its threshold seeds little, so it went into a fragment bridging it
    // with its neighbours.
    expect(fragments.some(f => f.sources.length > 1 && f.sources.some(barelyBroken))).toBe(true);
  });

  it('no fragment is larger than the rock that was removed', () => {
    const grid = solidGrid(11);
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 100, 11, 8, { x: 5, y: 5, z: 5 });

    expect(fragments.length).toBeGreaterThan(0);
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
    const { fragments } = blastAndCarve(grid, CRUITE * 80, 11, 6, { x: 5, y: 5, z: 5 });

    for (const f of fragments) {
      expect(f.massKg + f.lostMassKg).toBeCloseTo(f.volumeM3 * density, 4);
    }
  });

  it('a fragment carved from two strata carries the mix of both', () => {
    const grid = new VoxelGrid(11, 11);
    for (let z = 0; z < 11; z++) {
      for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 11; x++) {
          grid.setVoxel(x, y, z, rockVoxel(y < 5 ? 'cruite' : 'sandite'));
        }
      }
    }
    const { fragments } = blastAndCarve(grid, CRUITE * 200, 11, 9, { x: 5, y: 4, z: 5 });

    const mixed = fragments.filter(f => f.composition.rocks.length > 1);
    expect(mixed.length).toBeGreaterThan(0);
    for (const f of mixed) {
      const total = f.composition.rocks.reduce((s, r) => s + r.coefficient, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it('carries ore through from the ground it came from', () => {
    const grid = new VoxelGrid(11, 11);
    for (let z = 0; z < 11; z++) {
      for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 11; x++) {
          grid.setVoxel(x, y, z, rockVoxel('cruite', { rustite: 0.4 }));
        }
      }
    }
    const { fragments } = blastAndCarve(grid, CRUITE * 120, 11, 12, { x: 5, y: 5, z: 5 });

    expect(fragments.every(f => (f.oreDensities['rustite'] ?? 0) > 0)).toBe(true);
  });

  it('gives every fragment a real bounding box and a dominant rock', () => {
    const grid = solidGrid(11);
    const { fragments } = blastAndCarve(grid, CRUITE * 120, 11, 15, { x: 5, y: 5, z: 5 });

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
    const { fragmentation, fragments } = blastAndCarve(grid, CRUITE * 120, 11, 17, { x: 5, y: 5, z: 5 });

    const broken = new Set(fragmentation.fragmented.map(v => `${v.x},${v.y},${v.z}`));
    for (const f of fragments) {
      for (const source of f.sources) {
        const key = `${source.x},${source.y},${source.z}`;
        expect(broken.has(key), `fragment drew on unbroken voxel ${key}`).toBe(true);
      }
    }
  });

  it('claims each piece of broken rock exactly once', () => {
    const { fragments } = blastAndCarve(solidGrid(11), CRUITE * 120, 11, 17, { x: 5, y: 5, z: 5 });

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
    const a = blastAndCarve(solidGrid(11), CRUITE * 150, 11, 42, { x: 5, y: 5, z: 5 });
    const b = blastAndCarve(solidGrid(11), CRUITE * 150, 11, 42, { x: 5, y: 5, z: 5 });

    expect(b.fragments.length).toBe(a.fragments.length);
    expect(b.fragments.map(f => f.volumeM3)).toEqual(a.fragments.map(f => f.volumeM3));
    expect(b.fragments.map(f => f.origin)).toEqual(a.fragments.map(f => f.origin));
  });

  it('a different seed carves the same rock differently', () => {
    const a = blastAndCarve(solidGrid(11), CRUITE * 150, 11, 1, { x: 5, y: 5, z: 5 });
    const b = blastAndCarve(solidGrid(11), CRUITE * 150, 11, 999, { x: 5, y: 5, z: 5 });

    // Same volume of rock either way — just cut differently.
    const volA = a.fragments.reduce((s, f) => s + f.volumeM3, 0);
    const volB = b.fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(volB).toBeCloseTo(volA, 6);
    expect(b.fragments.map(f => f.origin)).not.toEqual(a.fragments.map(f => f.origin));
  });
});

// ── Fragment size follows the fragmentation band (#2198) ─────────────────────

/**
 * A field over a solid grid in which every voxel of the block x/y/z in [3, 11) was hit
 * with the intensity `intensityAt(x)` says, all of them broken. Intensity is written
 * straight into the field (retained = threshold, overflow = the rest), so a test names
 * the band it wants instead of hunting for a charge that produces it.
 */
function blockWithIntensity(intensityAt: (x: number, y: number, z: number) => number) {
  const size = 14;
  const grid = solidGrid(size);
  const field = createEnergyField(grid, wholeGrid(grid, size));
  const fragmented: VoxelCoord[] = [];
  const mask = new Uint8Array(field.effective.length);
  for (let z = 3; z < 11; z++) {
    for (let y = 3; y < 11; y++) {
      for (let x = 3; x < 11; x++) {
        const i = indexOf(field, x, y, z);
        const threshold = field.threshold[i]!;
        field.effective[i] = threshold;
        field.overflowOut[i] = threshold * (intensityAt(x, y, z) - 1);
        mask[i] = 1;
        fragmented.push({ x, y, z });
      }
    }
  }
  const fragmentation: FragmentationResult = {
    fragmented, mask, cracked: [], detachedCount: 0, liftedCount: 0, gradedCount: 0,
  };
  return { grid, field, fragmentation };
}

/** Mean fragment volume of a uniformly hit block, averaged over several carving seeds. */
function meanVolumeAtIntensity(intensity: number): number {
  let total = 0;
  const seeds = [1, 2, 3, 4, 5];
  for (const seed of seeds) {
    const { grid, field, fragmentation } = blockWithIntensity(() => intensity);
    const { fragments } = generateFragments(fragmentation, field, grid, new Random(seed));
    total += fragments.reduce((s, f) => s + f.volumeM3, 0) / fragments.length;
  }
  return total / seeds.length;
}

// Mid-band intensities: good [1, 2), fines [2, 4), dust [4, inf).
const GOOD_INTENSITY = 1.5;
const FINES_INTENSITY = 3;
const DUST_INTENSITY = 6;

describe('FragmentGeneration — fragment size follows the band', () => {
  it('good-band rock carves into larger pieces than fines', () => {
    expect(meanVolumeAtIntensity(GOOD_INTENSITY)).toBeGreaterThan(meanVolumeAtIntensity(FINES_INTENSITY));
  });

  it('fines carve into larger pieces than dust', () => {
    expect(meanVolumeAtIntensity(FINES_INTENSITY)).toBeGreaterThan(meanVolumeAtIntensity(DUST_INTENSITY));
  });

  it('mean fragment volume shrinks good > fines > dust', () => {
    const good = meanVolumeAtIntensity(GOOD_INTENSITY);
    const fines = meanVolumeAtIntensity(FINES_INTENSITY);
    const dust = meanVolumeAtIntensity(DUST_INTENSITY);
    expect(good).toBeGreaterThan(fines);
    expect(fines).toBeGreaterThan(dust);
    expect(dust).toBeGreaterThan(0);
  });

  it('in one blast, rock in the dust half is finer than rock in the good half', () => {
    const { grid, field, fragmentation } = blockWithIntensity(x => (x < 7 ? DUST_INTENSITY : GOOD_INTENSITY));
    const { fragments } = generateFragments(fragmentation, field, grid, new Random(9));

    const dustSide = fragments.filter(f => f.sources.every(s => s.x < 7));
    const goodSide = fragments.filter(f => f.sources.every(s => s.x >= 7));
    expect(dustSide.length).toBeGreaterThan(0);
    expect(goodSide.length).toBeGreaterThan(0);
    const mean = (fs: typeof fragments): number => fs.reduce((s, f) => s + f.volumeM3, 0) / fs.length;
    expect(mean(dustSide)).toBeLessThan(mean(goodSide));
  });

  it('volume stays conserved whatever the band mix', () => {
    const { grid, field, fragmentation } = blockWithIntensity(
      (x, y) => (y < 5 ? DUST_INTENSITY : x < 7 ? FINES_INTENSITY : GOOD_INTENSITY),
    );
    const { fragments } = generateFragments(fragmentation, field, grid, new Random(4));

    const total = fragments.reduce((s, f) => s + f.volumeM3, 0);
    expect(total).toBeCloseTo(fragmentation.fragmented.length, 6);
  });

  it('seedCountForIntensity keeps its signature and still rises with intensity', () => {
    const mean = (intensity: number): number => {
      const rng = new Random(11);
      let total = 0;
      for (let i = 0; i < 300; i++) total += seedCountForIntensity(intensity, rng);
      return total / 300;
    };
    expect(mean(DUST_INTENSITY)).toBeGreaterThan(mean(GOOD_INTENSITY));
  });

  it('is deterministic for a given seed in a banded block', () => {
    const run = () => {
      const { grid, field, fragmentation } = blockWithIntensity(x => (x < 7 ? DUST_INTENSITY : GOOD_INTENSITY));
      return generateFragments(fragmentation, field, grid, new Random(21)).fragments;
    };
    const a = run();
    const b = run();
    expect(b.map(f => f.volumeM3)).toEqual(a.map(f => f.volumeM3));
    expect(b.map(f => f.massKg)).toEqual(a.map(f => f.massKg));
  });
});
