// BlastSimulator2026 — Unit tests: pickReachableColumn (#1719, moved from pickLevelWorkTarget #1723)

import { describe, it, expect, vi } from 'vitest';
import { pickReachableColumn } from '../../../src/core/mining/WorkTarget.js';

const rect = { minX: 10, maxX: 14, minZ: 20, maxZ: 24 };
const all = (): { x: number; z: number }[] => {
  const cols: { x: number; z: number }[] = [];
  for (let z = rect.minZ; z <= rect.maxZ; z++) for (let x = rect.minX; x <= rect.maxX; x++) cols.push({ x, z });
  return cols;
};
const corner = { x: rect.minX, z: rect.minZ };

describe('pickReachableColumn', () => {
  it('returns the anchor column when every column is reachable', () => {
    expect(pickReachableColumn(all(), corner, () => true)).toEqual({ x: 10, z: 20 });
  });

  it('returns the reachable column nearest the anchor when the anchor is not reachable', () => {
    const reachable = (x: number, z: number) => x >= 12 && z >= 22;
    expect(pickReachableColumn(all(), corner, reachable)).toEqual({ x: 12, z: 22 });
  });

  it('measures nearness to an anchor that is not a column corner', () => {
    const centre = { x: 12, z: 22 };
    const reachable = (x: number) => x >= 13;
    expect(pickReachableColumn(all(), centre, reachable)).toEqual({ x: 13, z: 22 });
  });

  it('ignores reachable columns that are not in the columns list', () => {
    const columns = all().filter(c => c.x !== 10 || c.z !== 20);
    const target = pickReachableColumn(columns, corner, () => true);
    expect(target).not.toEqual({ x: 10, z: 20 });
    expect(target).not.toBeNull();
  });

  it('breaks distance ties by list order (first listed wins)', () => {
    const columns = [{ x: 4, z: 0 }, { x: 0, z: 4 }, { x: -4, z: 0 }];
    const anchor = { x: 0, z: 0 };
    expect(pickReachableColumn(columns, anchor, () => true)).toEqual({ x: 4, z: 0 });
    expect(pickReachableColumn([...columns].reverse(), anchor, () => true)).toEqual({ x: -4, z: 0 });
  });

  it('returns null when no column is reachable', () => {
    expect(pickReachableColumn(all(), corner, () => false)).toBeNull();
  });

  it('returns null for an empty column list and never asks reachability', () => {
    const isReachable = vi.fn(() => true);
    expect(pickReachableColumn([], corner, isReachable)).toBeNull();
    expect(isReachable).not.toHaveBeenCalled();
  });

  it('does not mutate the columns list', () => {
    const columns = all();
    const copy = columns.map(c => ({ ...c }));
    pickReachableColumn(columns, corner, (x, z) => x > z);
    expect(columns).toEqual(copy);
  });
});
