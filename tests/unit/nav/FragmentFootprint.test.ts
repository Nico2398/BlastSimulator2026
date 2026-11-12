import { describe, it, expect } from 'vitest';
import { fragmentFootprintCells } from '../../../src/core/nav/FragmentFootprint.js';
import { FRAGMENT_FOOTPRINT_MIN_OVERLAP_M } from '../../../src/core/config/balance.js';

const frag = (x: number, z: number, hx?: number, hz?: number) => ({
  position: { x, z },
  ...(hx === undefined ? {} : { halfExtents: { x: hx, z: hz ?? hx } }),
});
const keys = (cells: Array<{ x: number; z: number }>) => cells.map(c => `${c.x},${c.z}`).sort();

describe('fragmentFootprintCells', () => {
  it('a small rock covers only the cell of its centre', () => {
    expect(fragmentFootprintCells(frag(5.2, 7.1, 0.3))).toEqual([{ x: 5, z: 7 }]);
  });

  it('a rock 10 m wide covers the ten cells it spans along that axis', () => {
    // Spans x 15.5 .. 25.5: exactly cells 16 to 25.
    const cells = fragmentFootprintCells(frag(20.5, 20, 5, 0.3));
    expect(cells).toHaveLength(10);
    expect(new Set(cells.map(c => c.z))).toEqual(new Set([20]));
    expect(Math.min(...cells.map(c => c.x))).toBe(16);
    expect(Math.max(...cells.map(c => c.x))).toBe(25);
  });

  it('covers both axes: a 2 m x 2 m rock centred on a cell corner covers four cells', () => {
    expect(keys(fragmentFootprintCells(frag(10.5, 10.5, 1, 1)))).toEqual(['10,10', '10,11', '11,10', '11,11'].sort());
  });

  it('leaves a neighbouring cell it only grazes free', () => {
    // Reaches half the minimum overlap past cell 5's edges into cells 4 and 6: not enough to occupy them.
    const grazing = fragmentFootprintCells(frag(5, 5, 0.5 + FRAGMENT_FOOTPRINT_MIN_OVERLAP_M / 2, 0.1));
    expect(grazing).toEqual([{ x: 5, z: 5 }]);
    const overlapping = fragmentFootprintCells(frag(5, 5, 0.5 + FRAGMENT_FOOTPRINT_MIN_OVERLAP_M * 2, 0.1));
    expect(keys(overlapping)).toEqual(['4,5', '5,5', '6,5']);
  });

  it('a fragment without half-extents, or with invalid ones, covers its centre cell', () => {
    expect(fragmentFootprintCells(frag(3.4, 8.6))).toEqual([{ x: 3, z: 9 }]);
    expect(fragmentFootprintCells(frag(3.4, 8.6, Number.NaN, -2))).toEqual([{ x: 3, z: 9 }]);
  });
});
