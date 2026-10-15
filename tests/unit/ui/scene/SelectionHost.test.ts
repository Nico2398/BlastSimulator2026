// Selection lifetime follows game state, not mesh presence (#1755).
import { describe, it, expect } from 'vitest';
import {
  isHostResolvedKind,
  isUnderRebuild,
  resolveSelection,
} from '../../../../src/ui/scene/SelectionHost.js';
import { createEmployeeState, hireEmployee, type Employee } from '../../../../src/core/entities/Employee.js';
import { createVehicleState, type Vehicle } from '../../../../src/core/entities/Vehicle.js';
import { createBuildingState, getBuildingDef, getDefSize, type Building } from '../../../../src/core/entities/Building.js';
import { createLogisticsState, type TrackedFragment } from '../../../../src/core/economy/Logistics.js';
import type { PlannedBuilding } from '../../../../src/core/state/GameState.js';
import { Random } from '../../../../src/core/math/Random.js';

type SelectionWorld = Parameters<typeof resolveSelection>[0];

function makeWorld(): SelectionWorld {
  return {
    employees: createEmployeeState(),
    vehicles: createVehicleState(),
    buildings: createBuildingState(),
    plannedBuildings: [],
    logistics: createLogisticsState(),
  };
}

function addEmployee(world: SelectionWorld, patch: Partial<Employee> = {}): Employee {
  const { employee } = hireEmployee(world.employees, 'driller', new Random(42));
  Object.assign(employee, patch);
  world.employees.employees.push(employee);
  return employee;
}

function addVehicle(world: SelectionWorld, id: number): Vehicle {
  const v = { id, type: 'truck', tier: 1, x: 3, z: 4, hp: 100 } as unknown as Vehicle;
  world.vehicles.vehicles.push(v);
  return v;
}

function addBuilding(world: SelectionWorld, id: number, type: Building['type'] = 'living_quarters'): Building {
  const b: Building = { id, type, tier: 1, x: 5, z: 6, hp: 100, active: true, occupantIds: [] };
  world.buildings.buildings.push(b);
  return b;
}

function addSite(world: SelectionWorld, buildingId: number, over: Partial<PlannedBuilding> = {}): PlannedBuilding {
  const site: PlannedBuilding = {
    id: 1, buildingId, type: 'living_quarters', tier: 2, x: 10, z: 12, actionId: 1, cost: 0, ...over,
  };
  world.plannedBuildings.push(site);
  return site;
}

function addFragment(world: SelectionWorld, id: number, patch: Partial<TrackedFragment>): void {
  world.logistics.fragments.push({
    fragment: { id } as unknown as TrackedFragment['fragment'],
    state: 'on_ground',
    vehicleId: null,
    warehouseId: null,
    ...patch,
  });
}

describe('isHostResolvedKind', () => {
  it.each(['employee', 'vehicle', 'building', 'fragment'])('is true for %s', (k) => {
    expect(isHostResolvedKind(k)).toBe(true);
  });
  it.each(['hole', 'ramp', '', 'tree'])('is false for %s', (k) => {
    expect(isHostResolvedKind(k)).toBe(false);
  });
});

describe('resolveSelection: employee', () => {
  it('on foot is self', () => {
    const w = makeWorld();
    const e = addEmployee(w);
    expect(resolveSelection(w, 'employee', e.id)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('inside a building anchors on that building', () => {
    const w = makeWorld();
    addBuilding(w, 4);
    const e = addEmployee(w, { locomotion: { kind: 'inside', buildingId: 4 } });
    expect(resolveSelection(w, 'employee', e.id)).toEqual({
      exists: true, anchor: { type: 'host', kind: 'building', id: 4 },
    });
  });

  it('aboard a vehicle anchors on that vehicle', () => {
    const w = makeWorld();
    addVehicle(w, 9);
    const e = addEmployee(w, { locomotion: { kind: 'mounted', vehicleId: 9 } });
    expect(resolveSelection(w, 'employee', e.id)).toEqual({
      exists: true, anchor: { type: 'host', kind: 'vehicle', id: 9 },
    });
  });

  it('building vs vehicle host with the same numeric id differ by kind', () => {
    const w = makeWorld();
    addBuilding(w, 2);
    addVehicle(w, 2);
    const inB = addEmployee(w, { locomotion: { kind: 'inside', buildingId: 2 } });
    const inV = addEmployee(w, { locomotion: { kind: 'mounted', vehicleId: 2 } });
    expect(resolveSelection(w, 'employee', inB.id)).toMatchObject({ anchor: { kind: 'building', id: 2 } });
    expect(resolveSelection(w, 'employee', inV.id)).toMatchObject({ anchor: { kind: 'vehicle', id: 2 } });
  });

  it('still exists when the host id is gone from state', () => {
    const w = makeWorld();
    const e = addEmployee(w, { locomotion: { kind: 'inside', buildingId: 77 } });
    expect(resolveSelection(w, 'employee', e.id).exists).toBe(true);
  });

  it('absent from the roster is gone', () => {
    const w = makeWorld();
    expect(resolveSelection(w, 'employee', 123)).toEqual({ exists: false });
  });

  it('dismissed employee is gone', () => {
    const w = makeWorld();
    const e = addEmployee(w, { locomotion: { kind: 'inside', buildingId: 1 } });
    w.employees.employees = [];
    expect(resolveSelection(w, 'employee', e.id)).toEqual({ exists: false });
  });
});

describe('resolveSelection: vehicle', () => {
  it('present is self', () => {
    const w = makeWorld();
    addVehicle(w, 3);
    expect(resolveSelection(w, 'vehicle', 3)).toEqual({ exists: true, anchor: { type: 'self' } });
  });
  it('absent is gone', () => {
    expect(resolveSelection(makeWorld(), 'vehicle', 3)).toEqual({ exists: false });
  });
});

describe('resolveSelection: building', () => {
  it('live building is self', () => {
    const w = makeWorld();
    addBuilding(w, 5);
    expect(resolveSelection(w, 'building', 5)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('live building wins over a site holding the same id', () => {
    const w = makeWorld();
    addBuilding(w, 5);
    addSite(w, 5);
    expect(resolveSelection(w, 'building', 5)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('absent but held by a planned site resolves to the inclusive footprint', () => {
    const w = makeWorld();
    addSite(w, 5, { type: 'living_quarters', tier: 2, x: 10, z: 12 });
    const { sizeX, sizeZ } = getDefSize(getBuildingDef('living_quarters', 2));
    expect(resolveSelection(w, 'building', 5)).toEqual({
      exists: true,
      anchor: {
        type: 'site',
        footprint: { minX: 10, maxX: 10 + sizeX - 1, minZ: 12, maxZ: 12 + sizeZ - 1 },
      },
    });
  });

  it('site footprint grows with the planned tier', () => {
    const w = makeWorld();
    addSite(w, 5, { tier: 3, x: 0, z: 0 });
    const { sizeX, sizeZ } = getDefSize(getBuildingDef('living_quarters', 3));
    const r = resolveSelection(w, 'building', 5);
    expect(r).toMatchObject({ exists: true, anchor: { type: 'site', footprint: { maxX: sizeX - 1, maxZ: sizeZ - 1 } } });
  });

  it('site is matched by buildingId, not by site id', () => {
    const w = makeWorld();
    addSite(w, 8, { id: 5 });
    expect(resolveSelection(w, 'building', 5)).toEqual({ exists: false });
    expect(resolveSelection(w, 'building', 8).exists).toBe(true);
  });

  it('neither building nor site is gone', () => {
    expect(resolveSelection(makeWorld(), 'building', 5)).toEqual({ exists: false });
  });
});

describe('resolveSelection: fragment', () => {
  it('on the ground is self', () => {
    const w = makeWorld();
    addFragment(w, 11, { state: 'on_ground' });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('in transit anchors on the carrying vehicle (string vehicleId)', () => {
    const w = makeWorld();
    addVehicle(w, 9);
    addFragment(w, 11, { state: 'in_transit', vehicleId: '9' });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({
      exists: true, anchor: { type: 'host', kind: 'vehicle', id: 9 },
    });
  });

  it('stored anchors on the warehouse', () => {
    const w = makeWorld();
    addBuilding(w, 6, 'freight_warehouse' as Building['type']);
    addFragment(w, 11, { state: 'stored', warehouseId: 6 });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({
      exists: true, anchor: { type: 'host', kind: 'building', id: 6 },
    });
  });

  it('in transit with unresolvable vehicle falls back to self', () => {
    const w = makeWorld();
    addFragment(w, 11, { state: 'in_transit', vehicleId: '99' });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('stored with missing warehouse falls back to self', () => {
    const w = makeWorld();
    addFragment(w, 11, { state: 'stored', warehouseId: 99 });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('stored with null warehouse falls back to self', () => {
    const w = makeWorld();
    addFragment(w, 11, { state: 'stored', warehouseId: null });
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: true, anchor: { type: 'self' } });
  });

  it('removed (sold) fragment is gone', () => {
    const w = makeWorld();
    addFragment(w, 11, { state: 'stored', warehouseId: 6 });
    w.logistics.fragments = [];
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: false });
  });

  it('other fragment ids do not match', () => {
    const w = makeWorld();
    addFragment(w, 12, {});
    expect(resolveSelection(w, 'fragment', 11)).toEqual({ exists: false });
  });
});

describe('isUnderRebuild', () => {
  it('true when a site holds the id and no live building has it', () => {
    const w = makeWorld();
    addSite(w, 5);
    expect(isUnderRebuild(w, 5)).toBe(true);
  });
  it('false when a live building has the id, even with a site', () => {
    const w = makeWorld();
    addBuilding(w, 5);
    addSite(w, 5);
    expect(isUnderRebuild(w, 5)).toBe(false);
  });
  it('false with neither', () => {
    expect(isUnderRebuild(makeWorld(), 5)).toBe(false);
  });
  it('false for a different id', () => {
    const w = makeWorld();
    addSite(w, 5);
    expect(isUnderRebuild(w, 6)).toBe(false);
  });
});
