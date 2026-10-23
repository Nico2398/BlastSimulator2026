// BlastSimulator2026 — CraterAccess unit tests (#2082)
// Hand-built height fields stand in for the terrain: level ground with a square pit sunk into it.

import { describe, it, expect } from 'vitest';
import {
  clusterStrandedFloors, planCraterAccess, type AccessSurface, type StrandedFloor,
} from '../../../src/core/mining/CraterAccess.js';
import { rampPathCells, rampPathOf } from '../../../src/core/mining/RampPath.js';
import {
  MAX_RAMP_LENGTH, NAV_MAX_SLOPE_RATIO, RAMP_CRATER_MIN_DROP_M, RAMP_FLOOR_SNAP_REACH_M,
} from '../../../src/core/config/balance.js';

interface Pit { x0: number; z0: number; w: number; h: number; depth: number }

const AREA = { min: 0, max: 80 };
const PIT: Pit = { x0: 25, z0: 25, w: 30, h: 30, depth: 14 };

function inPit(pit: Pit, x: number, z: number): boolean {
  return x >= pit.x0 && x < pit.x0 + pit.w && z >= pit.z0 && z < pit.z0 + pit.h;
}

/** Level ground at 0, `pit` sunk below it. `reachable` decides which cells the vehicle network already touches. */
function surface(pit: Pit, reachable: (x: number, z: number) => boolean): AccessSurface {
  return {
    heightAt: (x, z) => (inPit(pit, x, z) ? -pit.depth : 0),
    contains: (x, z) => x >= AREA.min && x < AREA.max && z >= AREA.min && z < AREA.max,
    reachableFrom: reachable,
  };
}

/** Everything outside the pit is on the network (an existing road across the surface). */
const outsidePit = (pit: Pit) => (x: number, z: number) => !inPit(pit, x, z);

const MAX_RATIO = NAV_MAX_SLOPE_RATIO;
const centreFloor = (pit: Pit, orderCount = 5): StrandedFloor => ({
  x: pit.x0 + pit.w / 2, z: pit.z0 + pit.h / 2, floorY: -pit.depth, orderCount,
});

describe('clusterStrandedFloors', () => {
  it('returns no floors for no cells', () => {
    expect(clusterStrandedFloors([], 3)).toEqual([]);
  });

  it('groups cells of one connected pit into a single floor with the right order count', () => {
    const cells = [{ x: 10, z: 10, y: -8 }, { x: 11, z: 10, y: -8 }, { x: 12, z: 11, y: -8 }, { x: 11, z: 12, y: -8 }];
    const floors = clusterStrandedFloors(cells, 2);
    expect(floors).toHaveLength(1);
    expect(floors[0]!.orderCount).toBe(4);
    expect(floors[0]!.floorY).toBeCloseTo(-8, 5);
  });

  it('keeps two far-apart pits as two floors, each counting its own cells', () => {
    const near = [{ x: 10, z: 10, y: -8 }, { x: 11, z: 10, y: -8 }, { x: 10, z: 11, y: -8 }];
    const far = [{ x: 60, z: 60, y: -12 }, { x: 61, z: 60, y: -12 }];
    const floors = clusterStrandedFloors([...near, ...far], 2);
    expect(floors).toHaveLength(2);
    const byDepth = [...floors].sort((a, b) => b.floorY - a.floorY);
    expect(byDepth[0]!.orderCount).toBe(3);
    expect(byDepth[0]!.floorY).toBeCloseTo(-8, 5);
    expect(byDepth[1]!.orderCount).toBe(2);
    expect(byDepth[1]!.floorY).toBeCloseTo(-12, 5);
  });

  it('reports a floor position inside the cluster it summarises', () => {
    const [floor] = clusterStrandedFloors([{ x: 10, z: 10, y: -8 }, { x: 14, z: 10, y: -8 }, { x: 12, z: 12, y: -8 }], 4);
    expect(floor!.x).toBeGreaterThanOrEqual(10);
    expect(floor!.x).toBeLessThanOrEqual(14);
    expect(floor!.z).toBeGreaterThanOrEqual(10);
    expect(floor!.z).toBeLessThanOrEqual(12);
  });

  it('counts a single isolated cell as a floor of one order', () => {
    const floors = clusterStrandedFloors([{ x: 5, z: 5, y: -3 }], 2);
    expect(floors).toHaveLength(1);
    expect(floors[0]!.orderCount).toBe(1);
  });

  it('joins cells exactly one gap apart and splits cells just beyond it', () => {
    expect(clusterStrandedFloors([{ x: 0, z: 0, y: -4 }, { x: 3, z: 0, y: -4 }], 3)).toHaveLength(1);
    expect(clusterStrandedFloors([{ x: 0, z: 0, y: -4 }, { x: 4, z: 0, y: -4 }], 3)).toHaveLength(2);
  });
});

describe('planCraterAccess', () => {
  it('plans a ramp from the reachable network down to the floor within the grade limit', () => {
    const plan = planCraterAccess(centreFloor(PIT), surface(PIT, outsidePit(PIT)), MAX_RATIO, 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const limitDegrees = (Math.atan(MAX_RATIO) * 180) / Math.PI;
    expect(plan.gradeDegrees).toBeGreaterThan(0);
    expect(plan.gradeDegrees).toBeLessThanOrEqual(limitDegrees);
    expect(plan.cost).toBeGreaterThan(0);
  });

  it('honours a gentler climb ratio than the nav limit', () => {
    const gentle = MAX_RATIO * 0.5;
    const plan = planCraterAccess(centreFloor(PIT), surface(PIT, outsidePit(PIT)), gentle, 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.gradeDegrees).toBeLessThanOrEqual((Math.atan(gentle) * 180) / Math.PI + 1e-9);
  });

  it('starts on a cell the network already reaches and ends within snap reach of the floor', () => {
    const s = surface(PIT, outsidePit(PIT));
    const plan = planCraterAccess(centreFloor(PIT), s, MAX_RATIO, 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const cells = rampPathCells(rampPathOf(plan.def), 3);
    expect(cells.length).toBeGreaterThan(1);
    const first = cells[0]!;
    const last = cells[cells.length - 1]!;
    expect(s.reachableFrom(first.x, first.z)).toBe(true);
    expect(Math.abs(s.heightAt(last.x, last.z) - -PIT.depth)).toBeLessThanOrEqual(RAMP_FLOOR_SNAP_REACH_M);
  });

  it('never exceeds the longest ramp the game accepts', () => {
    const plan = planCraterAccess(centreFloor(PIT), surface(PIT, outsidePit(PIT)), MAX_RATIO, 3);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.def.length).toBeLessThanOrEqual(MAX_RAMP_LENGTH);
  });

  it('can start at the foot of a ramp that is already built', () => {
    // Only a ledge half way down the wall is on the network, as after an earlier, too-short ramp.
    const ledge = (x: number, z: number) => x >= 25 && x < 33 && z >= 38 && z < 42;
    const base = surface(PIT, ledge);
    const s: AccessSurface = { ...base, heightAt: (x, z) => (ledge(x, z) ? -6 : base.heightAt(x, z)) };
    const plan = planCraterAccess({ x: 45, z: 40, floorY: -PIT.depth, orderCount: 5 }, s, MAX_RATIO, 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const first = rampPathCells(rampPathOf(plan.def), 3)[0]!;
    expect(ledge(first.x, first.z)).toBe(true);
  });

  it('refuses with a reason key when no network cell lies within the longest ramp', () => {
    const plan = planCraterAccess(centreFloor(PIT), surface(PIT, () => false), MAX_RATIO, 3);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasonKey.length).toBeGreaterThan(0);
  });

  it('refuses a floor shallower than the crater drop', () => {
    const shallow: Pit = { ...PIT, depth: RAMP_CRATER_MIN_DROP_M - 1 };
    const plan = planCraterAccess(centreFloor(shallow), surface(shallow, outsidePit(shallow)), MAX_RATIO, 3);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasonKey.length).toBeGreaterThan(0);
  });

  it('refuses when the only network cell is farther than the longest ramp', () => {
    const farOnly = (x: number, z: number) => x === 0 && z === 0;
    const plan = planCraterAccess({ x: 5000, z: 5000, floorY: -20, orderCount: 5 }, { ...surface(PIT, farOnly), contains: () => true, heightAt: (x, z) => (x === 0 && z === 0 ? 0 : -20) }, MAX_RATIO, 3);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reasonKey.length).toBeGreaterThan(0);
  });

  it('never throws on degenerate input', () => {
    const s = surface(PIT, outsidePit(PIT));
    for (const floor of [
      { x: -50, z: -50, floorY: -14, orderCount: 0 },
      { x: 40, z: 40, floorY: Number.NaN, orderCount: 1 },
      { x: 1e9, z: 1e9, floorY: -100, orderCount: 1 },
    ]) {
      expect(() => planCraterAccess(floor, s, MAX_RATIO, 3)).not.toThrow();
    }
    expect(() => planCraterAccess(centreFloor(PIT), s, 0, 3)).not.toThrow();
  });

  it('always yields a reason key on failure and a def on success', () => {
    for (const depth of [0, 1, 2, 5, 14, 40]) {
      const pit: Pit = { ...PIT, depth };
      const plan = planCraterAccess(centreFloor(pit), surface(pit, outsidePit(pit)), MAX_RATIO, 3);
      if (plan.ok) expect(plan.def.length).toBeGreaterThan(0);
      else expect(plan.reasonKey.length).toBeGreaterThan(0);
    }
  });
});
