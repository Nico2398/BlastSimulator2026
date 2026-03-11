import { describe, it, expect, beforeEach } from 'vitest';
import { createGridPlan, addHole, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

beforeEach(() => resetHoleIds());

describe('DrillPlan', () => {
  it('createGridPlan creates correct number of holes', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    expect(holes.length).toBe(12);
  });

  it('createGridPlan positions are correct', () => {
    const holes = createGridPlan({ x: 20, z: 25 }, 3, 4, 3, 8, 0.15);
    // First row: (20,25), (23,25), (26,25), (29,25)
    expect(holes[0]!.x).toBe(20);
    expect(holes[0]!.z).toBe(25);
    expect(holes[1]!.x).toBe(23);
    expect(holes[1]!.z).toBe(25);
    // Second row starts at z=28
    expect(holes[4]!.x).toBe(20);
    expect(holes[4]!.z).toBe(28);
  });

  it('grid spacing is correctly applied', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 5, 10, 0.1);
    expect(holes[0]!.x).toBe(0);
    expect(holes[1]!.x).toBe(5);
    expect(holes[2]!.z).toBe(5);
  });

  it('addHole appends a hole with unique ID', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const added = addHole(holes, 10, 15, 6, 0.1);
    expect(holes.length).toBe(2);
    expect(added.id).not.toBe(holes[0]!.id);
    expect(added.x).toBe(10);
    expect(added.z).toBe(15);
    expect(added.depth).toBe(6);
  });
});
