// isFootprintFlat() unit tests — the flatness rule the real placement path
// (checkFootprintPlacement) is missing (#1008).
//
// This file used to test the dead canPlaceBuilding/buildPlacementGrid pair in
// BuildingPlacement.ts, which implemented the same flatness rule but was
// never wired into any real placement path. #1008 merges the rule into
// checkFootprintPlacement via isFootprintFlat and deletes the dead pair —
// this file now tests isFootprintFlat directly as the pure function it is.

import { describe, it, expect } from 'vitest';
import { isFootprintFlat, BUILDING_DEFS } from '../../../src/core/entities/Building.js';

describe('isFootprintFlat', () => {

  it('a single-cell footprint is always flat — there is only one height to compare against itself', () => {
    const footprint: Array<[number, number]> = [[0, 0]];
    // heightAt varies wildly with position; irrelevant since only one cell is sampled.
    const heightAt = (cx: number, cz: number): number => cx + cz * 10;

    expect(isFootprintFlat(footprint, 5, 5, heightAt)).toBe(true);
  });

  it('a multi-cell footprint is flat when every cell shares the same height', () => {
    // A 2x2 footprint — every cell samples the same constant height.
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heightAt = (): number => 7;

    expect(isFootprintFlat(footprint, 0, 0, heightAt)).toBe(true);
  });

  it('a multi-cell footprint is not flat when one cell differs from the rest', () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const heights = new Map<string, number>([
      ['0,0', 5], ['1,0', 5], ['0,1', 5], ['1,1', 6], // one cell one unit higher
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;

    expect(isFootprintFlat(footprint, 0, 0, heightAt)).toBe(false);
  });

  it('samples heightAt at the footprint\'s absolute grid position, not at the local dx/dz offsets', () => {
    // A 2-cell footprint at origin (11,8) covers absolute cells (11,8) and (12,8).
    const footprint: Array<[number, number]> = [[0, 0], [1, 0]];
    const heightAt = (cx: number, cz: number): number => (cx === 12 && cz === 8) ? 3 : 4;

    // Origin (10,8) covers (10,8) and (11,8) — both default to 4 → flat.
    expect(isFootprintFlat(footprint, 10, 8, heightAt)).toBe(true);
    // Origin (11,8) covers (11,8)=4 and (12,8)=3 — differ → not flat.
    expect(isFootprintFlat(footprint, 11, 8, heightAt)).toBe(false);
  });

  it('an L-shaped footprint is flat when every cell shares the same height, regardless of cell order', () => {
    const lShape: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [0, 2]];
    const shuffled: Array<[number, number]> = [[0, 2], [0, 0], [0, 1], [1, 0]];
    const heightAt = (): number => 12;

    expect(isFootprintFlat(lShape, 3, 3, heightAt)).toBe(true);
    expect(isFootprintFlat(shuffled, 3, 3, heightAt)).toBe(true);
  });

  it('an L-shaped footprint is not flat when one cell differs, regardless of cell order', () => {
    const heights = new Map<string, number>([
      ['3,3', 2], ['4,3', 2], ['3,4', 2], ['3,5', 9], // last cell of the L differs
    ]);
    const heightAt = (cx: number, cz: number): number => heights.get(`${cx},${cz}`)!;
    const lShape: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [0, 2]];
    const reversed: Array<[number, number]> = [...lShape].reverse();

    expect(isFootprintFlat(lShape, 3, 3, heightAt)).toBe(false);
    expect(isFootprintFlat(reversed, 3, 3, heightAt)).toBe(false);
  });

  it('the 4x4 freight_warehouse footprint is flat on a uniform surface', () => {
    const footprint = BUILDING_DEFS.freight_warehouse[1].footprint;
    const heightAt = (): number => 5;

    expect(isFootprintFlat(footprint, 0, 0, heightAt)).toBe(true);
  });

  it('the 4x4 freight_warehouse footprint is not flat when a single cell steps up', () => {
    const footprint = BUILDING_DEFS.freight_warehouse[1].footprint;
    const heightAt = (cx: number, cz: number): number => (cx === 3 && cz === 3) ? 6 : 5;

    expect(isFootprintFlat(footprint, 0, 0, heightAt)).toBe(false);
  });

  it('an empty footprint is trivially flat — there are no cells to disagree', () => {
    expect(isFootprintFlat([], 0, 0, () => 5)).toBe(true);
  });

});
