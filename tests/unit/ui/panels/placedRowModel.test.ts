import { describe, it, expect } from 'vitest';
import { placedRowModel, siteRowModel } from '../../../../src/ui/panels/placedRowModel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState, PlannedBuilding } from '../../../../src/core/state/GameState.js';
import { getBuildingDef, type Building, type BuildingType, type BuildingTier } from '../../../../src/core/entities/Building.js';

function mk(overrides: Partial<Building> & Pick<Building, 'id' | 'type'>): Building {
  return { tier: 1 as BuildingTier, x: 5, z: 5, hp: getBuildingDef(overrides.type, 1).maxHp, active: true, occupantIds: [], ...overrides };
}

function stateWith(...bs: Building[]): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.buildings.buildings = bs;
  return s;
}

describe('placedRowModel — HP (#1759)', () => {
  it('full HP gives fraction 1', () => {
    const b = mk({ id: 1, type: 'management_office' });
    expect(placedRowModel(b, stateWith(b)).hpFraction).toBe(1);
  });

  it('half HP gives fraction 0.5 and non-empty text', () => {
    const maxHp = getBuildingDef('management_office', 1).maxHp;
    const b = mk({ id: 1, type: 'management_office', hp: maxHp / 2 });
    const m = placedRowModel(b, stateWith(b));
    expect(m.hpFraction).toBeCloseTo(0.5);
    expect(m.hpText).not.toBe('');
  });

  it('zero HP gives fraction 0, never NaN', () => {
    const b = mk({ id: 1, type: 'management_office', hp: 0 });
    const m = placedRowModel(b, stateWith(b));
    expect(m.hpFraction).toBe(0);
    expect(m.hpText).not.toContain('NaN');
  });
});

describe('placedRowModel — utilization (#1759)', () => {
  it.each<BuildingType>(['living_quarters', 'driving_center', 'blasting_academy', 'management_office', 'geology_lab'])(
    '%s reports occupants over capacity',
    (type) => {
      const cap = getBuildingDef(type, 1).capacity;
      const b = mk({ id: 1, type, occupantIds: [11, 12] });
      const u = placedRowModel(b, stateWith(b)).utilization;
      expect(u).not.toBeNull();
      expect(u!.fraction).toBeCloseTo(2 / cap);
      expect(u!.text).toContain('2');
      expect(u!.text).toContain(String(cap));
    },
  );

  it('empty people building reports fraction 0', () => {
    const b = mk({ id: 1, type: 'living_quarters' });
    expect(placedRowModel(b, stateWith(b)).utilization!.fraction).toBe(0);
  });

  it('explosive warehouse reports stored kg over capacity kg', () => {
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;
    const b = mk({ id: 1, type: 'explosive_warehouse', storedExplosives: { boomite: 30, other: 20 } });
    const u = placedRowModel(b, stateWith(b)).utilization;
    expect(u).not.toBeNull();
    expect(u!.fraction).toBeCloseTo(50 / cap);
    expect(u!.text).toContain('50');
    expect(u!.text).toContain('kg');
  });

  it('freight warehouse reports its own stored kg, not other warehouses', () => {
    const cap = getBuildingDef('freight_warehouse', 1).capacity;
    const b = mk({ id: 1, type: 'freight_warehouse' });
    const s = stateWith(b);
    s.logistics.fragments.push(
      { fragment: { id: 1, mass: 700 }, state: 'stored', vehicleId: null, warehouseId: 1 } as never,
      { fragment: { id: 2, mass: 300 }, state: 'stored', vehicleId: null, warehouseId: 2 } as never,
    );
    const u = placedRowModel(b, s).utilization;
    expect(u!.fraction).toBeCloseTo(700 / cap);
    expect(u!.text).toContain('700');
    expect(u!.text).toContain('kg');
  });

  it('empty freight warehouse reports fraction 0', () => {
    const b = mk({ id: 1, type: 'freight_warehouse' });
    expect(placedRowModel(b, stateWith(b)).utilization!.fraction).toBe(0);
  });

  it('research center is busy when the queue is non-empty', () => {
    const b = mk({ id: 1, type: 'research_center' });
    const s = stateWith(b);
    const idle = placedRowModel(b, s).utilization;
    s.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 2 } as never);
    const busy = placedRowModel(b, s).utilization;
    expect(busy).not.toBeNull();
    expect(busy!.text).not.toBe('');
    expect(busy!.text).not.toBe(idle?.text);
  });

  it('spoil heap shows its fill against the finite capacity (#1892)', () => {
    const b = mk({ id: 1, type: 'spoil_heap', storedSpoilKg: 25_000 });
    const u = placedRowModel(b, stateWith(b)).utilization;
    expect(u).not.toBeNull();
    expect(u!.text).toContain('25000');
    expect(u!.text).toContain('50000');
    expect(u!.fraction).toBeCloseTo(0.5);
  });
});

describe('placedRowModel — badge (#1759)', () => {
  it('operating building has no badge', () => {
    const b = mk({ id: 1, type: 'management_office' });
    expect(placedRowModel(b, stateWith(b)).badge).toBeNull();
  });

  it('a live closure gives out_of_service', () => {
    const b = mk({ id: 1, type: 'management_office' });
    const s = stateWith(b);
    s.events.activeModifiers.push({
      id: 801, kind: 'out_of_service', sourceEventId: 'evt_flood', role: null, targetId: 1,
      targetKind: 'building', category: null, magnitude: 1, startTick: 0, endTick: null,
    });
    expect(placedRowModel(b, s).badge).toBe('out_of_service');
  });

  it('a queued demolition gives demolition_ordered', () => {
    const b = mk({ id: 1, type: 'management_office' });
    const s = stateWith(b);
    s.pendingActions.push({
      id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
      targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: 1 }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });
    expect(placedRowModel(b, s).badge).toBe('demolition_ordered');
  });

  it('a standing building with an upgrade site reports upgrading (#1875)', () => {
    const b = mk({ id: 1, type: 'management_office' });
    const s = stateWith(b);
    s.plannedBuildings.push({ id: 90, buildingId: 1, type: 'management_office', tier: 2, x: 5, z: 5, actionId: 60, cost: 1, upgrade: true });
    expect(placedRowModel(b, s).badge).toBe('upgrading');
  });
});

describe('siteRowModel (#1759)', () => {
  const site = (over: Partial<PlannedBuilding> = {}): PlannedBuilding => ({
    id: 90, buildingId: 7, type: 'management_office', tier: 1, x: 17, z: 23, actionId: 60, cost: 1000, ...over,
  });

  it('progress is null for an unstarted new site', () => {
    const pb = site();
    const s = stateWith();
    s.plannedBuildings.push(pb);
    expect(siteRowModel(pb, s)).toEqual({ progress: null });
  });

  it('progress follows the builder task', () => {
    const pb = site();
    const s = stateWith();
    s.plannedBuildings.push(pb);
    s.employees.employees.push({ id: 5, activeTaskTotalTicks: 100, taskTicksRemaining: 40 } as never);
    s.pendingActions.push({
      id: 60, type: 'place_building', requiredSkill: null, requiredVehicleRole: null,
      targetX: 17, targetZ: 23, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'in_progress', holderId: 5, queuedAtTick: 0,
    } as never);
    expect(siteRowModel(pb, s).progress).toBeCloseTo(0.6);
  });
});
