import { describe, it, expect } from 'vitest';
import {
  computeFragmentVelocity,
  freeFaceDirection,
  throwFractionForBlowout,
} from '../../../src/core/mining/FragmentVelocity.js';
import {
  createEnergyField,
  seedEnergy,
  type BlastBox,
} from '../../../src/core/mining/EnergyPropagation.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import {
  MIN_THROW_FRACTION,
  MAX_PROJECTION_VELOCITY,
} from '../../../src/core/config/balance.js';
import type { VoxelContribution } from '../../../src/core/mining/FragmentComposition.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Solid rock up to `top`, open air above — a flat bench with a free face up. */
function bench(size = 15, top = 9): VoxelGrid {
  const grid = new VoxelGrid(size, size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y <= top; y++) {
      for (let x = 0; x < size; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
          density: 1,
          oreDensities: {},
          fractureModifier: 1,
        });
      }
    }
  }
  return grid;
}

function wholeGrid(grid: VoxelGrid): BlastBox {
  return { minX: grid.minX, minY: 0, minZ: grid.minZ, maxX: grid.maxX, maxY: grid.sizeY, maxZ: grid.maxZ };
}

const CRUITE = getRock('cruite')!.energyAbsorption;

function chargedField(grid: VoxelGrid, at: { x: number; y: number; z: number }, energy: number) {
  const field = createEnergyField(grid, wholeGrid(grid));
  seedEnergy(field, [{ ...at, energy }]);
  return field;
}

function source(x: number, y: number, z: number, weight = 1): VoxelContribution {
  return { x, y, z, weight };
}

const speedOf = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

// ── Stemming ──────────────────────────────────────────────────────────────────

describe('FragmentVelocity — throwFractionForBlowout', () => {
  it('a perfectly stemmed hole barely throws anything', () => {
    expect(throwFractionForBlowout(0)).toBeCloseTo(MIN_THROW_FRACTION, 6);
  });

  it('an unstemmed hole throws everything it has left', () => {
    expect(throwFractionForBlowout(1)).toBeCloseTo(1, 6);
  });

  it('rises with blowout, and sharply — poor stemming has to be a real mistake', () => {
    const half = throwFractionForBlowout(0.5);
    expect(half).toBeGreaterThan(throwFractionForBlowout(0.25));
    expect(half).toBeLessThan(0.5); // squared, so the middle sits well below halfway
  });

  it('clamps nonsense input', () => {
    expect(throwFractionForBlowout(-3)).toBeCloseTo(MIN_THROW_FRACTION, 6);
    expect(throwFractionForBlowout(9)).toBeCloseTo(1, 6);
  });
});

// ── Direction ─────────────────────────────────────────────────────────────────

describe('FragmentVelocity — freeFaceDirection', () => {
  it('points up out of a flat bench', () => {
    const grid = bench();
    const field = createEnergyField(grid, wholeGrid(grid));

    const dir = freeFaceDirection(field, 7, 7, 7);

    expect(dir.y).toBeGreaterThan(0.5);
  });

  it('points sideways out of a vertical face', () => {
    // Rock only where x < 8, so the free face is the wall at x = 8.
    const grid = new VoxelGrid(16, 16, 16);
    for (let z = 0; z < 16; z++) {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 8; x++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
            density: 1, oreDensities: {}, fractureModifier: 1,
          });
        }
      }
    }
    const field = createEnergyField(grid, wholeGrid(grid));

    const dir = freeFaceDirection(field, 5, 8, 8);

    expect(dir.x).toBeGreaterThan(0.5);
  });
});

// ── Magnitude ─────────────────────────────────────────────────────────────────

describe('FragmentVelocity — computeFragmentVelocity', () => {
  it('rock with no leftover energy is not thrown at all', () => {
    const grid = bench();
    const field = createEnergyField(grid, wholeGrid(grid));

    const v = computeFragmentVelocity({ x: 7, y: 7, z: 7 }, [source(7, 7, 7)], 1000, field, 1);

    expect(speedOf(v)).toBe(0);
  });

  it('an unstemmed hole throws rock far harder than a stemmed one', () => {
    const grid = bench();
    // Big enough that leftover energy actually reaches this fragment, small
    // enough that neither result runs into the speed cap.
    const field = chargedField(grid, { x: 7, y: 5, z: 7 }, CRUITE * 100);
    const origin = { x: 7, y: 8, z: 7 };
    const sources = [source(7, 8, 7)];

    const stemmed = computeFragmentVelocity(origin, sources, 1000, field, throwFractionForBlowout(0));
    const unstemmed = computeFragmentVelocity(origin, sources, 1000, field, throwFractionForBlowout(1));

    expect(speedOf(unstemmed)).toBeGreaterThan(speedOf(stemmed) * 3);
  });

  it('rock near the surface is thrown, rock buried deep only settles', () => {
    const grid = bench(21, 17);
    const field = chargedField(grid, { x: 10, y: 8, z: 10 }, CRUITE * 3000);

    const shallow = computeFragmentVelocity({ x: 10, y: 17, z: 10 }, [source(10, 17, 10)], 1000, field, 1);
    const deep = computeFragmentVelocity({ x: 10, y: 8, z: 10 }, [source(10, 8, 10)], 1000, field, 1);

    expect(speedOf(shallow)).toBeGreaterThan(speedOf(deep));
  });

  it('a heavier fragment is thrown more slowly by the same energy', () => {
    const grid = bench();
    const field = chargedField(grid, { x: 7, y: 5, z: 7 }, CRUITE * 400);
    const origin = { x: 7, y: 8, z: 7 };
    const sources = [source(7, 8, 7)];

    const light = computeFragmentVelocity(origin, sources, 200, field, 1);
    const heavy = computeFragmentVelocity(origin, sources, 4000, field, 1);

    expect(speedOf(heavy)).toBeLessThan(speedOf(light));
  });

  it('never exceeds the projection speed cap', () => {
    const grid = bench();
    const field = chargedField(grid, { x: 7, y: 8, z: 7 }, CRUITE * 100000);

    const v = computeFragmentVelocity({ x: 7, y: 9, z: 7 }, [source(7, 9, 7)], 1, field, 1);

    expect(speedOf(v)).toBeLessThanOrEqual(MAX_PROJECTION_VELOCITY + 1e-6);
  });

  it('throws rock out of the bench rather than down into it', () => {
    const grid = bench();
    const field = chargedField(grid, { x: 7, y: 5, z: 7 }, CRUITE * 800);

    const v = computeFragmentVelocity({ x: 7, y: 9, z: 7 }, [source(7, 9, 7)], 800, field, 1);

    expect(v.y).toBeGreaterThan(0);
  });

  it('refuses to move a massless fragment', () => {
    const grid = bench();
    const field = chargedField(grid, { x: 7, y: 5, z: 7 }, CRUITE * 400);

    const v = computeFragmentVelocity({ x: 7, y: 8, z: 7 }, [source(7, 8, 7)], 0, field, 1);

    expect(speedOf(v)).toBe(0);
  });

  it('is deterministic', () => {
    const grid = bench();
    const field = chargedField(grid, { x: 7, y: 5, z: 7 }, CRUITE * 400);
    const args = [{ x: 7, y: 8, z: 7 }, [source(7, 8, 7)], 900, field, 0.5] as const;

    expect(computeFragmentVelocity(...args)).toEqual(computeFragmentVelocity(...args));
  });
});
