// footprintHeightSpread() / isFootprintBuildable() unit tests — the ground-
// levelness rule the real placement path (checkFootprintPlacement) applies
// (#1008).
//
// This file used to test the dead canPlaceBuilding/buildPlacementGrid pair in
// BuildingPlacement.ts, which implemented the same rule but was never wired
// into any real placement path. #1008 merged the rule into
// checkFootprintPlacement and deleted the dead pair; its refinement replaced
// the strict "every cell at the same height" predicate with a spread measure
// plus a tolerance, because demanding a perfectly level footprint on terrain
// that grades one level per tile made siting a building tedious. Renamed from
// CanPlaceBuilding.test.ts, which named a function that no longer exists.

import { describe, it, expect } from 'vitest';
import {
  footprintHeightSpread, isFootprintBuildable, BUILDING_DEFS,
} from '../../../src/core/entities/Building.js';
import { BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../../src/core/config/balance.js';

describe('footprintHeightSpread', () => {

  it('a single-cell footprint spreads 0 — there is only one height to compare against itself', () => {
    const footprint: Array<[number, number]> = [[0, 0]];
    // heightAt varies wildly with position; irrelevant since only one cell is sampled.
    const heightAt = (cx: number, cz: number): number => cx + cz * 10;

    expect(footprintHeightSpread(footprint, 5, 5, heightAt)).toBe(0);
  });

  it('spreads 0 when every cell of a multi-cell footprint shares the same height', () => {
    // A 2x2 footprint — every cell samples the same constant height.
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heightAt = (): number => 7;

    expect(footprintHeightSpread(footprint, 0, 0, heightAt)).toBe(0);
  });

  it('reports the highest-to-lowest difference, not merely that cells differ', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heights = new Map<string, number>([
      ['0,0', 5], ['1,0', 8], ['0,1', 6], ['1,1', 4], // min 4, max 8
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;

    expect(footprintHeightSpread(footprint, 0, 0, heightAt)).toBe(4);
  });

  it('samples heightAt at the footprint\'s absolute grid position, not at the local dx/dz offsets', () => {
    // A 2-cell footprint at origin (11,8) covers absolute cells (11,8) and (12,8).
    const footprint: Array<[number, number]> = [[0, 0], [1, 0]];
    const heightAt = (cx: number, cz: number): number => (cx === 12 && cz === 8) ? 3 : 4;

    // Origin (10,8) covers (10,8) and (11,8) — both default to 4 → level.
    expect(footprintHeightSpread(footprint, 10, 8, heightAt)).toBe(0);
    // Origin (11,8) covers (11,8)=4 and (12,8)=3 — one level apart.
    expect(footprintHeightSpread(footprint, 11, 8, heightAt)).toBe(1);
  });

  it('is independent of the order the footprint lists its cells in', () => {
    const heights = new Map<string, number>([
      ['3,3', 2], ['4,3', 2], ['3,4', 2], ['3,5', 9], // last cell of the L differs
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;
    const lShape: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [0, 2]];
    const reversed: Array<[number, number]> = [...lShape].reverse();

    expect(footprintHeightSpread(lShape, 3, 3, heightAt)).toBe(7);
    expect(footprintHeightSpread(reversed, 3, 3, heightAt)).toBe(7);
  });

  it('an empty footprint spreads 0 — it covers no ground at all', () => {
    expect(footprintHeightSpread([], 0, 0, () => 5)).toBe(0);
  });

});

describe('isFootprintBuildable', () => {

  it('accepts perfectly level ground', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];

    expect(isFootprintBuildable(footprint, 0, 0, () => 7)).toBe(true);
  });

  it('accepts a footprint straddling a single voxel step — the tolerance a player gets', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heights = new Map<string, number>([
      ['0,0', 5], ['1,0', 5], ['0,1', 5], ['1,1', 6], // one cell one level higher
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;

    expect(isFootprintBuildable(footprint, 0, 0, heightAt)).toBe(true);
  });

  it('refuses a footprint straddling two voxel steps — a slope, not a grade', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heights = new Map<string, number>([
      ['0,0', 5], ['1,0', 5], ['0,1', 6], ['1,1', 7],
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;

    expect(isFootprintBuildable(footprint, 0, 0, heightAt)).toBe(false);
  });

  it('takes the tolerance from BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD by default', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0]];
    const atTolerance = (cx: number): number => cx === 1 ? BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD : 0;
    const overTolerance = (cx: number): number => cx === 1 ? BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD + 1 : 0;

    expect(isFootprintBuildable(footprint, 0, 0, atTolerance)).toBe(true);
    expect(isFootprintBuildable(footprint, 0, 0, overTolerance)).toBe(false);
  });

  it('honours an explicit maxSpread over the configured default', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0]];
    const heightAt = (cx: number): number => cx === 1 ? 3 : 0;

    expect(isFootprintBuildable(footprint, 0, 0, heightAt, 3)).toBe(true);
    expect(isFootprintBuildable(footprint, 0, 0, heightAt, 2)).toBe(false);
    // maxSpread 0 is the strict rule #1008 originally shipped.
    expect(isFootprintBuildable(footprint, 0, 0, () => 4, 0)).toBe(true);
    expect(isFootprintBuildable(footprint, 0, 0, heightAt, 0)).toBe(false);
  });

  it('the 4x4 freight_warehouse footprint is buildable on a uniform surface', () => {
    const footprint = BUILDING_DEFS.freight_warehouse[1].footprint;

    expect(isFootprintBuildable(footprint, 0, 0, () => 5)).toBe(true);
  });

  it('the 4x4 freight_warehouse footprint is refused when a single cell steps up two levels', () => {
    const footprint = BUILDING_DEFS.freight_warehouse[1].footprint;
    const heightAt = (cx: number, cz: number): number => (cx === 3 && cz === 3) ? 7 : 5;

    expect(isFootprintBuildable(footprint, 0, 0, heightAt)).toBe(false);
  });

  it('an empty footprint is trivially buildable — there are no cells to disagree', () => {
    expect(isFootprintBuildable([], 0, 0, () => 5)).toBe(true);
  });

});
