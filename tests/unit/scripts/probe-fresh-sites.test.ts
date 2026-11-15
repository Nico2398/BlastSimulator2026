// #2062: freshSites skips barren ground while ore remains, keeps ramp corridors clear, and falls back when that leaves nothing.
import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { freshSites } from '../../../scripts/shared/probe-strategies.js';
import { LADDER_SITE_ORE_FLOOR } from '../../../scripts/shared/probe-ladder-policy.js';

const SIZE = 40;
const SPAN = 4;
const DEPTH = 2;
/** Ore patch corner-aligned with the first scan site; every voxel of the top layers carries ore. */
const GROUND_TOP = 6;
const PATCH = { lo: 8, hi: 12 };

function gridWithPatch(withOre: boolean): VoxelGrid {
  const grid = new VoxelGrid(SIZE, SIZE);
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < GROUND_TOP; y++) {
        const inPatch = withOre && y >= GROUND_TOP - DEPTH && x >= PATCH.lo && x <= PATCH.hi && z >= PATCH.lo && z <= PATCH.hi;
        grid.fillVoxel(x, y, z, 1, inPatch ? { cruite_ore: 1 } : undefined);
      }
    }
  }
  return grid;
}

const touchesPatch = (c: { x: number; z: number }): boolean =>
  c.x <= PATCH.hi && c.x + SPAN >= PATCH.lo && c.z <= PATCH.hi && c.z + SPAN >= PATCH.lo;

/** The patch above at ore density 10, and a poorer one (density 1) at POOR: a tenth of the rich patch, under LADDER_SITE_ORE_SHARE. */
const POOR = { lo: 24, hi: 28 };
function gridWithRichAndPoor(): VoxelGrid {
  const grid = new VoxelGrid(SIZE, SIZE);
  const inside = (p: { lo: number; hi: number }, x: number, z: number): boolean => x >= p.lo && x <= p.hi && z >= p.lo && z <= p.hi;
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < GROUND_TOP; y++) {
        const top = y >= GROUND_TOP - DEPTH;
        const ore = top && inside(PATCH, x, z) ? { cruite_ore: 10 } : top && inside(POOR, x, z) ? { cruite_ore: 1 } : undefined;
        grid.fillVoxel(x, y, z, 1, ore);
      }
    }
  }
  return grid;
}

const touchesPoor = (c: { x: number; z: number }): boolean =>
  c.x <= POOR.hi && c.x + SPAN >= POOR.lo && c.z <= POOR.hi && c.z + SPAN >= POOR.lo;

describe('freshSites', () => {
  it('without rules returns every free site, barren ones included', () => {
    const sites = freshSites(gridWithPatch(true), SPAN, DEPTH, []);
    expect(sites.some(c => !touchesPatch(c))).toBe(true);
  });

  it('skips barren sites while ore remains elsewhere', () => {
    const sites = freshSites(gridWithPatch(true), SPAN, DEPTH, [], { protectedZones: [] });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPatch)).toBe(true);
  });

  it('keeps every site when the whole ground is barren', () => {
    const grid = gridWithPatch(false);
    const sites = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [] });
    expect(sites.length).toBe(freshSites(grid, SPAN, DEPTH, []).length);
  });

  it('drops sites over a protected zone when others remain', () => {
    const grid = gridWithPatch(true);
    const all = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [] });
    const zone = { x: PATCH.lo, z: PATCH.lo, span: 1 };
    const sites = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [zone] });
    expect(all.some(c => c.x === PATCH.lo && c.z === PATCH.lo)).toBe(true);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPatch)).toBe(true);
    expect(sites.some(c => c.x === PATCH.lo && c.z === PATCH.lo)).toBe(false);
  });

  it('without rules, keeps a site off a built ramp\'s keep-out zone, a rectangle, while others remain (#2045)', () => {
    const grid = gridWithPatch(true);
    const all = freshSites(grid, SPAN, DEPTH, []);
    const ramp = { x: PATCH.lo, z: 0, span: 1, spanZ: SIZE };
    const sites = freshSites(grid, SPAN, DEPTH, [], undefined, [ramp]);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThan(all.length);
    expect(sites.every(c => c.x + SPAN <= PATCH.lo || c.x > PATCH.lo)).toBe(true);
    expect(sites.some(c => c.z > PATCH.hi)).toBe(true);
  });

  it('never returns a site over a forbidden zone, even when that leaves none', () => {
    const grid = gridWithPatch(true);
    expect(freshSites(grid, SPAN, DEPTH, [], { protectedZones: [], forbiddenZones: [{ x: 0, z: 0, span: SIZE }] })).toEqual([]);
  });

  it('drops only the sites over a forbidden zone', () => {
    const grid = gridWithPatch(true);
    const all = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [] });
    const zone = { x: PATCH.lo, z: PATCH.lo, span: 1 };
    const sites = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [], forbiddenZones: [zone] });
    expect(all.some(c => c.x === PATCH.lo && c.z === PATCH.lo)).toBe(true);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPatch)).toBe(true);
    expect(sites.some(c => c.x === PATCH.lo && c.z === PATCH.lo)).toBe(false);
  });

  it('falls back to every site when the keep-out zones cover them all', () => {
    const grid = gridWithPatch(true);
    expect(freshSites(grid, SPAN, DEPTH, [], undefined, [{ x: 0, z: 0, span: SIZE }])).toEqual(freshSites(grid, SPAN, DEPTH, []));
  });

  it('falls back to the unprotected worthwhile sites when every one is protected', () => {
    const grid = gridWithPatch(true);
    const all = freshSites(grid, SPAN, DEPTH, [], { protectedZones: [] });
    const everything = { x: 0, z: 0, span: SIZE };
    expect(freshSites(grid, SPAN, DEPTH, [], { protectedZones: [everything] })).toEqual(all);
  });

  it('keeps only the rich patch while it may be shot, the poorer one read as not worth a shot', () => {
    const sites = freshSites(gridWithRichAndPoor(), SPAN, DEPTH, [], { protectedZones: [] });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPatch)).toBe(true);
  });

  it('weighs the sites a shot may take on their own when the rich patch lies in a forbidden zone', () => {
    const forbiddenZones = [{ x: PATCH.lo - SPAN - 1, z: PATCH.lo - SPAN - 1, span: PATCH.hi - PATCH.lo + 2 * SPAN + 3 }];
    const sites = freshSites(gridWithRichAndPoor(), SPAN, DEPTH, [], { protectedZones: [], forbiddenZones });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPoor)).toBe(true);
  });

  it('takes the poorer patch before shooting over a protected building by the rich one', () => {
    const protectedZones = [{ x: PATCH.lo - SPAN - 1, z: PATCH.lo - SPAN - 1, span: PATCH.hi - PATCH.lo + 2 * SPAN + 3 }];
    const sites = freshSites(gridWithRichAndPoor(), SPAN, DEPTH, [], { protectedZones });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(touchesPoor)).toBe(true);
  });
});

/** The probe's reference shot footprint (3x3 holes 4 m apart); the site floors are quoted at this span. */
const REF_SPAN = 8;

/** A square ore patch of `side` columns from `lo`, `depth` layers of density `density` at the surface; the rest barren rock. */
function gridWithSquare(lo: number, side: number, depth: number, density: number): VoxelGrid {
  const grid = new VoxelGrid(SIZE, SIZE);
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < GROUND_TOP; y++) {
        const ore = y >= GROUND_TOP - depth && x >= lo && x < lo + side && z >= lo && z < lo + side ? { cruite_ore: density } : undefined;
        grid.fillVoxel(x, y, z, 1, ore);
      }
    }
  }
  return grid;
}

describe('freshSites minOre (#2126)', () => {
  /** A reference-span site whose whole footprint lies on the patch: (REF_SPAN + 1)^2 columns, DEPTH layers of ore density 1. */
  const FULL_PATCH_ORE = (REF_SPAN + 1) ** 2 * DEPTH;
  const patch = (): VoxelGrid => gridWithSquare(8, REF_SPAN + 1, DEPTH, 1);

  it('keeps only the sites holding at least minOre', () => {
    const sites = freshSites(patch(), REF_SPAN, DEPTH, [], { protectedZones: [], minOre: FULL_PATCH_ORE });
    expect(sites.map(c => [c.x, c.z])).toEqual([[8, 8]]);
  });

  it('never returns a site under the floor, even when that leaves none', () => {
    expect(freshSites(gridWithPatch(false), SPAN, DEPTH, [], { protectedZones: [], minOre: 1 })).toEqual([]);
    expect(freshSites(patch(), REF_SPAN, DEPTH, [], { protectedZones: [], minOre: FULL_PATCH_ORE + 1 })).toEqual([]);
  });

  it('changes nothing at a floor of 0: every site holds at least no ore', () => {
    const grid = gridWithPatch(true);
    expect(freshSites(grid, SPAN, DEPTH, [], { protectedZones: [], minOre: 0 })).toEqual(freshSites(grid, SPAN, DEPTH, [], { protectedZones: [] }));
  });
});

describe('freshSites site floors per footprint area (#2298)', () => {
  const ORE_COLUMN = { x: 10, z: 10 };
  /** One ore column at ORE_COLUMN holding `total` ore summed over `depth` layers. */
  const oneColumn = (total: number, depth: number): VoxelGrid => {
    const grid = new VoxelGrid(SIZE, SIZE);
    for (let x = 0; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) {
        for (let y = 0; y < GROUND_TOP; y++) {
          const ore = y >= GROUND_TOP - depth && x === ORE_COLUMN.x && z === ORE_COLUMN.z ? { cruite_ore: total / depth } : undefined;
          grid.fillVoxel(x, y, z, 1, ore);
        }
      }
    }
    return grid;
  };
  const holdsColumn = (span: number) => (c: { x: number; z: number }): boolean =>
    c.x <= ORE_COLUMN.x && c.x + span >= ORE_COLUMN.x && c.z <= ORE_COLUMN.z && c.z + span >= ORE_COLUMN.z;

  it('finds a site for a 1x1 shot on a single ore column holding under the reference floor', () => {
    const sites = freshSites(oneColumn(0.9, 3), 0, 3, [], { protectedZones: [], minOre: LADDER_SITE_ORE_FLOOR });
    expect(sites.map(c => [c.x, c.z])).toEqual([[ORE_COLUMN.x, ORE_COLUMN.z]]);
  });

  it('finds that site with the site floor alone, no minOre', () => {
    const sites = freshSites(oneColumn(0.9, 3), 0, 3, [], { protectedZones: [] });
    expect(sites.map(c => [c.x, c.z])).toEqual([[ORE_COLUMN.x, ORE_COLUMN.z]]);
  });

  it('scales minOre by footprint area: a floor quoted at the reference span is 81 times lower for a 1x1 shot', () => {
    const ref = (REF_SPAN + 1) ** 2;
    const grid = oneColumn(1.5, 3);
    expect(freshSites(grid, 0, 3, [], { protectedZones: [], minOre: ref }).length).toBe(1);
    expect(freshSites(oneColumn(0.5, 3), 0, 3, [], { protectedZones: [], minOre: ref })).toEqual([]);
  });

  it('scales the site floor: ore far under the reference floor, but over its per-area share, is kept', () => {
    expect(freshSites(oneColumn(0.02, 1), 0, 1, [], { protectedZones: [] }).length).toBe(1);
  });

  it('still drops a 1x1 site holding under the scaled floor while ore remains elsewhere', () => {
    expect(freshSites(oneColumn(0.003, 1), 0, 1, [], { protectedZones: [] })).toEqual([]);
  });

  it('drops 1x1 sites holding exactly no ore while ore remains elsewhere', () => {
    const sites = freshSites(oneColumn(0.9, 3), 0, 3, [], { protectedZones: [] });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(holdsColumn(0))).toBe(true);
  });

  it('keeps every 1x1 site when the whole ground is barren', () => {
    const grid = oneColumn(0, 3);
    const sites = freshSites(grid, 0, 3, [], { protectedZones: [] });
    expect(sites.length).toBe(freshSites(grid, 0, 3, []).length);
    expect(sites.length).toBeGreaterThan(1);
  });

  it('keeps the floor at its reference value at the reference span: a site under it is dropped', () => {
    const grid = oneColumn(0.5, 3);
    const plain = freshSites(grid, REF_SPAN, 3, []);
    expect(plain.some(holdsColumn(REF_SPAN))).toBe(true);
    expect(freshSites(grid, REF_SPAN, 3, [], { protectedZones: [] })).toEqual([]);
  });

  it('keeps a reference-span site holding at least the reference floor', () => {
    const sites = freshSites(oneColumn(1.5, 3), REF_SPAN, 3, [], { protectedZones: [] });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(holdsColumn(REF_SPAN))).toBe(true);
  });

  it('never raises the floor above its reference value for a span larger than the reference', () => {
    const big = REF_SPAN + 4;
    // (13 / 9)^2 is about 2.1: a floor scaled up by area would drop 1.5 ore, the capped reference floor of 1 keeps it.
    const sites = freshSites(oneColumn(1.5, 3), big, 3, [], { protectedZones: [] });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(holdsColumn(big))).toBe(true);
  });

  it('never raises minOre above its reference value for a span larger than the reference', () => {
    const big = REF_SPAN + 4;
    const sites = freshSites(oneColumn(1.5, 3), big, 3, [], { protectedZones: [], minOre: 1 });
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(holdsColumn(big))).toBe(true);
  });

  it('scales the floors by footprint area for every run, campaign levels included (#2301)', () => {
    const grid = oneColumn(0.9, 3);
    expect(freshSites(grid, 0, 3, [], { protectedZones: [] }).length).toBe(1);
    expect(freshSites(grid, 0, 3, [], { protectedZones: [], minOre: 1 }).length).toBe(1);
  });
});
