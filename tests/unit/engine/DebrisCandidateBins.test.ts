// DebrisCandidateBins — a post-blast pool is weighed one order per nearby bin (#1603)

import { describe, it, expect } from 'vitest';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { thinDebrisCandidates } from '../../../src/core/engine/DebrisCandidateBins.js';
import {
  DEBRIS_SELECTION_BIN_CELLS as CELL,
  DEBRIS_SELECTION_BIN_PROBES,
  DEBRIS_SELECTION_BINNING_MIN,
  DEBRIS_SELECTION_MAX_BINS,
  DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND,
} from '../../../src/core/config/balance.js';

type Kind = PendingAction['type'];

function order(id: number, x: number, z: number, type: Kind = 'haul_debris'): PendingAction {
  return { id, type, targetX: x, targetZ: z, status: 'queued' } as PendingAction;
}

/** Row of the default pool, a few bins off the origin where tests put their own orders. */
const ROW_Z = 10 * CELL;

/** A pool of `count` haul orders spread one per bin along a row, plus whatever `extra` holds. */
function pool(count: number, extra: PendingAction[] = []) {
  const pendingActions: PendingAction[] = [];
  for (let i = 0; i < count; i++) pendingActions.push(order(i + 1, i * CELL, ROW_Z));
  pendingActions.push(...extra);
  return { pendingActions, nextPendingActionId: pendingActions.length + 1 };
}

const isDebris = (a: PendingAction) => a.type === 'haul_debris' || a.type === 'fragment_debris';
const barren = () => false;
const any = () => true;
const origin = { x: 0, z: 0 };

describe('thinDebrisCandidates', () => {
  it('a pool at the binning threshold is filtered by allowed, nothing thinned', () => {
    const state = pool(DEBRIS_SELECTION_BINNING_MIN);
    const allowed = (a: PendingAction) => a.id % 2 === 0;
    expect(thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, allowed))
      .toEqual(state.pendingActions.filter(allowed));
  });

  it('past the threshold, costs the nearest bins only, one order each, and keeps every allowed non-debris order', () => {
    const survey = { ...order(9001, 500, 500), type: 'survey' } as PendingAction;
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 40, [survey]);
    const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any);
    const debris = out.filter(isDebris);
    expect(debris).toHaveLength(DEBRIS_SELECTION_MAX_BINS);
    // The bins nearest the employee: ids 1..MAX_BINS lie closest along the row.
    expect(debris.map(a => a.id).sort((a, b) => a - b))
      .toEqual(Array.from({ length: DEBRIS_SELECTION_MAX_BINS }, (_, i) => i + 1));
    expect(out).toContain(survey);
  });

  it('works the pile from the employee\'s side', () => {
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 40);
    const farEnd = { x: (DEBRIS_SELECTION_BINNING_MIN + 39) * CELL, z: ROW_Z };
    const ids = thinDebrisCandidates(state, farEnd, state.pendingActions, isDebris, barren, any).map(a => a.id);
    expect(Math.min(...ids)).toBeGreaterThan(DEBRIS_SELECTION_BINNING_MIN);
  });

  it('a bin is represented by its nearest order the gates accept, lowest id on a tie, after at most the probe limit', () => {
    // One crowded bin at the employee's feet, the row past the threshold beside it.
    const crowded = Array.from({ length: DEBRIS_SELECTION_BIN_PROBES + 2 }, (_, k) => order(5000 + k, 1, 1));
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 1, crowded);

    const second = crowded[1]!;
    const pick = (allowed: (a: PendingAction) => boolean) =>
      thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, allowed).filter(a => a.id >= 5000);

    expect(pick(any)).toEqual([crowded[0]]);
    expect(pick(a => a.id !== crowded[0]!.id)).toEqual([second]);
    // Only the first DEBRIS_SELECTION_BIN_PROBES are tried: one past them is never reached.
    expect(pick(a => a.id === crowded[DEBRIS_SELECTION_BIN_PROBES]!.id)).toEqual([]);

    // Nearest wins over oldest: a newer piece right at the employee's feet.
    const underfoot = order(6000, 0, 0);
    state.pendingActions.push(underfoot);
    state.nextPendingActionId = 6001;
    expect(pick(any)).toEqual([underfoot]);
  });

  it('skips orders that are not among the candidates (claimed by someone else) without spending a probe', () => {
    const crowded = Array.from({ length: DEBRIS_SELECTION_BIN_PROBES + 2 }, (_, k) => order(5000 + k, 1, 1));
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 1, crowded);
    const claimed = new Set(crowded.slice(0, DEBRIS_SELECTION_BIN_PROBES).map(a => a.id));
    const candidates = state.pendingActions.filter(a => !claimed.has(a.id));
    const out = thinDebrisCandidates(state, origin, candidates, isDebris, barren, any);
    expect(out).toContain(crowded[DEBRIS_SELECTION_BIN_PROBES]);
    expect(out.some(a => claimed.has(a.id))).toBe(false);
  });

  it('keeps break orders, ore and barren rock in separate bins of the same ground', () => {
    const here = [order(5001, 1, 1), order(5002, 1, 2, 'fragment_debris'), order(5003, 2, 1)];
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 1, here);
    const ore = (a: PendingAction) => a.id === 5003;
    const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, ore, any);
    for (const a of here) expect(out).toContain(a);
  });

  it('gives up on a kind after trying its nearest bins when none of its rock can be taken', () => {
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND * 2);
    let gateCalls = 0;
    const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, () => { gateCalls++; return false; });
    expect(out).toEqual([]);
    expect(gateCalls).toBe(DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND); // one member per bin here
  });

  it('ore nobody can store never hides barren rock farther out', () => {
    // A near band of ore bins the gates refuse, then barren bins past it.
    const near = pool(DEBRIS_SELECTION_BINNING_MIN + DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND * 3);
    const oreIds = new Set(near.pendingActions.map(a => a.id));
    const far = Array.from({ length: 4 }, (_, k) => order(90_000 + k, (500 + k) * CELL, ROW_Z));
    near.pendingActions.push(...far);
    near.nextPendingActionId = 90_010;
    const carriesOre = (a: PendingAction) => oreIds.has(a.id);
    const out = thinDebrisCandidates(near, origin, near.pendingActions, isDebris, carriesOre, a => !oreIds.has(a.id));
    expect(out.map(a => a.id).sort((a, b) => a - b)).toEqual(far.map(a => a.id));
  });

  it('sees orders queued after an earlier search', () => {
    const state = pool(DEBRIS_SELECTION_BINNING_MIN + 1);
    thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any);
    const fresh = order(state.nextPendingActionId++, -CELL, -CELL);
    state.pendingActions.push(fresh);
    expect(thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any)).toContain(fresh);
  });

  // ── Reachability is part of what a representative must pass (#1722) ──────
  describe('reachable (#1722)', () => {
    /** Ids at or below `cut` lie in the "crater"; the rest are reachable. */
    const outsideCrater = (cut: number) => (a: PendingAction) => a.id > cut;
    const debrisIds = (out: PendingAction[]) => out.filter(isDebris).map(a => a.id).sort((a, b) => a - b);

    it('unreachable debris never takes a representative slot: more than MAX_BINS unreachable bins nearer do not hide a reachable piece', () => {
      const cut = DEBRIS_SELECTION_MAX_BINS + 14;
      const state = pool(DEBRIS_SELECTION_BINNING_MIN + 40);
      const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any, outsideCrater(cut));
      // The nearest reachable bins fill all the slots.
      expect(debrisIds(out)).toEqual(Array.from({ length: DEBRIS_SELECTION_MAX_BINS }, (_, i) => cut + 1 + i));
    });

    it('a bin with no reachable member is passed over without counting against MAX_BINS_TRIED_PER_KIND, and allowed never sees an unreachable member', () => {
      const unreachableBins = DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND + 6;
      const state = pool(DEBRIS_SELECTION_BINNING_MIN + DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND * 2 + 6);
      const asked: number[] = [];
      const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren,
        a => { asked.push(a.id); return false; }, outsideCrater(unreachableBins));
      expect(out).toEqual([]);
      expect(asked.every(id => id > unreachableBins)).toBe(true);
      // Every reachable bin tried still counts: exactly the per-kind limit, one member per bin here.
      expect(asked).toHaveLength(DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND);
    });

    it('a mixed bin is represented by its nearest reachable member, however many unreachable ones are nearer and however few probes there are', () => {
      const nearUnreachable = Array.from({ length: DEBRIS_SELECTION_BIN_PROBES + 2 }, (_, k) => order(5000 + k, 0.5, 0.5));
      const farReachable = order(5100, 3, 3);
      const alsoReachable = order(5101, 3.5, 3.5);
      const state = pool(DEBRIS_SELECTION_BINNING_MIN + 1, [...nearUnreachable, farReachable, alsoReachable]);
      const blocked = new Set(nearUnreachable.map(a => a.id));
      const asked: number[] = [];
      const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren,
        a => { asked.push(a.id); return true; }, a => !blocked.has(a.id));
      expect(out.filter(a => a.id >= 5000)).toEqual([farReachable]);
      expect(asked.some(id => blocked.has(id))).toBe(false);
    });

    it('per-search work does not grow with the pile of unreachable orders (2k vs 20k give equal allowed calls)', () => {
      const allowedCalls = (unreachable: number): number => {
        const pendingActions: PendingAction[] = [];
        // Unreachable orders heaped over 40 bins nearer the employee than the reachable row.
        for (let i = 0; i < unreachable; i++) pendingActions.push(order(i + 1, (i % 40) * CELL, 0));
        const firstReachable = unreachable + 1;
        for (let i = 0; i < 40; i++) pendingActions.push(order(firstReachable + i, i * CELL, ROW_Z));
        const state = { pendingActions, nextPendingActionId: pendingActions.length + 1 };
        let calls = 0;
        const out = thinDebrisCandidates(state, origin, pendingActions, isDebris, barren,
          () => { calls++; return true; }, a => a.id >= firstReachable);
        expect(debrisIds(out).every(id => id >= firstReachable)).toBe(true);
        expect(out.filter(isDebris)).toHaveLength(DEBRIS_SELECTION_MAX_BINS);
        return calls;
      };
      const small = allowedCalls(2000);
      expect(allowedCalls(20000)).toBe(small);
      expect(small).toBeLessThanOrEqual(DEBRIS_SELECTION_MAX_BINS * DEBRIS_SELECTION_BIN_PROBES);
    });

    it('a pool with nothing reachable yields no debris and never consults allowed', () => {
      const state = pool(DEBRIS_SELECTION_BINNING_MIN + 40);
      let calls = 0;
      const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren,
        () => { calls++; return true; }, () => false);
      expect(out).toEqual([]);
      expect(calls).toBe(0);
    });

    it('the small-pool path (at most BINNING_MIN debris) also drops unreachable debris', () => {
      const state = pool(DEBRIS_SELECTION_BINNING_MIN);
      const allowed = (a: PendingAction) => a.id % 2 === 0;
      const reachable = (a: PendingAction) => a.id > 10;
      const asked: number[] = [];
      const out = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren,
        a => { asked.push(a.id); return allowed(a); }, reachable);
      expect(out).toEqual(state.pendingActions.filter(a => allowed(a) && reachable(a)));
      expect(asked.every(id => id > 10)).toBe(true);
    });

    it('omitting reachable leaves selection unchanged (everything reachable)', () => {
      const state = pool(DEBRIS_SELECTION_BINNING_MIN + 40);
      const without = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any);
      const withAll = thinDebrisCandidates(state, origin, state.pendingActions, isDebris, barren, any, () => true);
      expect(debrisIds(withAll)).toEqual(debrisIds(without));
      expect(debrisIds(without)).toEqual(Array.from({ length: DEBRIS_SELECTION_MAX_BINS }, (_, i) => i + 1));
    });
  });
});
