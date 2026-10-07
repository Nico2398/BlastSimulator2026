// BlastSimulator2026 — Building demolition as a queued building_destroyer action (#1392)

import { describe, it, expect } from 'vitest';
import {
  queueDemolition,
  isDemolitionOrdered,
  completeDemolition,
  type DemolishBuildingActionPayload,
} from '../../../src/core/engine/BuildingDemolition.js';
import { cancelAction } from '../../../src/core/engine/TaskCancellation.js';
import { computeDemolitionDurationTicks } from '../../../src/core/entities/DemolitionDuration.js';
import { getBuildingDef, getDefSize, placeBuilding, type Building } from '../../../src/core/entities/Building.js';
import type { GameContext } from '../../../src/console/commands/world.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function setup(tier: 1 | 2 | 3 = 1): { ctx: GameContext; building: Building } {
  const ctx = makeGameContext({ mineType: 'desert', seed: 42, size: 32, staffed: true });
  const state = ctx.state!;
  const res = placeBuilding(state.buildings, 'living_quarters', 9, 14, 32, 32, tier, 0, 0);
  if (!res.success) throw new Error(`setup: ${res.error}`);
  return { ctx, building: res.building! };
}

const OPTS = { cost: 1234, rebuildOrderId: null, approach: { x: 8, z: 14 }, targetY: 3 };

function payloadOf(ctx: GameContext, actionId: number): DemolishBuildingActionPayload {
  return ctx.state!.pendingActions.find(a => a.id === actionId)!.payload as unknown as DemolishBuildingActionPayload;
}

describe('queueDemolition', () => {
  it('queues one queued demolish_building action needing a building_destroyer', () => {
    const { ctx, building } = setup();
    const id = queueDemolition(ctx.state!, building, OPTS);
    const action = ctx.state!.pendingActions.find(a => a.id === id)!;
    expect(action.type).toBe('demolish_building');
    expect(action.requiredVehicleRole).toBe('building_destroyer');
    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
    expect(ctx.state!.pendingActions.filter(a => a.type === 'demolish_building')).toHaveLength(1);
  });

  it('targets the approach cell it was given', () => {
    const { ctx, building } = setup();
    const id = queueDemolition(ctx.state!, building, OPTS);
    const action = ctx.state!.pendingActions.find(a => a.id === id)!;
    expect([action.targetX, action.targetZ, action.targetY]).toEqual([8, 14, 3]);
  });

  it('records building id, cost, footprint and rebuild order in the payload', () => {
    const { ctx, building } = setup();
    const id = queueDemolition(ctx.state!, building, { ...OPTS, rebuildOrderId: 7 });
    const p = payloadOf(ctx, id);
    expect(p.buildingId).toBe(building.id);
    expect(p.cost).toBe(1234);
    expect(p.rebuildOrderId).toBe(7);
    expect(p.footprint.length).toBe(getDefSize(getBuildingDef(building.type, building.tier)).sizeX
      * getDefSize(getBuildingDef(building.type, building.tier)).sizeZ);
  });

  it('seeds durationTicks from the tier-1 vehicle duration for the footprint and building tier', () => {
    for (const tier of [1, 2, 3] as const) {
      const { ctx, building } = setup(tier);
      const id = queueDemolition(ctx.state!, building, OPTS);
      const p = payloadOf(ctx, id);
      expect(p.durationTicks).toBe(computeDemolitionDurationTicks(p.footprint.length, tier, 1));
    }
  });

  it('leaves the building standing', () => {
    const { ctx, building } = setup();
    queueDemolition(ctx.state!, building, OPTS);
    expect(ctx.state!.buildings.buildings.map(b => b.id)).toContain(building.id);
  });

  it('gives each order a distinct id', () => {
    const { ctx, building } = setup();
    const a = queueDemolition(ctx.state!, building, OPTS);
    const b = queueDemolition(ctx.state!, building, OPTS);
    expect(a).not.toBe(b);
  });
});

describe('isDemolitionOrdered', () => {
  it('is false for a building with no order', () => {
    const { ctx, building } = setup();
    expect(isDemolitionOrdered(ctx.state!, building.id)).toBe(false);
  });

  it('is true once an order is queued, only for that building', () => {
    const { ctx, building } = setup();
    queueDemolition(ctx.state!, building, OPTS);
    expect(isDemolitionOrdered(ctx.state!, building.id)).toBe(true);
    expect(isDemolitionOrdered(ctx.state!, building.id + 99)).toBe(false);
  });

  it('is true while the order is in progress', () => {
    const { ctx, building } = setup();
    const id = queueDemolition(ctx.state!, building, OPTS);
    ctx.state!.pendingActions.find(a => a.id === id)!.status = 'in_progress';
    expect(isDemolitionOrdered(ctx.state!, building.id)).toBe(true);
  });

  it('is false again after the order is cancelled', () => {
    const { ctx, building } = setup();
    const id = queueDemolition(ctx.state!, building, OPTS);
    expect(cancelAction(ctx.state!, id).success).toBe(true);
    expect(isDemolitionOrdered(ctx.state!, building.id)).toBe(false);
  });
});

describe('completeDemolition', () => {
  function complete(ctx: GameContext, building: Building, over: Partial<typeof OPTS> = {}) {
    const id = queueDemolition(ctx.state!, building, { ...OPTS, ...over });
    const payload = payloadOf(ctx, id);
    return completeDemolition(ctx.state!, ctx.grid!, ctx.emitter, payload);
  }

  it('removes the building and reports its id', () => {
    const { ctx, building } = setup();
    const outcome = complete(ctx, building);
    expect(outcome.buildingId).toBe(building.id);
    expect(ctx.state!.buildings.buildings.find(b => b.id === building.id)).toBeUndefined();
  });

  it('reports no rebuild action for a plain destroy', () => {
    const { ctx, building } = setup();
    expect(complete(ctx, building).rebuildActionId).toBeNull();
  });

  it('emits nav:occupancy_changed so the footprint is freed', () => {
    const { ctx, building } = setup();
    let emitted = 0;
    ctx.emitter.on('nav:occupancy_changed', () => { emitted++; });
    complete(ctx, building);
    expect(emitted).toBeGreaterThan(0);
  });

  it('releases an employee who was inside the building', () => {
    const { ctx, building } = setup();
    const emp = ctx.state!.employees.employees[0];
    if (!emp) throw new Error('setup: no employee');
    emp.locomotion = { kind: 'inside', buildingId: building.id };
    complete(ctx, building);
    expect(emp.locomotion.kind).toBe('on_foot');
  });

  it('refreshes logistics capacity (a warehouse stops contributing storage)', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 42, size: 32 });
    const res = placeBuilding(ctx.state!.buildings, 'freight_warehouse', 9, 14, 32, 32, 1, 0, 0);
    if (!res.success) throw new Error(res.error);
    ctx.state!.logistics.storageCapacityKg = 999_999;
    const id = queueDemolition(ctx.state!, res.building!, OPTS);
    completeDemolition(ctx.state!, ctx.grid!, ctx.emitter, payloadOf(ctx, id));
    expect(ctx.state!.logistics.storageCapacityKg).not.toBe(999_999);
  });

  it('with a rebuild order queues a place_building action for that order and reports its id', () => {
    const { ctx, building } = setup();
    const state = ctx.state!;
    state.plannedBuildings.push({
      id: 50, buildingId: building.id, type: building.type, tier: 2,
      x: building.x, z: building.z, actionId: 0, cost: 500,
    });
    const outcome = complete(ctx, building, { rebuildOrderId: 50 });
    expect(outcome.rebuildActionId).not.toBeNull();
    const rebuild = state.pendingActions.find(a => a.id === outcome.rebuildActionId)!;
    expect(rebuild.type).toBe('place_building');
    expect(rebuild.payload['buildingOrderId']).toBe(50);
    expect(state.plannedBuildings.find(pb => pb.id === 50)!.actionId).toBe(outcome.rebuildActionId);
  });
});
