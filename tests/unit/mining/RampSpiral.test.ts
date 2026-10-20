// BlastSimulator2026 — RampSpiral unit tests (#1940)
// A synthetic surface stands in for the terrain: a rectangular void of a given depth below a level rim.

import { describe, it, expect } from 'vitest';
import {
  proposeRampSpiral, type SpiralRequest, type SpiralSurface, type RampSpiralProposal, type RampSpiralResult, type SpiralDir,
} from '../../../src/core/mining/RampSpiral.js';
import { findRampPathFault, rampPathCells, rampTotalLength, type RampDirection } from '../../../src/core/mining/RampPath.js';
import { computeRampCost, rampLengthForGrade } from '../../../src/core/mining/Ramp.js';
import { MAX_RAMP_LENGTH, RAMP_CRATER_MIN_DROP_M, RAMP_SPIRAL_RIM_GAP_WIDTHS, type RampWidth } from '../../../src/core/config/balance.js';

interface Pit { x0: number; z0: number; w: number; h: number; depth: number }

const AREA = { min: 0, max: 60 };

function makeSurface(pit: Pit, area = AREA): SpiralSurface & { calls: number } {
  const surface = {
    calls: 0,
    heightAt(x: number, z: number): number {
      surface.calls++;
      const inPit = x >= pit.x0 && x < pit.x0 + pit.w && z >= pit.z0 && z < pit.z0 + pit.h;
      return inPit ? -pit.depth : 0;
    },
    contains(x: number, z: number): boolean {
      return x >= area.min && x < area.max && z >= area.min && z < area.max;
    },
  };
  return surface;
}

const SQUARE: Pit = { x0: 15, z0: 15, w: 30, h: 30, depth: 20 };
const RECT: Pit = { x0: 10, z0: 20, w: 40, h: 20, depth: 20 };

/** A rim tile immediately west of the pit, mid-wall. */
function rimStart(pit: Pit): { fromX: number; fromZ: number } {
  return { fromX: pit.x0 - 1, fromZ: pit.z0 + Math.floor(pit.h / 2) };
}

function req(pit: Pit, over: Partial<SpiralRequest> = {}): SpiralRequest {
  return { ...rimStart(pit), depth: 20, gradeDegrees: 15, width: 3, dir: 'cw', ...over };
}

function ok(pit: Pit, over: Partial<SpiralRequest> = {}, surface: SpiralSurface = makeSurface(pit)): RampSpiralProposal {
  const r: RampSpiralResult = proposeRampSpiral(req(pit, over), surface);
  if (!r.success) throw new Error(`expected success, got ${r.reasonKey}`);
  return r.proposal;
}

/** Chebyshev tile distance from a tile to the void rectangle (0 inside or touching). */
function voidDistance(pit: Pit, x: number, z: number): number {
  const dx = Math.max(pit.x0 - x, x - (pit.x0 + pit.w - 1), 0);
  const dz = Math.max(pit.z0 - z, z - (pit.z0 + pit.h - 1), 0);
  return Math.max(dx, dz);
}

function cellsOf(p: RampSpiralProposal, width: RampWidth) {
  return rampPathCells({ originX: p.originX, originZ: p.originZ, legs: p.legs }, width);
}

/** Clockwise (viewed from above, +z south) successor of each heading. */
const CW_NEXT: Record<RampDirection, RampDirection> = { east: 'south', south: 'west', west: 'north', north: 'east' };
const CCW_NEXT: Record<RampDirection, RampDirection> = { east: 'north', north: 'west', west: 'south', south: 'east' };

describe('proposeRampSpiral: square pit', () => {
  const required = 20 / Math.tan((15 * Math.PI) / 180);

  it('succeeds with legs, length, cost and the requested grade and depth', () => {
    const p = ok(SQUARE);
    expect(p.legs.length).toBeGreaterThanOrEqual(2);
    expect(p.gradeDegrees).toBeCloseTo(15, 6);
    expect(p.depth).toBe(20);
    expect(p.laps).toBe(1);
  });

  it('covers at least the run the grade needs to drop the depth', () => {
    const p = ok(SQUARE);
    expect(p.totalLength).toBeGreaterThanOrEqual(required - 1e-6);
    expect(p.totalLength).toBeGreaterThanOrEqual(Math.floor(required));
  });

  it('reports a totalLength equal to the sum of its legs', () => {
    const p = ok(SQUARE);
    expect(p.totalLength).toBe(rampTotalLength(p.legs));
  });

  it('uses only cardinal legs, integer lengths no shorter than the width', () => {
    const p = ok(SQUARE);
    for (const leg of p.legs) {
      expect(['north', 'south', 'east', 'west']).toContain(leg.direction);
      expect(Number.isInteger(leg.length)).toBe(true);
      expect(leg.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('turns at every corner: consecutive legs are perpendicular', () => {
    const p = ok(SQUARE);
    for (let i = 1; i < p.legs.length; i++) {
      const a = p.legs[i - 1]!.direction;
      const b = p.legs[i]!.direction;
      expect([CW_NEXT[a], CCW_NEXT[a]]).toContain(b);
    }
  });

  it('is accepted by the multi-leg path validator', () => {
    const p = ok(SQUARE);
    expect(findRampPathFault({ originX: p.originX, originZ: p.originZ, legs: p.legs }, 3)).toBeNull();
  });

  it('starts near the requested rim tile', () => {
    const p = ok(SQUARE);
    const { fromX, fromZ } = rimStart(SQUARE);
    expect(Math.max(Math.abs(p.originX - fromX), Math.abs(p.originZ - fromZ))).toBeLessThanOrEqual(6);
  });

  it('hugs the rim: the first leg runs close to the void', () => {
    const p = ok(SQUARE);
    const first = cellsOf(p, 3).filter(c => c.legIndex === 0);
    expect(first.length).toBeGreaterThan(0);
    for (const c of first) expect(voidDistance(SQUARE, c.x, c.z)).toBeLessThanOrEqual(2 * 3 + 1);
  });

  it('costs computeRampCost(totalLength, width)', () => {
    const p = ok(SQUARE);
    expect(p.cost).toBeCloseTo(computeRampCost(p.totalLength, 3), 6);
  });

  it.each([3, 5, 7] as const)('cost scales with width %i', (width) => {
    const p = ok(SQUARE, { width });
    expect(p.cost).toBeCloseTo(computeRampCost(p.totalLength, width), 6);
  });

  it('winds a full lap round the rim when the depth needs most of a perimeter', () => {
    const p = ok(SQUARE, { depth: 30 });
    expect(p.totalLength).toBeGreaterThanOrEqual(30 / Math.tan((15 * Math.PI) / 180) - 1e-6);
    expect(p.legs.length).toBeGreaterThanOrEqual(4);
    expect(p.laps).toBe(1);
    expect(findRampPathFault({ originX: p.originX, originZ: p.originZ, legs: p.legs }, 3)).toBeNull();
  });

  it('is deterministic', () => {
    expect(ok(SQUARE)).toEqual(ok(SQUARE));
  });
});

describe('proposeRampSpiral: rectangular pit', () => {
  it('lays out a valid cardinal spiral at the grade', () => {
    const p = ok(RECT);
    expect(p.totalLength).toBeGreaterThanOrEqual(20 / Math.tan((15 * Math.PI) / 180) - 1e-6);
    expect(findRampPathFault({ originX: p.originX, originZ: p.originZ, legs: p.legs }, 3)).toBeNull();
  });

  it('has unequal leg lengths on the long and short walls', () => {
    const p = ok(RECT);
    const lengths = new Set(p.legs.map(l => l.length));
    expect(lengths.size).toBeGreaterThan(1);
  });

  it('keeps the corridor clear of the void', () => {
    const p = ok(RECT);
    for (const c of cellsOf(p, 3)) {
      expect(voidDistance(RECT, c.x, c.z)).toBeGreaterThanOrEqual(RAMP_SPIRAL_RIM_GAP_WIDTHS * 3);
    }
  });
});

describe('proposeRampSpiral: turning direction', () => {
  const turnsOf = (p: RampSpiralProposal) =>
    p.legs.slice(1).map((l, i) => ({ from: p.legs[i]!.direction, to: l.direction }));

  it('cw turns clockwise at every corner', () => {
    const p = ok(SQUARE, { dir: 'cw' });
    for (const t of turnsOf(p)) expect(t.to).toBe(CW_NEXT[t.from]);
  });

  it('ccw turns counter-clockwise at every corner', () => {
    const p = ok(SQUARE, { dir: 'ccw' });
    for (const t of turnsOf(p)) expect(t.to).toBe(CCW_NEXT[t.from]);
  });

  it('cw and ccw head opposite ways from a west-rim start', () => {
    const cw = ok(SQUARE, { dir: 'cw' });
    const ccw = ok(SQUARE, { dir: 'ccw' });
    expect(cw.legs[0]!.direction).toBe('north');
    expect(ccw.legs[0]!.direction).toBe('south');
  });

  it.each(['cw', 'ccw'] as SpiralDir[])('%s keeps clear of the void, inside the area, without crossing itself', (dir) => {
    for (const pit of [SQUARE, RECT]) {
      const surface = makeSurface(pit);
      const p = ok(pit, { dir }, surface);
      expect(findRampPathFault({ originX: p.originX, originZ: p.originZ, legs: p.legs }, 3)).toBeNull();
      for (const c of cellsOf(p, 3)) {
        expect(voidDistance(pit, c.x, c.z)).toBeGreaterThanOrEqual(RAMP_SPIRAL_RIM_GAP_WIDTHS * 3);
        expect(surface.contains(c.x, c.z)).toBe(true);
      }
    }
  });

  it.each(['cw', 'ccw'] as SpiralDir[])('%s: every width keeps the rim gap scaled to the width', (dir) => {
    for (const width of [3, 5, 7] as const) {
      const p = ok(SQUARE, { dir, width });
      for (const c of cellsOf(p, width)) {
        expect(voidDistance(SQUARE, c.x, c.z)).toBeGreaterThanOrEqual(RAMP_SPIRAL_RIM_GAP_WIDTHS * width);
      }
      for (const leg of p.legs) expect(leg.length).toBeGreaterThanOrEqual(width);
    }
  });
});

describe('proposeRampSpiral: stays inside the claimed area', () => {
  it('never emits a corridor tile outside contains()', () => {
    // Claimed area hugs the pit: only a thin rim is available on every side.
    const tight = { min: 8, max: 52 };
    const surface = makeSurface(SQUARE, tight);
    const r = proposeRampSpiral(req(SQUARE), surface);
    // The 8 m band round the 30 m pit holds the whole ring at width 3, so the order succeeds.
    expect(r.success).toBe(true);
    if (!r.success) return;
    for (const c of cellsOf(r.proposal, 3)) expect(surface.contains(c.x, c.z)).toBe(true);
  });

  it('refuses rather than leaving the area when the rim band is cut off', () => {
    // Area ends 1 tile from the void on every side: nothing fits.
    const area = { min: SQUARE.x0 - 1, max: SQUARE.x0 + SQUARE.w + 1 };
    const surface = makeSurface(SQUARE, area);
    const r = proposeRampSpiral(req(SQUARE, { fromX: SQUARE.x0 - 1 }), surface);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.too_short');
  });
});

describe('proposeRampSpiral: refusals', () => {
  const TINY: Pit = { x0: 25, z0: 25, w: 8, h: 8, depth: 20 };

  it('refuses a too-small pit with a too_short reason and both lengths', () => {
    const r = proposeRampSpiral(req(TINY), makeSurface(TINY));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.too_short');
    const { needed, offered } = r.params ?? {};
    expect(typeof needed).toBe('number');
    expect(typeof offered).toBe('number');
    expect(needed as number).toBeGreaterThan(offered as number);
    expect(needed as number).toBeGreaterThanOrEqual(Math.floor(20 / Math.tan((15 * Math.PI) / 180)));
  });

  it('refuses a gentle 4 degree grade the pit wall cannot hold but accepts a steeper 25 degree one', () => {
    const shallowNeed = proposeRampSpiral(req(SQUARE, { gradeDegrees: 4 }), makeSurface(SQUARE));
    expect(shallowNeed.success).toBe(false);
    if (shallowNeed.success) return;
    expect(shallowNeed.reasonKey).toBe('mining.ramp_spiral.too_short');
    const steeper = proposeRampSpiral(req(SQUARE, { gradeDegrees: 25 }), makeSurface(SQUARE));
    expect(steeper.success).toBe(true);
  });

  it('reports a larger needed length for a gentler grade', () => {
    const a = proposeRampSpiral(req(TINY, { gradeDegrees: 15 }), makeSurface(TINY));
    const b = proposeRampSpiral(req(TINY, { gradeDegrees: 10 }), makeSurface(TINY));
    if (a.success || b.success) throw new Error('expected both refused');
    expect(b.params!.needed as number).toBeGreaterThan(a.params!.needed as number);
  });

  it('refuses a start tile far from any pit with a named reason', () => {
    const r = proposeRampSpiral(req(SQUARE, { fromX: 2, fromZ: 2 }), makeSurface(SQUARE));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.not_on_rim');
  });

  it('refuses a start tile inside the void with start_in_void', () => {
    const r = proposeRampSpiral(req(SQUARE, { fromX: 30, fromZ: 30 }), makeSurface(SQUARE));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.start_in_void');
  });

  it('refuses flat ground (no pit anywhere)', () => {
    const flat: SpiralSurface = { heightAt: () => 0, contains: (x, z) => x >= 0 && x < 60 && z >= 0 && z < 60 };
    const r = proposeRampSpiral(req(SQUARE), flat);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.no_pit');
    expect(r.params).toEqual({ depth: RAMP_CRATER_MIN_DROP_M });
  });

  it('refuses a start tile outside the claimed area', () => {
    const r = proposeRampSpiral(req(SQUARE, { fromX: -5, fromZ: 30 }), makeSurface(SQUARE));
    expect(r).toEqual({ success: false, reasonKey: 'mining.ramp_spiral.outside_area' });
  });

  it('refuses a zero depth with bad_depth', () => {
    const r = proposeRampSpiral(req(SQUARE, { depth: 0 }), makeSurface(SQUARE));
    expect(r).toEqual({ success: false, reasonKey: 'mining.ramp_spiral.bad_depth' });
  });

  it('refuses a non-positive grade with grade_invalid', () => {
    const r = proposeRampSpiral(req(SQUARE, { gradeDegrees: 0 }), makeSurface(SQUARE));
    expect(r).toEqual({ success: false, reasonKey: 'mining.build_ramp.grade_invalid' });
  });

  it('refuses a grade over the cut-slope limit with grade_too_steep and the limit', () => {
    const r = proposeRampSpiral(req(SQUARE, { gradeDegrees: 80 }), makeSurface(SQUARE));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.build_ramp.grade_too_steep');
    expect(r.params).toMatchObject({ grade: 80 });
    expect(r.params!.max as number).toBeLessThan(80);
  });

  it('refuses a road longer than the longest ramp with too_long, not too_short', () => {
    const r = proposeRampSpiral(req(SQUARE, { depth: 200, gradeDegrees: 10 }), makeSurface(SQUARE));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.reasonKey).toBe('mining.ramp_spiral.too_long');
    expect(r.params).toEqual({ needed: rampLengthForGrade(200, 10), max: MAX_RAMP_LENGTH });
  });
});

describe('proposeRampSpiral: purity', () => {
  it('does not mutate a frozen surface and gives the same answer twice', () => {
    const inner = makeSurface(SQUARE);
    const surface = Object.freeze({ heightAt: inner.heightAt, contains: inner.contains });
    const a = proposeRampSpiral(req(SQUARE), surface);
    const b = proposeRampSpiral(req(SQUARE), surface);
    expect(a).toEqual(b);
    expect(a.success).toBe(true);
  });

  it('does not mutate the request', () => {
    const r = req(SQUARE);
    const copy = { ...r };
    proposeRampSpiral(r, makeSurface(SQUARE));
    expect(r).toEqual(copy);
  });

  it('only reads the surface', () => {
    const surface = makeSurface(SQUARE);
    proposeRampSpiral(req(SQUARE), surface);
    expect(surface.calls).toBeGreaterThan(0);
  });
});
