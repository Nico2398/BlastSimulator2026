// BlastSimulator2026 — Unit tests: multi-leg ramp path geometry (#1939)

import { describe, it, expect } from 'vitest';
import {
  legsFromWaypoints, rampLegsOf, rampTotalLength, rampCenterline, rampPathCells, rampFootprintRects,
  rampBoundingFootprint, rampWaypoints, findRampPathFault, firstOccupiedPathTile,
  type RampPathSpec,
} from '../../../src/core/mining/RampPath.js';

const L_PATH: RampPathSpec = {
  originX: 30, originZ: 20,
  legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }],
};

const key = (c: { x: number; z: number }) => `${c.x},${c.z}`;

describe('legsFromWaypoints', () => {
  it('turns an L of waypoints into origin and two cardinal legs', () => {
    const r = legsFromWaypoints([{ x: 30, z: 20 }, { x: 30, z: 32 }, { x: 40, z: 32 }]);
    expect(r).toEqual({ success: true, originX: 30, originZ: 20, legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }] });
  });

  it('two waypoints give a single leg', () => {
    const r = legsFromWaypoints([{ x: 5, z: 20 }, { x: 5, z: 8 }]);
    expect(r).toEqual({ success: true, originX: 5, originZ: 20, legs: [{ direction: 'north', length: 12 }] });
  });

  it('handles west and north legs', () => {
    const r = legsFromWaypoints([{ x: 20, z: 20 }, { x: 10, z: 20 }, { x: 10, z: 12 }]);
    expect(r).toMatchObject({ success: true, legs: [{ direction: 'west', length: 10 }, { direction: 'north', length: 8 }] });
  });

  it('merges collinear same-direction legs into one', () => {
    const r = legsFromWaypoints([{ x: 0, z: 0 }, { x: 0, z: 5 }, { x: 0, z: 9 }, { x: 6, z: 9 }]);
    expect(r).toMatchObject({ success: true, legs: [{ direction: 'south', length: 9 }, { direction: 'east', length: 6 }] });
  });

  it('refuses a diagonal leg with the not-cardinal reason', () => {
    const r = legsFromWaypoints([{ x: 0, z: 0 }, { x: 5, z: 5 }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.reasonKey).toBe('mining.build_ramp.leg_not_cardinal');
  });

  it('refuses a zero-length leg', () => {
    const r = legsFromWaypoints([{ x: 3, z: 3 }, { x: 3, z: 3 }]);
    expect(r.success).toBe(false);
  });

  it('refuses fewer than two waypoints', () => {
    expect(legsFromWaypoints([{ x: 3, z: 3 }]).success).toBe(false);
    expect(legsFromWaypoints([]).success).toBe(false);
  });
});

describe('rampLegsOf / rampTotalLength', () => {
  it('a def without legs is one leg of its direction and length', () => {
    expect(rampLegsOf({ direction: 'east', length: 9 })).toEqual([{ direction: 'east', length: 9 }]);
  });

  it('a def with legs returns them in order', () => {
    expect(rampLegsOf({ direction: 'south', length: 22, legs: L_PATH.legs })).toEqual(L_PATH.legs);
  });

  it('total length is the sum of the legs', () => {
    expect(rampTotalLength(L_PATH.legs)).toBe(22);
    expect(rampTotalLength([{ direction: 'north', length: 4 }])).toBe(4);
  });
});

describe('rampCenterline', () => {
  it('runs from the origin to the last waypoint exclusive, one tile per metre', () => {
    const line = rampCenterline(L_PATH);
    expect(line).toHaveLength(22);
    expect(line[0]).toMatchObject({ x: 30, z: 20, legIndex: 0 });
    expect(line[11]).toMatchObject({ x: 30, z: 31, legIndex: 0 });
    expect(line[12]).toMatchObject({ x: 30, z: 32, legIndex: 1 });
    expect(line[21]).toMatchObject({ x: 39, z: 32, legIndex: 1 });
    expect(line.some(c => c.x === 40 && c.z === 32)).toBe(false);
  });

  it('a single leg matches the straight ramp tiles', () => {
    const line = rampCenterline({ originX: 5, originZ: 5, legs: [{ direction: 'west', length: 3 }] });
    expect(line.map(key)).toEqual(['5,5', '4,5', '3,5']);
  });
});

describe('rampPathCells', () => {
  it('emits no tile twice', () => {
    for (const width of [3, 5, 7] as const) {
      const cells = rampPathCells(L_PATH, width);
      expect(new Set(cells.map(key)).size).toBe(cells.length);
    }
  });

  it('a straight leg covers length x width tiles', () => {
    const cells = rampPathCells({ originX: 10, originZ: 10, legs: [{ direction: 'south', length: 8 }] }, 5);
    expect(cells).toHaveLength(40);
  });

  it('covers a width x width landing square centred on the interior waypoint', () => {
    const set = new Set(rampPathCells(L_PATH, 5).map(key));
    for (let x = 28; x <= 32; x++) for (let z = 30; z <= 34; z++) expect(set.has(`${x},${z}`)).toBe(true);
  });

  it('leaves the empty inside corner of the L uncovered', () => {
    const set = new Set(rampPathCells(L_PATH, 3).map(key));
    expect(set.has('40,20')).toBe(false);
    expect(set.has('38,22')).toBe(false);
  });

  it('every cell carries a step within the centreline and a lateral within half-width', () => {
    for (const c of rampPathCells(L_PATH, 5)) {
      expect(c.step).toBeGreaterThanOrEqual(0);
      expect(c.step).toBeLessThan(22);
      expect(Math.abs(c.lateral)).toBeLessThanOrEqual(2);
      expect([0, 1]).toContain(c.legIndex);
    }
  });

  it('every centreline tile appears with lateral 0', () => {
    const centre = new Set(rampPathCells(L_PATH, 3).filter(c => c.lateral === 0).map(key));
    for (const c of rampCenterline(L_PATH)) expect(centre.has(key(c))).toBe(true);
  });

  it.each([3, 5] as const)('adjacent tiles at width %i differ by at most sqrt(2) steps per metre (corner inside smoothed)', (width) => {
    const cells = rampPathCells(L_PATH, width);
    const byKey = new Map(cells.map(c => [key(c), c]));
    for (const c of cells) {
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        const n = byKey.get(`${c.x + dx},${c.z + dz}`);
        if (n) expect(Math.abs(n.step - c.step) / Math.hypot(dx, dz)).toBeLessThanOrEqual(Math.SQRT2 + 1e-6);
      }
    }
  });
});

describe('footprints and waypoints', () => {
  it('bounding footprint spans every cell', () => {
    const f = rampBoundingFootprint(L_PATH, 3);
    expect(f).toEqual({ minX: 29, maxX: 39, minZ: 20, maxZ: 33 });
  });

  it('one rectangle per leg, together covering every cell', () => {
    const rects = rampFootprintRects(L_PATH, 3);
    expect(rects).toHaveLength(2);
    for (const c of rampPathCells(L_PATH, 3)) {
      expect(rects.some(r => c.x >= r.minX && c.x <= r.maxX && c.z >= r.minZ && c.z <= r.maxZ)).toBe(true);
    }
  });

  it('a single-leg bounding footprint is the straight ramp rectangle', () => {
    const f = rampBoundingFootprint({ originX: 10, originZ: 5, legs: [{ direction: 'south', length: 12 }] }, 3);
    expect(f).toEqual({ minX: 9, maxX: 11, minZ: 5, maxZ: 16 });
  });

  it('waypoints are the origin plus each leg end', () => {
    expect(rampWaypoints(L_PATH)).toEqual([{ x: 30, z: 20 }, { x: 30, z: 32 }, { x: 40, z: 32 }]);
  });
});

describe('findRampPathFault', () => {
  it('accepts a clean L', () => {
    expect(findRampPathFault(L_PATH, 3)).toBeNull();
  });

  it('flags a leg shorter than the width', () => {
    const path: RampPathSpec = { originX: 10, originZ: 10, legs: [{ direction: 'south', length: 8 }, { direction: 'east', length: 4 }] };
    expect(findRampPathFault(path, 5)?.key).toBe('mining.build_ramp.leg_too_short');
    expect(findRampPathFault(path, 3)).toBeNull();
  });

  it('a leg exactly as long as the width is allowed', () => {
    const path: RampPathSpec = { originX: 10, originZ: 10, legs: [{ direction: 'south', length: 5 }, { direction: 'east', length: 5 }] };
    expect(findRampPathFault(path, 5)).toBeNull();
  });

  it('flags a path that crosses itself', () => {
    const path: RampPathSpec = {
      originX: 10, originZ: 10,
      legs: [{ direction: 'east', length: 10 }, { direction: 'south', length: 6 }, { direction: 'west', length: 10 }, { direction: 'north', length: 10 }],
    };
    expect(findRampPathFault(path, 3)?.key).toBe('mining.build_ramp.legs_cross');
  });

  it('flags a 180 degree reversal', () => {
    const path: RampPathSpec = { originX: 10, originZ: 10, legs: [{ direction: 'east', length: 8 }, { direction: 'west', length: 8 }] };
    expect(findRampPathFault(path, 3)?.key).toBe('mining.build_ramp.legs_cross');
  });

  it('a switchback with room between the legs is fine', () => {
    const path: RampPathSpec = {
      originX: 10, originZ: 10,
      legs: [{ direction: 'east', length: 10 }, { direction: 'south', length: 8 }, { direction: 'west', length: 10 }],
    };
    expect(findRampPathFault(path, 3)).toBeNull();
  });
});

describe('firstOccupiedPathTile', () => {
  const cells = rampPathCells(L_PATH, 3);

  it('returns null when nothing is occupied', () => {
    expect(firstOccupiedPathTile(cells, () => false)).toBeNull();
  });

  it('returns the first cell the predicate holds for', () => {
    const hit = firstOccupiedPathTile(cells, (x, z) => x === 30 && z === 32);
    expect(hit).toMatchObject({ x: 30, z: 32 });
  });

  it('is null for an empty cell list', () => {
    expect(firstOccupiedPathTile([], () => true)).toBeNull();
  });
});
