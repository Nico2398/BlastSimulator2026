// BlastSimulator2026 — CraterAccess planner on realistic limit-shot craters (#2086)
// Height fields shaped like the pits a grade 2-3 limit-sized shot leaves on the 64 m map: wide, walled, uneven, nested.

import { describe, it, expect } from 'vitest';
import { planCraterAccess, type AccessSurface, type StrandedFloor } from '../../../src/core/mining/CraterAccess.js';
import { MAX_RAMP_LENGTH, RAMP_DEFAULT_WIDTH, RAMP_FLOOR_SNAP_REACH_M } from '../../../src/core/config/balance.js';
import { VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';

const SITE = 64;

/** Height field: ground 0 plus any number of boxes (inclusive x0..x1, z0..z1) sunk to `y`; later boxes override earlier ones. */
interface Box { x0: number; x1: number; z0: number; z1: number; y: number }
const inBox = (b: Box, x: number, z: number) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
const heightOf = (boxes: readonly Box[]) => (x: number, z: number): number => {
  let y = 0;
  for (const b of boxes) if (inBox(b, x, z)) y = b.y;
  return y;
};

function surface(boxes: readonly Box[], reachable: (x: number, z: number, h: number) => boolean): AccessSurface {
  const heightAt = heightOf(boxes);
  return {
    heightAt,
    contains: (x, z) => x >= 0 && x < SITE && z >= 0 && z < SITE,
    reachableFrom: (x, z) => reachable(x, z, heightAt(x, z)),
  };
}

/** The network reaches every cell at or above `level` (the surface and any ramp already dug down to it). */
const reachesDownTo = (level: number) => (_x: number, _z: number, h: number) => h >= level;

const ratio = () => VEHICLE_MAX_SLOPE_RATIO;
const plan = (floor: StrandedFloor, s: AccessSurface, built: Parameters<typeof planCraterAccess>[5] = []) =>
  planCraterAccess(floor, s, ratio(), RAMP_DEFAULT_WIDTH, [], built);

describe('planCraterAccess on wide limit-shot craters (#2086)', () => {
  // A 6x6 limit shot at 4 m spacing clears a crater ~28 cells across; its rubble strands the floor centre.
  const WIDE: Box = { x0: 18, x1: 46, z0: 18, z1: 46, y: -10 };
  const wideFloor = (): StrandedFloor => ({ x: 32, z: 32, floorY: -10, orderCount: 400 });

  it('plans a ramp that ends at the pit floor depth, within the longest ramp, in the middle of a 29-cell-wide pit', () => {
    const s = surface([WIDE], reachesDownTo(0));
    const p = plan(wideFloor(), s);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(Math.abs(p.def.targetDepth - 10)).toBeLessThanOrEqual(RAMP_FLOOR_SNAP_REACH_M);
      expect(p.def.length).toBeLessThanOrEqual(MAX_RAMP_LENGTH);
    }
  });

  it('plans for a floor stranded in a corner of the wide pit as well as its centre', () => {
    const s = surface([WIDE], reachesDownTo(0));
    for (const [x, z] of [[20, 20], [44, 44], [20, 44], [44, 20], [32, 20]] as const) {
      expect(plan({ x, z, floorY: -10, orderCount: 50 }, s).ok, `floor at ${x},${z}`).toBe(true);
    }
  });

  it('plans down a pit 12 m deep, deeper than a straight run from the centre fits on the site', () => {
    const deep: Box = { ...WIDE, y: -12 };
    const s = surface([deep], reachesDownTo(0));
    expect(plan({ x: 32, z: 32, floorY: -12, orderCount: 400 }, s).ok).toBe(true);
  });

  it('plans for a pit spanning nearly the whole 64 m site', () => {
    const huge: Box = { x0: 6, x1: 57, z0: 6, z1: 57, y: -9 };
    const s = surface([huge], reachesDownTo(0));
    expect(plan({ x: 32, z: 32, floorY: -9, orderCount: 900 }, s).ok).toBe(true);
  });
});

describe('planCraterAccess on uneven floors (#2086)', () => {
  const WIDE: Box = { x0: 18, x1: 46, z0: 18, z1: 46, y: -10 };
  // Blast rubble heaps leave the floor a few metres uneven: a raised ridge across the middle.
  const RIDGE: Box = { x0: 18, x1: 46, z0: 30, z1: 34, y: -7 };

  it('plans for a stranded cluster whose representative cell sits on the ridge, not the deepest floor', () => {
    const s = surface([WIDE, RIDGE], reachesDownTo(0));
    const p = plan({ x: 32, z: 32, floorY: -10, orderCount: 200 }, s);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.def.targetDepth).toBeGreaterThanOrEqual(10 - RAMP_FLOOR_SNAP_REACH_M);
  });

  it('plans for a floor on the high side of a stepped pit (two benches, 4 m apart)', () => {
    const upper: Box = { x0: 18, x1: 46, z0: 18, z1: 46, y: -6 };
    const lower: Box = { x0: 30, x1: 46, z0: 30, z1: 46, y: -10 };
    const s = surface([upper, lower], reachesDownTo(0));
    expect(plan({ x: 24, z: 24, floorY: -6, orderCount: 100 }, s).ok).toBe(true);
    expect(plan({ x: 40, z: 40, floorY: -10, orderCount: 100 }, s).ok).toBe(true);
  });

  it('plans down from a bench the network already reaches to the pit below it', () => {
    const bench: Box = { x0: 18, x1: 46, z0: 18, z1: 46, y: -5 };
    const pit: Box = { x0: 26, x1: 38, z0: 26, z1: 38, y: -10 };
    const s = surface([bench, pit], reachesDownTo(-5));
    expect(plan({ x: 32, z: 32, floorY: -10, orderCount: 200 }, s).ok).toBe(true);
  });
});

describe('planCraterAccess beside a built ramp whose foot ends above the floor (#2086)', () => {
  // Measured on a 64 m desert_badlands site: a 4x4 limit shot cleared a crater ~16 wide and 8 m deep; the access ramp
  // came in from the north as a 3-wide corridor and ended 6 m down. A second shot then cut the middle to 15 m. The
  // stranded rubble's representative cell (35,38) lies one column beside the corridor (36..38), not on its axis.
  const CRATER: Box = { x0: 28, x1: 44, z0: 29, z1: 45, y: -15 };
  const inCorridor = (x: number, z: number) => x >= 36 && x <= 38 && z >= 12 && z <= 31;
  const corridorDepth = (z: number) => -Math.min(6, Math.max(0, (z - 12) * 0.35));
  function rampSurface(): AccessSurface {
    const base = surface([CRATER], () => false);
    const heightAt = (x: number, z: number) => (inCorridor(x, z) ? corridorDepth(z) : base.heightAt(x, z));
    return { ...base, heightAt, reachableFrom: (x, z) => inCorridor(x, z) || (heightAt(x, z) >= 0 && !inBox(CRATER, x, z)) };
  }
  const floor = (): StrandedFloor => ({ x: 35, z: 38, floorY: -15, orderCount: 23 });

  it('the representative cell is not on the ramp corridor and the corridor ends well above the floor', () => {
    const s = rampSurface();
    expect(s.reachableFrom(35, 38)).toBe(false);
    expect(inCorridor(35, 38)).toBe(false);
    expect(s.heightAt(37, 31)).toBeGreaterThan(-15 + 2 * RAMP_FLOOR_SNAP_REACH_M);
  });

  it('plans a ramp down to the deepened floor from the built ramp or the rim', () => {
    const p = plan(floor(), rampSurface());
    expect(p.ok).toBe(true);
  });

  it('plans for floors a few columns either side of the corridor too', () => {
    const s = rampSurface();
    for (const x of [31, 33, 35, 40, 42]) {
      expect(plan({ ...floor(), x }, s).ok, `floor column ${x}`).toBe(true);
    }
  });

  it('gives a no_start reason key, not an exception, when no cell of the network can start a ramp', () => {
    const sealed: AccessSurface = { ...rampSurface(), reachableFrom: () => false };
    expect(plan(floor(), sealed)).toEqual({ ok: false, reasonKey: 'mining.crater_access.no_start' });
  });
});

describe('planCraterAccess on nested craters (#2086)', () => {
  // A second shot deepens the middle of the first crater, whose floor the first access ramp already reaches.
  const OUTER: Box = { x0: 16, x1: 48, z0: 16, z1: 48, y: -8 };
  const INNER: Box = { x0: 26, x1: 38, z0: 26, z1: 38, y: -16 };
  const firstRamp = { def: { originX: 16, originZ: 32, direction: 'east', length: 30, targetDepth: 8, width: RAMP_DEFAULT_WIDTH }, width: RAMP_DEFAULT_WIDTH } as const;

  it('plans a ramp from the outer floor down to an inner pit (outer floor reachable, inner not)', () => {
    const s = surface([OUTER, INNER], reachesDownTo(-8));
    const p = plan({ x: 32, z: 32, floorY: -16, orderCount: 300 }, s);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.def.targetDepth).toBeGreaterThanOrEqual(16 - 8);
  });

  it('plans for an inner pit that is off-centre in the outer one', () => {
    const inner: Box = { x0: 36, x1: 46, z0: 20, z1: 30, y: -16 };
    const s = surface([OUTER, inner], reachesDownTo(-8));
    expect(plan({ x: 41, z: 25, floorY: -16, orderCount: 300 }, s).ok).toBe(true);
  });

  it('plans a second, different ramp when the first ramp is already dug and the inner floor is still stranded', () => {
    const s = surface([OUTER, INNER], reachesDownTo(-8));
    const p = plan({ x: 32, z: 32, floorY: -16, orderCount: 300 }, s, [firstRamp]);
    expect(p.ok).toBe(true);
    if (p.ok) {
      const { def } = p;
      const same = def.originX === firstRamp.def.originX && def.originZ === firstRamp.def.originZ
        && def.direction === firstRamp.def.direction && def.length === firstRamp.def.length;
      expect(same).toBe(false);
    }
  });

  it('plans down a narrow 9-cell pit sunk 12 m below the outer floor (20 m deep overall)', () => {
    const narrow: Box = { x0: 28, x1: 36, z0: 28, z1: 36, y: -20 };
    const s = surface([OUTER, narrow], reachesDownTo(-8));
    expect(plan({ x: 32, z: 32, floorY: -20, orderCount: 100 }, s).ok).toBe(true);
  });
});
