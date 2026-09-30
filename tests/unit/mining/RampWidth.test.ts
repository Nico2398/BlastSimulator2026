// BlastSimulator2026 — Unit tests: ramp width is a per-ramp property (#1298)

import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  defineRampSegments, validateRampOrder, computeRampSegmentDurationTicks,
  type RampDef,
} from '../../../src/core/mining/Ramp.js';
import {
  RAMP_WIDTH_OPTIONS, RAMP_DEFAULT_WIDTH, RAMP_COST_PER_METER_PER_WIDTH, type RampWidth,
} from '../../../src/core/config/balance.js';
import { computeRampCost } from '../../../src/core/mining/Ramp.js';
/** Cost per metre of a default-width ramp. */
const RAMP_COST_PER_METER = computeRampCost(1, RAMP_DEFAULT_WIDTH);

function makeElevatedGrid(sizeX: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++)
      for (let y = 0; y <= surfaceY; y++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

const BASE: RampDef = { originX: 15, originZ: 8, direction: 'south', length: 12, targetDepth: 6 };

function carvedColumns(def: RampDef): Set<string> {
  const grid = makeElevatedGrid(30, 40, 22);
  const cols = new Set<string>();
  for (const seg of defineRampSegments(grid, def)) for (const c of seg.cells) cols.add(`${c.x},${c.z}`);
  return cols;
}

describe('balance: ramp width options', () => {
  it('offers 3, 5 and 7 with 3 as the default', () => {
    expect([...RAMP_WIDTH_OPTIONS]).toEqual([3, 5, 7]);
    expect(RAMP_DEFAULT_WIDTH).toBe(3);
  });

  it('prices the default width at the pre-width flat rate per metre', () => {
    expect(RAMP_COST_PER_METER_PER_WIDTH * RAMP_DEFAULT_WIDTH).toBeCloseTo(RAMP_COST_PER_METER, 6);
  });
});

describe('defineRampSegments — width', () => {
  it.each([3, 5, 7] as RampWidth[])('carves a corridor exactly %i wide, centred on the origin column (south)', (width) => {
    const cols = carvedColumns({ ...BASE, width });
    const half = Math.floor(width / 2);
    const xs = new Set([...cols].map(k => Number(k.split(',')[0])));
    expect(xs.size).toBe(width);
    expect(Math.min(...xs)).toBe(15 - half);
    expect(Math.max(...xs)).toBe(15 + half);
    // every column along the run is cut across the whole width
    for (let z = 8; z < 20; z++) for (let x = 15 - half; x <= 15 + half; x++) expect(cols.has(`${x},${z}`)).toBe(true);
    expect(cols.has(`${15 - half - 1},10`)).toBe(false);
    expect(cols.has(`${15 + half + 1},10`)).toBe(false);
  });

  it.each([5, 7] as RampWidth[])('carves a %i wide corridor centred on the origin row for east ramps', (width) => {
    const cols = carvedColumns({ originX: 8, originZ: 15, direction: 'east', length: 12, targetDepth: 6, width });
    const half = Math.floor(width / 2);
    const zs = new Set([...cols].map(k => Number(k.split(',')[1])));
    expect(zs.size).toBe(width);
    expect(Math.min(...zs)).toBe(15 - half);
    expect(Math.max(...zs)).toBe(15 + half);
  });

  it('treats an omitted width as today\'s 3-wide corridor', () => {
    const omitted = carvedColumns(BASE);
    const explicit = carvedColumns({ ...BASE, width: 3 });
    expect([...omitted].sort()).toEqual([...explicit].sort());
    expect(new Set([...omitted].map(k => k.split(',')[0])).size).toBe(3);
  });

  it('a wider ramp carves strictly more cells in total', () => {
    const grid = makeElevatedGrid(30, 40, 22);
    const total = (w: RampWidth) => defineRampSegments(grid, { ...BASE, width: w }).reduce((n, s) => n + s.cells.length, 0);
    expect(total(5)).toBeGreaterThan(total(3));
    expect(total(7)).toBeGreaterThan(total(5));
  });
});

describe('validateRampOrder — width', () => {
  it.each([3, 5, 7] as RampWidth[])('costs length * width * RAMP_COST_PER_METER_PER_WIDTH at width %i', (width) => {
    const v = validateRampOrder({ ...BASE, width }, Infinity);
    expect(v.success).toBe(true);
    expect(v.cost).toBeCloseTo(BASE.length * width * RAMP_COST_PER_METER_PER_WIDTH, 6);
  });

  it('charges the 3-wide ramp length * RAMP_COST_PER_METER, and the same when width is omitted', () => {
    expect(validateRampOrder({ ...BASE, width: 3 }, Infinity).cost).toBeCloseTo(BASE.length * RAMP_COST_PER_METER, 6);
    expect(validateRampOrder(BASE, Infinity).cost).toBeCloseTo(BASE.length * RAMP_COST_PER_METER, 6);
  });

  it.each([4, 0, 9, NaN, -3, 5.5])('refuses invalid width %s without a cost', (width) => {
    const v = validateRampOrder({ ...BASE, width: width as RampWidth }, Infinity);
    expect(v.success).toBe(false);
    expect(v.cost).toBe(0);
    expect(v.message.length).toBeGreaterThan(0);
  });

  it('refuses a width-7 order the cash cannot cover though the 3-wide order would pass', () => {
    const cost3 = BASE.length * RAMP_COST_PER_METER;
    expect(validateRampOrder({ ...BASE, width: 3 }, cost3 + 1).success).toBe(true);
    expect(validateRampOrder({ ...BASE, width: 7 }, cost3 + 1).success).toBe(false);
  });
});

describe('dig time scales with width', () => {
  it('sums to more ticks at width 7 than width 3', () => {
    const grid = makeElevatedGrid(30, 40, 22);
    const ticks = (w: RampWidth) =>
      defineRampSegments(grid, { ...BASE, width: w }).reduce((n, s) => n + computeRampSegmentDurationTicks(s.cells.length, 1), 0);
    expect(ticks(7)).toBeGreaterThan(ticks(3));
    expect(ticks(5)).toBeGreaterThan(ticks(3));
    expect(ticks(7)).toBeGreaterThan(ticks(5));
  });
});
