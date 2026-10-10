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
});
