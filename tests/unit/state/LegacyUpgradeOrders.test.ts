// BlastSimulator2026 — Loading a save from before in-place upgrades (#1875)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction, type PlannedBuilding } from '../../../src/core/state/GameState.js';
import { cancelLegacyUpgradeOrders } from '../../../src/core/state/LegacyUpgradeOrders.js';

function action(over: Partial<PendingAction>): PendingAction {
  return {
    id: 1, type: 'place_building', requiredSkill: null, requiredVehicleRole: null, targetX: 5, targetZ: 5, targetY: 0,
    payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0, ...over,
  };
}

function site(over: Partial<PlannedBuilding> & { rebuild?: boolean } = {}): PlannedBuilding {
  return { id: 70, buildingId: 4, type: 'living_quarters', tier: 2, x: 9, z: 14, actionId: 5, cost: 500, ...over };
}

function fresh(): GameState {
  return createGame({ seed: 1 } as Parameters<typeof createGame>[0]);
}

describe('cancelLegacyUpgradeOrders', () => {
  it('leaves a plain demolition and a plain site untouched', () => {
    const s = fresh();
    s.pendingActions.push(action({ id: 2, type: 'demolish_building', payload: { buildingId: 4 } }));
    s.plannedBuildings.push(site());
    cancelLegacyUpgradeOrders(s);
    expect(s.pendingActions.map(a => a.id)).toContain(2);
    expect(s.plannedBuildings).toHaveLength(1);
  });

  it('survives a demolition with a missing or non-object payload', () => {
    const s = fresh();
    s.pendingActions.push(action({ id: 2, type: 'demolish_building', payload: undefined as unknown as PendingAction['payload'] }));
    s.pendingActions.push(action({ id: 3, type: 'demolish_building', payload: null as unknown as PendingAction['payload'] }));
    expect(() => cancelLegacyUpgradeOrders(s)).not.toThrow();
    expect(s.pendingActions.map(a => a.id)).toEqual(expect.arrayContaining([2, 3]));
  });

  it('cancels a legacy upgrade demolition and drops its rebuild site', () => {
    const s = fresh();
    s.pendingActions.push(action({ id: 2, type: 'demolish_building', payload: { buildingId: 4, rebuildOrderId: 70 } }));
    s.plannedBuildings.push(site());
    cancelLegacyUpgradeOrders(s);
    expect(s.pendingActions.some(a => a.id === 2)).toBe(false);
    expect(s.plannedBuildings).toHaveLength(0);
  });

  it('refunds a rebuild site with no pending action, in full', () => {
    const s = fresh();
    const cash = s.cash;
    s.plannedBuildings.push(site({ rebuild: true }));
    cancelLegacyUpgradeOrders(s);
    expect(s.plannedBuildings).toHaveLength(0);
    expect(s.cash).toBe(cash + 500);
    expect(s.finances.transactions.some(tx => tx.category === 'refund')).toBe(true);
  });

  it('cancels a rebuild site that still has its place_building action', () => {
    const s = fresh();
    s.pendingActions.push(action({ id: 5 }));
    s.plannedBuildings.push(site({ rebuild: true }));
    cancelLegacyUpgradeOrders(s);
    expect(s.pendingActions.some(a => a.id === 5)).toBe(false);
    expect(s.plannedBuildings).toHaveLength(0);
  });

  it('cancels a rebuild site even when its building still stands', () => {
    const s = fresh();
    s.buildings.buildings.push({ id: 4, type: 'living_quarters', tier: 1, x: 9, z: 14, hp: 10, active: true, occupantIds: [] });
    s.plannedBuildings.push(site({ rebuild: true }));
    cancelLegacyUpgradeOrders(s);
    expect(s.plannedBuildings).toHaveLength(0);
    expect(s.buildings.buildings.some(b => b.id === 4)).toBe(true);
  });

  it.each([NaN, -5, 0, Infinity])('does not refund a corrupt site cost (%s)', (cost) => {
    const s = fresh();
    const cash = s.cash;
    s.plannedBuildings.push(site({ rebuild: true, cost }));
    cancelLegacyUpgradeOrders(s);
    expect(s.plannedBuildings).toHaveLength(0);
    expect(s.cash).toBe(cash);
  });

  it('is idempotent', () => {
    const s = fresh();
    s.plannedBuildings.push(site({ rebuild: true }));
    cancelLegacyUpgradeOrders(s);
    const cash = s.cash;
    cancelLegacyUpgradeOrders(s);
    expect(s.cash).toBe(cash);
  });
});
