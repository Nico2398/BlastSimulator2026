import { describe, it, expect } from 'vitest';
import { projectionZoneColumns } from '../../../src/core/mining/ProjectionZones.js';
import { previewProjections } from '../../../src/core/mining/Software.js';
import { makeTestPlan } from './softwareTestFixtures.js';

describe('projectionZoneColumns (#2201)', () => {
  it('maps no positions to no columns', () => {
    expect(projectionZoneColumns([])).toEqual([]);
  });

  it('drops the height: a voxel becomes its ground column', () => {
    expect(projectionZoneColumns([{ x: 4, y: 9, z: 7 }])).toEqual([{ x: 4, z: 7 }]);
  });

  it('merges voxels stacked in one column into one entry', () => {
    const columns = projectionZoneColumns([
      { x: 3, y: 1, z: 3 }, { x: 3, y: 2, z: 3 }, { x: 3, y: 8, z: 3 },
    ]);
    expect(columns).toEqual([{ x: 3, z: 3 }]);
  });

  it('returns each column once, sorted by x then z', () => {
    const columns = projectionZoneColumns([
      { x: 5, y: 0, z: 2 },
      { x: 1, y: 3, z: 9 },
      { x: 5, y: 1, z: 1 },
      { x: 1, y: 2, z: 4 },
      { x: 5, y: 7, z: 2 },
      { x: 1, y: 6, z: 9 },
    ]);
    expect(columns).toEqual([
      { x: 1, z: 4 }, { x: 1, z: 9 }, { x: 5, z: 1 }, { x: 5, z: 2 },
    ]);
  });

  it('sorts numerically, not as text', () => {
    const columns = projectionZoneColumns([
      { x: 10, y: 0, z: 2 }, { x: 2, y: 0, z: 10 }, { x: 2, y: 0, z: 9 },
    ]);
    expect(columns).toEqual([{ x: 2, z: 9 }, { x: 2, z: 10 }, { x: 10, z: 2 }]);
  });

  it('keeps columns that share only x or only z apart', () => {
    const columns = projectionZoneColumns([
      { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 1 }, { x: 1, y: 0, z: 1 },
    ]);
    expect(columns).toHaveLength(3);
  });

  it('gives the same columns whatever the order of the input', () => {
    const positions = [
      { x: 6, y: 1, z: 3 }, { x: 2, y: 5, z: 8 }, { x: 6, y: 2, z: 1 }, { x: 2, y: 4, z: 8 },
    ];
    expect(projectionZoneColumns([...positions].reverse())).toEqual(projectionZoneColumns(positions));
  });

  it('does not change the positions it is given', () => {
    const positions = [{ x: 3, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }];
    const copy = positions.map(p => ({ ...p }));
    projectionZoneColumns(positions);
    expect(positions).toEqual(copy);
  });

  it('turns a real projection preview into one column per distinct (x, z)', () => {
    const { grid, plan } = makeTestPlan();
    const preview = previewProjections(plan, grid, 2)!;
    const columns = projectionZoneColumns(preview.projectionZonePositions);
    const distinct = new Set(preview.projectionZonePositions.map(p => `${p.x},${p.z}`));
    expect(columns).toHaveLength(distinct.size);
    expect(new Set(columns.map(c => `${c.x},${c.z}`)).size).toBe(columns.length);
  });
});
