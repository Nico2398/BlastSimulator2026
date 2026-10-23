// BlastSimulator2026 — StrandedAccess unit tests (#2085)
// Bookkeeping helpers behind syncCraterAccess: live ramp work, abandoned debris pruning, stuck ramp footprints.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction, type PlannedRamp, type BlockedOrderReason } from '../../../src/core/state/GameState.js';
import { blockedRampFootprints, hasLiveRampWork, pruneAbandonedDebris } from '../../../src/core/engine/StrandedAccess.js';
import type { StrandedFloor } from '../../../src/core/mining/CraterAccess.js';
import { CRATER_ACCESS_ABANDON_DEBRIS_TICKS } from '../../../src/core/config/balance.js';

let nextId = 1;

function action(
  type: PendingAction['type'], x: number, z: number,
  extra: Partial<PendingAction> = {},
): PendingAction {
  return {
    id: nextId++, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: x, targetZ: z, targetY: 0, payload: {}, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0, ...extra,
  };
}

const ramp = (reason: BlockedOrderReason | null, extra: Partial<PendingAction> = {}) =>
  action('dig_ramp_segment', 5, 5, { blockedReason: reason, ...extra });

describe('hasLiveRampWork', () => {
  it('is false for no orders', () => {
    expect(hasLiveRampWork([])).toBe(false);
  });

  it('is false when no order is a ramp segment', () => {
    expect(hasLiveRampWork([action('haul_debris', 1, 1), action('drill_hole', 2, 2)])).toBe(false);
  });

  it('is false when every ramp segment is blocked target_unreachable', () => {
    const blocked = Array.from({ length: 12 }, () => ramp('target_unreachable'));
    expect(hasLiveRampWork(blocked)).toBe(false);
  });

  it('is true for one queued, unblocked segment', () => {
    expect(hasLiveRampWork([ramp(null)])).toBe(true);
    expect(hasLiveRampWork([ramp(undefined as never)])).toBe(true);
  });

  it('is true for a claimed segment', () => {
    expect(hasLiveRampWork([ramp(null, { status: 'assigned', holderId: 1 })])).toBe(true);
  });

  it('is true for an in-progress segment', () => {
    expect(hasLiveRampWork([ramp(null, { status: 'in_progress', holderId: 1 })])).toBe(true);
  });

  it('is true for mixed live and blocked segments', () => {
    expect(hasLiveRampWork([ramp('target_unreachable'), ramp(null), ramp('target_unreachable')])).toBe(true);
  });

  it('counts a held segment as live even when a stale blocked stamp remains', () => {
    expect(hasLiveRampWork([ramp('target_unreachable', { status: 'in_progress', holderId: 2 })])).toBe(true);
  });
});

describe('pruneAbandonedDebris', () => {
  const FLOOR: StrandedFloor = { x: 42, z: 42, floorY: -8, orderCount: 5 };
  const OTHER: StrandedFloor = { x: 70, z: 70, floorY: -8, orderCount: 5 };
  const ABANDON = CRATER_ACCESS_ABANDON_DEBRIS_TICKS;

  function stateWith(...orders: PendingAction[]): Pick<GameState, 'pendingActions'> {
    return { pendingActions: orders };
  }

  const stuckHaul = (x = 42, z = 42) => action('haul_debris', x, z, { blockedReason: 'debris_out_of_reach' });

  it('is a no-op for an empty order list', () => {
    const state = stateWith();
    expect(pruneAbandonedDebris(state, [FLOOR], 0, ABANDON)).toEqual([]);
    expect(pruneAbandonedDebris(state, [FLOOR], ABANDON * 2, ABANDON)).toEqual([]);
    expect(state.pendingActions).toEqual([]);
  });

  it('removes nothing before the floor has been unplannable for abandonTicks', () => {
    const haul = stuckHaul();
    const state = stateWith(haul);
    pruneAbandonedDebris(state, [FLOOR], 100, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR], 100 + ABANDON - 1, ABANDON)).toEqual([]);
    expect(state.pendingActions).toContain(haul);
  });

  it('removes the stuck orders exactly at abandonTicks and returns their ids', () => {
    const a = stuckHaul(42, 42);
    const b = action('fragment_debris', 43, 42, { blockedReason: 'debris_out_of_reach' });
    const state = stateWith(a, b);
    pruneAbandonedDebris(state, [FLOOR], 100, ABANDON);
    const removed = pruneAbandonedDebris(state, [FLOOR], 100 + ABANDON, ABANDON);
    expect([...removed].sort()).toEqual([a.id, b.id].sort());
    expect(state.pendingActions).toEqual([]);
  });

  it('restarts the clock when the floor drops out of the unplannable list', () => {
    const haul = stuckHaul();
    const state = stateWith(haul);
    pruneAbandonedDebris(state, [FLOOR], 0, ABANDON);
    pruneAbandonedDebris(state, [], ABANDON / 2, ABANDON); // plannable again
    pruneAbandonedDebris(state, [FLOOR], ABANDON / 2 + 1, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR], ABANDON + 1, ABANDON)).toEqual([]);
    expect(state.pendingActions).toContain(haul);
  });

  it('keeps holes, patterns, charge orders and non-stuck debris', () => {
    const hole = action('drill_hole', 42, 42, { blockedReason: 'buried_under_rubble' });
    const holeStuck = action('drill_hole', 42, 43, { blockedReason: 'debris_out_of_reach' });
    const charge = action('charge_hole', 42, 44, { blockedReason: 'debris_out_of_reach' });
    const reachableHaul = action('haul_debris', 43, 43, { blockedReason: null });
    const ramp1 = action('dig_ramp_segment', 44, 44, { blockedReason: 'target_unreachable' });
    const state = stateWith(hole, holeStuck, charge, reachableHaul, ramp1);
    pruneAbandonedDebris(state, [FLOOR], 0, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR], ABANDON, ABANDON)).toEqual([]);
    expect(state.pendingActions).toHaveLength(5);
  });

  it('only prunes debris inside the unplannable floor', () => {
    const inside = stuckHaul(42, 42);
    const outside = stuckHaul(20, 20);
    const state = stateWith(inside, outside);
    pruneAbandonedDebris(state, [FLOOR], 0, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR], ABANDON, ABANDON)).toEqual([inside.id]);
    expect(state.pendingActions).toEqual([outside]);
  });

  it('never prunes a floor that was not reported unplannable (e.g. unaffordable)', () => {
    const haul = stuckHaul(70, 70);
    const state = stateWith(haul);
    pruneAbandonedDebris(state, [FLOOR], 0, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR], ABANDON * 5, ABANDON)).toEqual([]);
    expect(pruneAbandonedDebris(state, [], ABANDON * 6, ABANDON)).toEqual([]);
    expect(state.pendingActions).toEqual([haul]);
    void OTHER;
  });

  it('tracks each floor on its own clock', () => {
    const near = stuckHaul(42, 42);
    const far = stuckHaul(70, 70);
    const state = stateWith(near, far);
    pruneAbandonedDebris(state, [FLOOR], 0, ABANDON);
    pruneAbandonedDebris(state, [FLOOR, OTHER], 10, ABANDON);
    expect(pruneAbandonedDebris(state, [FLOOR, OTHER], ABANDON, ABANDON)).toEqual([near.id]);
    expect(pruneAbandonedDebris(state, [FLOOR, OTHER], 10 + ABANDON, ABANDON)).toEqual([far.id]);
  });
});

describe('blockedRampFootprints', () => {
  function plannedRamp(id: number, segmentActions: PendingAction[], doneCount = 0, minX = 10): PlannedRamp {
    return {
      id,
      def: { originX: minX, originZ: 10, direction: 'east', length: 5, targetDepth: 4 },
      footprint: { minX, maxX: minX + 4, minZ: 10, maxZ: 12 },
      segments: segmentActions.map((a, index) => ({ index, actionId: a.id, cells: [], region: null, done: index < doneCount })),
    };
  }

  const stateOf = (plannedRamps: PlannedRamp[], pendingActions: PendingAction[]) => ({ plannedRamps, pendingActions });

  it('is empty with no planned ramps', () => {
    expect(blockedRampFootprints(createGame({ seed: 42 }))).toEqual([]);
  });

  it('returns the footprint of a ramp whose every remaining segment is blocked', () => {
    const segs = [ramp('target_unreachable'), ramp('target_unreachable')];
    const planned = plannedRamp(1, segs);
    expect(blockedRampFootprints(stateOf([planned], segs))).toEqual([planned.footprint]);
  });

  it('ignores done segments when judging a ramp stuck', () => {
    const segs = [ramp(null), ramp('target_unreachable'), ramp('target_unreachable')];
    const planned = plannedRamp(1, segs, 1);
    expect(blockedRampFootprints(stateOf([planned], segs.slice(1)))).toEqual([planned.footprint]);
  });

  it('is empty when any remaining segment is live', () => {
    const segs = [ramp('target_unreachable'), ramp(null)];
    expect(blockedRampFootprints(stateOf([plannedRamp(1, segs)], segs))).toEqual([]);
  });

  it('is empty when a remaining segment is held by a worker', () => {
    const segs = [ramp('target_unreachable', { status: 'in_progress', holderId: 3 })];
    expect(blockedRampFootprints(stateOf([plannedRamp(1, segs)], segs))).toEqual([]);
  });

  it('is empty for a ramp with no remaining segments', () => {
    const segs = [ramp(null)];
    expect(blockedRampFootprints(stateOf([plannedRamp(1, segs, 1)], []))).toEqual([]);
  });

  it('lists only the stuck ramps among several', () => {
    const stuck = [ramp('target_unreachable')];
    const live = [ramp(null)];
    const a = plannedRamp(1, stuck, 0, 10);
    const b = plannedRamp(2, live, 0, 30);
    const c = plannedRamp(3, [ramp('target_unreachable')], 0, 50);
    const pending = [...stuck, ...live, ...c.segments.map(s => ({ ...ramp('target_unreachable'), id: s.actionId }))];
    expect(blockedRampFootprints(stateOf([a, b, c], pending))).toEqual([a.footprint, c.footprint]);
  });
});
