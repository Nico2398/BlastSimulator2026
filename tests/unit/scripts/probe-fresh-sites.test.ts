// #2062: freshSites skips barren ground while ore remains, keeps ramp corridors clear, and falls back when that leaves nothing.
import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { freshSites } from '../../../scripts/shared/probe-strategies.js';

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
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThan(all.length);
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
});
