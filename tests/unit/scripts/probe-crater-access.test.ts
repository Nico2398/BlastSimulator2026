// BlastSimulator2026 — Unit tests: the probe's crater access policy, the player's job (#2095)

import { describe, it, expect } from 'vitest';
import {
  buildRampCommand, hasLiveRampWork, newCraterAccessMemory, rampedAlready, stuckRampFootprints,
} from '../../../scripts/shared/probe-crater-access.js';
import type { PendingAction, PlannedRamp } from '../../../src/core/state/GameState.js';
import type { RampDef } from '../../../src/core/mining/Ramp.js';

function segment(id: number, over: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type: 'dig_ramp_segment', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
    targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    ...over,
  } as PendingAction;
}

function planned(id: number, actionIds: number[], done: boolean[] = actionIds.map(() => false)): PlannedRamp {
  return {
    id, def: { originX: 0, originZ: 0, direction: 'south', length: 5, targetDepth: 2 },
    footprint: { minX: id, maxX: id, minZ: 0, maxZ: 4 },
    segments: actionIds.map((actionId, index) => ({ index, actionId, cells: [], region: null, done: done[index]! })),
  };
}

describe('buildRampCommand (#2095)', () => {
  it('orders a straight ramp as a two-waypoint path with its depth and width', () => {
    const def: RampDef = { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 4, width: 3 };
    expect(buildRampCommand(def)).toBe('build_ramp path:10,5;10,17 depth:4 width:3');
  });

  it('orders a turning ramp through every corner and keeps its chosen grade', () => {
    const def: RampDef = {
      originX: 10, originZ: 5, direction: 'south', length: 20, targetDepth: 6, width: 5, gradeDegrees: 18.1,
      legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 8 }],
    };
    expect(buildRampCommand(def)).toBe('build_ramp path:10,5;10,17;18,17 depth:6 width:5 grade:18.1');
  });
});

describe('hasLiveRampWork (#2095)', () => {
  it('is false with no ramp work and true while a segment can be dug', () => {
    expect(hasLiveRampWork([])).toBe(false);
    expect(hasLiveRampWork([segment(1)])).toBe(true);
    expect(hasLiveRampWork([segment(1, { status: 'in_progress', holderId: 7, blockedReason: 'target_unreachable' })])).toBe(true);
  });

  it('a queued, unheld segment stamped blocked is stuck, not live work', () => {
    expect(hasLiveRampWork([segment(1, { blockedReason: 'target_unreachable' })])).toBe(false);
  });
});

describe('stuckRampFootprints (#2095)', () => {
  it('lists a planned ramp only when every segment it has left is stuck', () => {
    const stuck = planned(1, [10, 11], [true, false]);
    const live = planned(2, [20, 21]);
    const pendingActions = [
      segment(11, { blockedReason: 'target_unreachable' }),
      segment(20, { blockedReason: 'target_unreachable' }), segment(21),
    ];
    expect(stuckRampFootprints({ plannedRamps: [stuck, live], pendingActions })).toEqual([stuck.footprint]);
  });

  it('lists nothing when no segment is stuck', () => {
    expect(stuckRampFootprints({ plannedRamps: [planned(1, [10])], pendingActions: [segment(10)] })).toEqual([]);
  });
});

describe('rampedAlready (#2095)', () => {
  const floor = { x: 20, z: 20, floorY: 5.5, orderCount: 12 };

  it('is false on a fresh memory', () => {
    expect(rampedAlready(newCraterAccessMemory(), floor)).toBe(false);
  });

  it('a floor beside a ramped one at the same depth is the same floor; a deeper one is new', () => {
    const memory = newCraterAccessMemory();
    memory.served.push({ floor, rampId: 3 });
    expect(rampedAlready(memory, { ...floor, x: 24, z: 17 })).toBe(true);
    expect(rampedAlready(memory, { ...floor, floorY: 3 })).toBe(false);
    expect(rampedAlready(memory, { ...floor, x: 60 })).toBe(false);
  });
});
