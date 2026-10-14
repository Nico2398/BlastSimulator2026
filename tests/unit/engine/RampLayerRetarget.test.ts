// BlastSimulator2026 — Unit tests: retargetRampLayers (#1719)
//
// A ramp's lead dig layer has a fixed work target (band centre). When the
// centre sits over ground the digger cannot reach, the layer moves to the
// nearest reachable column of its own cells.

import { describe, it, expect, vi } from 'vitest';
import { retargetRampLayers } from '../../../src/core/engine/RampLayerRetarget.js';
import type { PendingAction, PlannedRamp, GameState } from '../../../src/core/state/GameState.js';

type S = Pick<GameState, 'plannedRamps' | 'pendingActions'>;

/** A 5-wide, 1-deep band of cells along x at z=10, centre x=12. */
const bandCells = (y: number) => [10, 11, 12, 13, 14].map(x => ({ x, y, z: 10 }));

function action(id: number, over: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type: 'dig_ramp_segment', status: 'queued', requiredSkill: null, requiredVehicleRole: 'rock_digger',
    targetX: 12, targetY: 0, targetZ: 10, payload: {}, targetEmployeeId: null, blockedReason: null,
    ...over,
  } as unknown as PendingAction;
}

function ramp(id: number, actionIds: number[], done: boolean[] = []): PlannedRamp {
  return {
    id,
    def: { originX: 0, originZ: 0, direction: 'east', length: 5, targetDepth: 6 },
    footprint: { minX: 10, maxX: 14, minZ: 10, maxZ: 10 },
    segments: actionIds.map((actionId, index) => ({
      index, actionId, cells: bandCells(-index), region: null, done: done[index] ?? false,
    })),
  } as PlannedRamp;
}

const make = (actions: PendingAction[], ramps: PlannedRamp[]): S => ({ pendingActions: actions, plannedRamps: ramps });
const targetOf = (s: S, id: number) => { const a = s.pendingActions.find(p => p.id === id)!; return { x: a.targetX, z: a.targetZ }; };

describe('retargetRampLayers (#1719)', () => {
  it('moves an unreachable lead layer to the reachable column nearest its centre and counts it', () => {
    const s = make([action(1), action(2)], [ramp(1, [1, 2])]);
    const moved = retargetRampLayers(s, (_a, x) => x >= 13);
    expect(moved).toBe(1);
    expect(targetOf(s, 1)).toEqual({ x: 13, z: 10 });
  });

  it('leaves a reachable centre untouched', () => {
    const s = make([action(1)], [ramp(1, [1])]);
    expect(retargetRampLayers(s, () => true)).toBe(0);
    expect(targetOf(s, 1)).toEqual({ x: 12, z: 10 });
  });

  it('asks only about the centre when it is reachable', () => {
    const s = make([action(1)], [ramp(1, [1])]);
    const canReach = vi.fn(() => true);
    retargetRampLayers(s, canReach);
    expect(canReach).toHaveBeenCalledTimes(1);
    expect(canReach).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 12, 10);
  });

  it('leaves the layer unchanged when no column is reachable', () => {
    const s = make([action(1)], [ramp(1, [1])]);
    expect(retargetRampLayers(s, () => false)).toBe(0);
    expect(targetOf(s, 1)).toEqual({ x: 12, z: 10 });
  });

  it('never moves a non-queued (claimed) lead layer', () => {
    const s = make([action(1, { status: 'claimed' } as Partial<PendingAction>)], [ramp(1, [1])]);
    expect(retargetRampLayers(s, (_a, x) => x >= 13)).toBe(0);
    expect(targetOf(s, 1)).toEqual({ x: 12, z: 10 });
  });

  it('never moves a layer queued behind the lead', () => {
    const s = make([action(1), action(2)], [ramp(1, [1, 2])]);
    retargetRampLayers(s, (_a, x) => x >= 13);
    expect(targetOf(s, 2)).toEqual({ x: 12, z: 10 });
  });

  it('the lead is the first not-done segment', () => {
    const s = make([action(1), action(2)], [ramp(1, [1, 2], [true, false])]);
    expect(retargetRampLayers(s, (_a, x) => x <= 11)).toBe(1);
    expect(targetOf(s, 2)).toEqual({ x: 11, z: 10 });
    expect(targetOf(s, 1)).toEqual({ x: 12, z: 10 });
  });

  it('retargets each ramp\'s own lead independently', () => {
    const s = make([action(1), action(2, { targetZ: 10 } as Partial<PendingAction>), action(3), action(4)], [ramp(1, [1, 2]), ramp(2, [3, 4])]);
    const moved = retargetRampLayers(s, (a, x) => (a.id === 1 ? x >= 14 : x <= 10));
    expect(moved).toBe(2);
    expect(targetOf(s, 1)).toEqual({ x: 14, z: 10 });
    expect(targetOf(s, 3)).toEqual({ x: 10, z: 10 });
    expect(targetOf(s, 2)).toEqual({ x: 12, z: 10 });
    expect(targetOf(s, 4)).toEqual({ x: 12, z: 10 });
  });

  it('is deterministic and idempotent', () => {
    const run = () => {
      const s = make([action(1)], [ramp(1, [1])]);
      const first = retargetRampLayers(s, (_a, x) => x >= 13);
      const second = retargetRampLayers(s, (_a, x) => x >= 13);
      return { first, second, t: targetOf(s, 1) };
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual({ first: 1, second: 0, t: { x: 13, z: 10 } });
  });

  it('does nothing without planned ramps', () => {
    const s = make([action(1)], []);
    expect(retargetRampLayers(s, () => false)).toBe(0);
  });
});
