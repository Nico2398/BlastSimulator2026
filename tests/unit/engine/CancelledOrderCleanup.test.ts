// BlastSimulator2026 — A cancelled action releases the planned order it reserved (#1380)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { releasePlannedOrderForCancelledAction } from '../../../src/core/engine/CancelledOrderCleanup.js';
import { cancelAction } from '../../../src/core/engine/TaskCancellation.js';

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
