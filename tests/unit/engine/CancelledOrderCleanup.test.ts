// BlastSimulator2026 — A cancelled action releases the planned order it reserved (#1380)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { releasePlannedOrderForCancelledAction } from '../../../src/core/engine/CancelledOrderCleanup.js';
import { cancelAction, cancelActionWithLinked } from '../../../src/core/engine/TaskCancellation.js';

function action(over: Partial<PendingAction> & { id: number; type: PendingAction['type'] }): PendingAction {
  return {
    requiredSkill: null, requiredVehicleRole: null, targetX: 3, targetZ: 3, targetY: 0,
    payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0, ...over,
  };
}

function withHole(state: GameState, id: string): void {
  state.plannedDrillHoles.push({ id, x: 3, z: 3, depth: 6, diameter: 0.1 });
}

describe('releasePlannedOrderForCancelledAction', () => {
  it('drops the planned drill hole the action would have drilled, and only that one', () => {
    const state = createGame({ seed: 42 });
    withHole(state, 'H1');
    withHole(state, 'H2');
    releasePlannedOrderForCancelledAction(state, action({ id: 1, type: 'drill_hole', payload: { holeId: 'H1' } }));
    expect(state.plannedDrillHoles.map(h => h.id)).toEqual(['H2']);
  });

  it('drops the planned charge of the hole the action would have loaded', () => {
    const state = createGame({ seed: 42 });
    state.plannedChargesByHole['H1'] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    state.plannedChargesByHole['H2'] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    releasePlannedOrderForCancelledAction(state, action({ id: 2, type: 'charge_hole', payload: { holeId: 'H1' } }));
    expect(Object.keys(state.plannedChargesByHole)).toEqual(['H2']);
  });

  it('drops the planned building the action would have built', () => {
    const state = createGame({ seed: 42 });
    state.plannedBuildings.push(
      { id: 1, buildingId: 10, type: 'geology_lab', tier: 1, x: 5, z: 5, actionId: 3, cost: 1000 },
      { id: 2, buildingId: 11, type: 'geology_lab', tier: 1, x: 9, z: 9, actionId: 4, cost: 1000 },
    );
    releasePlannedOrderForCancelledAction(state, action({ id: 3, type: 'place_building', payload: { buildingOrderId: 1 } }));
    expect(state.plannedBuildings.map(b => b.id)).toEqual([2]);
  });

  it('drops a ramp order once its last segment is cancelled', () => {
    const state = createGame({ seed: 42 });
    state.plannedRamps.push({
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [{ index: 0, actionId: 5, cells: [], region: null, done: false }],
    });
    releasePlannedOrderForCancelledAction(state, action({ id: 5, type: 'dig_ramp_segment', payload: { rampId: 1, segmentIndex: 0 } }));
    expect(state.plannedRamps).toHaveLength(0);
  });

  it('leaves unrelated state alone for an action that reserved nothing', () => {
    const state = createGame({ seed: 42 });
    withHole(state, 'H1');
    releasePlannedOrderForCancelledAction(state, action({ id: 6, type: 'survey', payload: { method: 'seismic' } }));
    expect(state.plannedDrillHoles).toHaveLength(1);
  });

  it('tolerates a payload whose planned entry is already gone', () => {
    const state = createGame({ seed: 42 });
    expect(() => releasePlannedOrderForCancelledAction(state, action({ id: 7, type: 'drill_hole', payload: { holeId: 'H9' } }))).not.toThrow();
  });
});

describe('cancelAction releases the planned order', () => {
  it('a cancelled drill_hole leaves no planned hole behind', () => {
    const state = createGame({ seed: 42 });
    withHole(state, 'H1');
    state.pendingActions.push(action({ id: 1, type: 'drill_hole', payload: { holeId: 'H1' } }));
    expect(cancelAction(state, 1).success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });

  it('a cancelled place_building leaves no planned building behind', () => {
    const state = createGame({ seed: 42 });
    state.plannedBuildings.push({ id: 1, buildingId: 10, type: 'geology_lab', tier: 1, x: 5, z: 5, actionId: 3, cost: 0 });
    state.pendingActions.push(action({ id: 3, type: 'place_building', payload: { buildingOrderId: 1, cost: 0 } }));
    expect(cancelAction(state, 3).success).toBe(true);
    expect(state.plannedBuildings).toHaveLength(0);
  });
});

describe('cancelling a ramp segment releases the whole ramp (#2265)', () => {
  /** A planned ramp of `count` segments; those in `dug` are done and have no action left. */
  function withRamp(state: GameState, count: number, dug: number[] = []): number[] {
    const ids: number[] = [];
    const segments = [];
    for (let i = 0; i < count; i++) {
      const isDug = dug.includes(i);
      segments.push({ index: i, actionId: 20 + i, cells: [], region: null, done: isDug });
      if (isDug) continue;
      ids.push(20 + i);
      state.pendingActions.push(action({
        id: 20 + i, type: 'dig_ramp_segment',
        payload: { rampId: 1, segmentIndex: i, cells: [], region: null, segmentCost: 50 },
      }));
      state.ghostPreviews.push({ id: 20 + i, type: 'dig_ramp_segment', targetX: i, targetZ: 3, targetY: 0, claimed: false });
    }
    state.plannedRamps.push({
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: count, targetDepth: 6 },
      footprint: { minX: 0, maxX: count, minZ: 0, maxZ: 2 },
      segments,
    });
    return ids;
  }

  it('cancelling a middle segment leaves no planned ramp with a gap', () => {
    const state = createGame({ seed: 42 });
    withRamp(state, 4);

    expect(cancelAction(state, 21).success).toBe(true);

    expect(state.plannedRamps).toHaveLength(0);
  });

  it('cancelling the first segment leaves no planned ramp either', () => {
    const state = createGame({ seed: 42 });
    withRamp(state, 3);

    expect(cancelAction(state, 20).success).toBe(true);

    expect(state.plannedRamps).toHaveLength(0);
  });

  it('removes every dig order and ghost of the ramp', () => {
    const state = createGame({ seed: 42 });
    const ids = withRamp(state, 4);

    cancelAction(state, ids[2]!);

    expect(state.pendingActions.filter(a => ids.includes(a.id))).toHaveLength(0);
    expect(state.ghostPreviews.filter(g => ids.includes(g.id))).toHaveLength(0);
  });

  it('with some segments already dug, still releases the whole planned ramp', () => {
    const state = createGame({ seed: 42 });
    withRamp(state, 4, [0]);

    expect(cancelAction(state, 22).success).toBe(true);

    expect(state.plannedRamps).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  it('keeps another ramp in flight intact', () => {
    const state = createGame({ seed: 42 });
    withRamp(state, 2);
    state.plannedRamps.push({
      id: 2,
      def: { originX: 9, originZ: 9, direction: 'east', length: 2, targetDepth: 6 },
      footprint: { minX: 9, maxX: 11, minZ: 9, maxZ: 11 },
      segments: [{ index: 0, actionId: 90, cells: [], region: null, done: false }],
    });
    state.pendingActions.push(action({
      id: 90, type: 'dig_ramp_segment', payload: { rampId: 2, segmentIndex: 0, cells: [], region: null, segmentCost: 50 },
    }));

    cancelAction(state, 20);

    expect(state.plannedRamps.map(r => r.id)).toEqual([2]);
    expect(state.pendingActions.map(a => a.id)).toEqual([90]);
  });
});

describe('cancelActionWithLinked releases every planned entry (#2265)', () => {
  it('a drill pattern leaves no planned hole behind', () => {
    const state = createGame({ seed: 42 });
    for (let i = 0; i < 3; i++) {
      withHole(state, `H${i}`);
      state.pendingActions.push(action({ id: 40 + i, type: 'drill_hole', payload: { holeId: `H${i}` } }));
    }

    expect(cancelActionWithLinked(state, 41).success).toBe(true);

    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  it('a charge order leaves no planned charge behind', () => {
    const state = createGame({ seed: 42 });
    for (let i = 0; i < 3; i++) {
      state.plannedChargesByHole[`H${i}`] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
      state.pendingActions.push(action({ id: 50 + i, type: 'charge_hole', payload: { holeId: `H${i}` } }));
    }

    expect(cancelActionWithLinked(state, 50).success).toBe(true);

    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
  });
});
