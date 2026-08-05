import { describe, it, expect } from 'vitest';
import {
  computeAverageRockComposition,
  computeAverageOreDensities,
  dominantRockOf,
  type VoxelContribution,
} from '../../../src/core/mining/FragmentComposition.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function voxel(
  rocks: Array<{ rockId: string; coefficient: number }>,
  oreDensities: Record<string, number> = {},
): VoxelData {
  return { composition: { rocks }, density: 1.0, oreDensities, fractureModifier: 1.0 };
}

/** A 4×4×4 grid of air, so tests place only the voxels they care about. */
function emptyGrid(): VoxelGrid {
  return new VoxelGrid(4, 4, 4);
}

function at(x: number, y: number, z: number, weight = 1): VoxelContribution {
  return { x, y, z, weight };
}

// ── computeAverageRockComposition ─────────────────────────────────────────────

describe('FragmentComposition — computeAverageRockComposition', () => {
  it('a fragment inside one voxel inherits that voxel composition', () => {
    const grid = emptyGrid();
    grid.setVoxel(1, 1, 1, voxel([{ rockId: 'cruite', coefficient: 0.7 }, { rockId: 'sandite', coefficient: 0.3 }]));

    const result = computeAverageRockComposition([at(1, 1, 1)], grid);

    expect(result.rocks).toEqual([
      { rockId: 'cruite', coefficient: 0.7 },
      { rockId: 'sandite', coefficient: 0.3 },
    ]);
  });

  it('a fragment straddling two single-rock strata gets the volume-weighted mix', () => {
    const grid = emptyGrid();
    grid.setVoxel(1, 1, 1, voxel([{ rockId: 'cruite', coefficient: 1.0 }]));
    grid.setVoxel(1, 2, 1, voxel([{ rockId: 'sandite', coefficient: 1.0 }]));

    const result = computeAverageRockComposition([at(1, 1, 1), at(1, 2, 1)], grid);

    // Equal volume from each stratum → 50/50, NOT 100/100.
    expect(result.rocks).toEqual([
      { rockId: 'cruite', coefficient: 0.5 },
      { rockId: 'sandite', coefficient: 0.5 },
    ]);
  });

  it('weights contributions by volume, not by voxel count', () => {
    const grid = emptyGrid();
    grid.setVoxel(1, 1, 1, voxel([{ rockId: 'cruite', coefficient: 1.0 }]));
    grid.setVoxel(1, 2, 1, voxel([{ rockId: 'sandite', coefficient: 1.0 }]));

    // Three quarters of the fragment comes from the cruite voxel.
    const result = computeAverageRockComposition([at(1, 1, 1, 0.75), at(1, 2, 1, 0.25)], grid);

    expect(result.rocks[0]).toEqual({ rockId: 'cruite', coefficient: 0.75 });
    expect(result.rocks[1]).toEqual({ rockId: 'sandite', coefficient: 0.25 });
  });

  it('coefficients always sum to 1', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 0.5 }, { rockId: 'sandite', coefficient: 0.5 }]));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'sandite', coefficient: 0.2 }, { rockId: 'molite', coefficient: 0.8 }]));
    grid.setVoxel(2, 0, 0, voxel([{ rockId: 'molite', coefficient: 1.0 }]));

    const result = computeAverageRockComposition([at(0, 0, 0), at(1, 0, 0, 2), at(2, 0, 0, 0.5)], grid);

    const total = result.rocks.reduce((s, r) => s + r.coefficient, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('normalizes source voxels whose own coefficients do not sum to 1', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 0.4 }, { rockId: 'sandite', coefficient: 0.4 }]));

    const result = computeAverageRockComposition([at(0, 0, 0)], grid);

    expect(result.rocks[0]!.coefficient).toBeCloseTo(0.5, 10);
    expect(result.rocks[1]!.coefficient).toBeCloseTo(0.5, 10);
  });

  it('orders entries by descending coefficient so the dominant rock is first', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([
      { rockId: 'sandite', coefficient: 0.2 },
      { rockId: 'molite', coefficient: 0.5 },
      { rockId: 'cruite', coefficient: 0.3 },
    ]));

    const result = computeAverageRockComposition([at(0, 0, 0)], grid);

    expect(result.rocks.map(r => r.rockId)).toEqual(['molite', 'cruite', 'sandite']);
  });

  it('ignores air voxels and out-of-bounds sources', () => {
    const grid = emptyGrid();
    grid.setVoxel(1, 1, 1, voxel([{ rockId: 'cruite', coefficient: 1.0 }]));

    const result = computeAverageRockComposition(
      [at(1, 1, 1), at(2, 2, 2), at(99, 99, 99)],
      grid,
    );

    expect(result.rocks).toEqual([{ rockId: 'cruite', coefficient: 1.0 }]);
  });

  it('ignores zero and negative weights', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }]));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'sandite', coefficient: 1.0 }]));

    const result = computeAverageRockComposition([at(0, 0, 0, 1), at(1, 0, 0, 0), at(1, 0, 0, -5)], grid);

    expect(result.rocks).toEqual([{ rockId: 'cruite', coefficient: 1.0 }]);
  });

  it('returns an empty composition when nothing contributes', () => {
    expect(computeAverageRockComposition([], emptyGrid()).rocks).toEqual([]);
    expect(computeAverageRockComposition([at(3, 3, 3)], emptyGrid()).rocks).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 0.5 }, { rockId: 'sandite', coefficient: 0.5 }]));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'molite', coefficient: 1.0 }]));
    const sources = [at(0, 0, 0), at(1, 0, 0, 1.5)];

    const first = computeAverageRockComposition(sources, grid);
    const second = computeAverageRockComposition(sources, grid);

    expect(second).toEqual(first);
  });
});

// ── computeAverageOreDensities ────────────────────────────────────────────────

describe('FragmentComposition — computeAverageOreDensities', () => {
  it('averages ore grades over the fragment volume', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0.4 }));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0.2 }));

    const result = computeAverageOreDensities([at(0, 0, 0), at(1, 0, 0)], grid);

    expect(result['rustite']).toBeCloseTo(0.3, 10);
  });

  it('dilutes an ore vein across barren rock instead of normalizing it back up', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0.8 }));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], {}));
    grid.setVoxel(2, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], {}));

    const result = computeAverageOreDensities([at(0, 0, 0), at(1, 0, 0), at(2, 0, 0)], grid);

    // One third of the fragment carries the vein: 0.8/3, never 0.8.
    expect(result['rustite']).toBeCloseTo(0.8 / 3, 10);
  });

  it('does not force densities to sum to 1', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0.1, blingite: 0.05 }));

    const result = computeAverageOreDensities([at(0, 0, 0)], grid);

    expect(result['rustite']).toBeCloseTo(0.1, 10);
    expect(result['blingite']).toBeCloseTo(0.05, 10);
  });

  it('weights ore grades by volume', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 1.0 }));
    grid.setVoxel(1, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0.0 }));

    const result = computeAverageOreDensities([at(0, 0, 0, 3), at(1, 0, 0, 1)], grid);

    expect(result['rustite']).toBeCloseTo(0.75, 10);
  });

  it('omits ores that average out to zero', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }], { rustite: 0, blingite: 0.2 }));

    const result = computeAverageOreDensities([at(0, 0, 0)], grid);

    expect(result['rustite']).toBeUndefined();
    expect(result['blingite']).toBeCloseTo(0.2, 10);
  });

  it('returns an empty record when no source voxel carries ore', () => {
    const grid = emptyGrid();
    grid.setVoxel(0, 0, 0, voxel([{ rockId: 'cruite', coefficient: 1.0 }]));

    expect(computeAverageOreDensities([at(0, 0, 0)], grid)).toEqual({});
    expect(computeAverageOreDensities([], grid)).toEqual({});
  });
});

// ── dominantRockOf ────────────────────────────────────────────────────────────

describe('FragmentComposition — dominantRockOf', () => {
  it('returns the highest-coefficient rock', () => {
    expect(dominantRockOf({ rocks: [
      { rockId: 'cruite', coefficient: 0.3 },
      { rockId: 'sandite', coefficient: 0.6 },
      { rockId: 'molite', coefficient: 0.1 },
    ] })).toBe('sandite');
  });

  it('returns an empty id for an empty composition', () => {
    expect(dominantRockOf({ rocks: [] })).toBe('');
  });
});
