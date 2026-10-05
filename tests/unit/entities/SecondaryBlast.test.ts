// BlastSimulator2026 — Unit tests for secondary blasts (#1394).
// A destroyed explosive warehouse holding stock detonates and hurts what is near it.

import { describe, it, expect } from 'vitest';
import {
  secondaryBlastRadiusM,
  resolveSecondaryBlasts,
  type SecondaryBlastEvent,
} from '../../../src/core/entities/SecondaryBlast.js';
import { createDamageState } from '../../../src/core/entities/Damage.js';
import { createBuildingState, placeBuilding } from '../../../src/core/entities/Building.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  SECONDARY_BLAST_RADIUS_BASE_M,
  SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M,
  SECONDARY_BLAST_RADIUS_MAX_M,
  SECONDARY_BLAST_DEATH_RADIUS_FRACTION,
} from '../../../src/core/config/balance.js';

const GRID = 128;

function makeWorld() {
  return {
    buildings: createBuildingState(),
    vehicles: createVehicleState(),
    employees: createEmployeeState(),
    damage: createDamageState(),
    rng: new Random(42),
  };
}

function event(kg: number, x = 60, z = 60, buildingId = 99): SecondaryBlastEvent {
  return { buildingId, x, z, explosivesKg: kg };
}

describe('secondaryBlastRadiusM', () => {
  it('follows base + perSqrtKg * sqrt(kg)', () => {
    const r = secondaryBlastRadiusM(100);
    expect(r).toBeCloseTo(
      SECONDARY_BLAST_RADIUS_BASE_M + SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M * 10, 6,
    );
  });

  it('grows with stored mass', () => {
    expect(secondaryBlastRadiusM(400)).toBeGreaterThan(secondaryBlastRadiusM(100));
  });

  it('is the base radius at zero kg', () => {
    expect(secondaryBlastRadiusM(0)).toBeCloseTo(SECONDARY_BLAST_RADIUS_BASE_M, 6);
  });

  it('is capped at the maximum radius', () => {
    expect(secondaryBlastRadiusM(1e9)).toBe(SECONDARY_BLAST_RADIUS_MAX_M);
  });
});

describe('resolveSecondaryBlasts', () => {
  it('returns [] for no events', () => {
    const w = makeWorld();
    expect(resolveSecondaryBlasts([], w.buildings, w.vehicles, w.employees, w.damage, 5)).toEqual([]);
  });

  it('reports the event and its radius', () => {
    const w = makeWorld();
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.event.buildingId).toBe(99);
    expect(out[0]!.radiusM).toBeCloseTo(secondaryBlastRadiusM(100), 6);
    expect(out[0]!.accidents).toEqual([]);
    expect(out[0]!.chained).toEqual([]);
  });

  it('kills an employee within the death radius and flags a lawsuit', () => {
    const w = makeWorld();
    const radius = secondaryBlastRadiusM(100);
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60 + radius * SECONDARY_BLAST_DEATH_RADIUS_FRACTION * 0.5, 60).employee;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(emp.alive).toBe(false);
    expect(w.damage.deathCount).toBe(1);
    expect(w.damage.lawsuitPending).toBe(true);
    const death = w.damage.accidents.find(a => a.type === 'death' && a.entityId === emp.id);
    expect(death).toBeDefined();
    expect(death!.tick).toBe(7);
    expect(out[0]!.accidents.some(a => a.type === 'death' && a.entityId === emp.id)).toBe(true);
  });

  it('injures an employee between the death radius and the full radius', () => {
    const w = makeWorld();
    const radius = secondaryBlastRadiusM(100);
    const d = radius * (SECONDARY_BLAST_DEATH_RADIUS_FRACTION + 1) / 2;
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60 + d, 60).employee;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(emp.alive).toBe(true);
    expect(emp.injured).toBe(true);
    expect(w.damage.deathCount).toBe(0);
    expect(w.damage.lawsuitPending).toBe(false);
    expect(out[0]!.accidents.some(a => a.type === 'injury' && a.entityId === emp.id)).toBe(true);
    expect(w.damage.accidents.some(a => a.type === 'injury' && a.entityId === emp.id)).toBe(true);
  });

  it('leaves entities outside the radius untouched', () => {
    const w = makeWorld();
    const radius = secondaryBlastRadiusM(100);
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60 + radius + 5, 60).employee;
    const { vehicle } = purchaseVehicle(w.vehicles, 'debris_hauler', 60, 60 + radius + 5);
    const { building } = (() => {
      placeBuilding(w.buildings, 'living_quarters', 60 + Math.ceil(radius) + 10, 60, GRID, GRID);
      return { building: w.buildings.buildings[0]! };
    })();
    const hp0 = building.hp;
    const vhp0 = vehicle.hp;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(emp.alive).toBe(true);
    expect(emp.injured).toBe(false);
    expect(vehicle.hp).toBe(vhp0);
    expect(building.hp).toBe(hp0);
    expect(out[0]!.accidents).toEqual([]);
    expect(w.damage.accidents).toEqual([]);
  });

  it('damages a building inside the radius', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'living_quarters', 62, 60, GRID, GRID);
    const b = w.buildings.buildings[0]!;
    const hp0 = b.hp;
    resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    const after = w.buildings.buildings.find(x => x.id === b.id);
    expect(after === undefined || after.hp < hp0).toBe(true);
  });

  it('damages or destroys a vehicle inside the radius', () => {
    const w = makeWorld();
    const { vehicle } = purchaseVehicle(w.vehicles, 'debris_hauler', 61, 60);
    const hp0 = vehicle.hp;
    resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    const after = w.vehicles.vehicles.find(v => v.id === vehicle.id);
    expect(after === undefined || after.hp < hp0).toBe(true);
  });

  it('does not double count a dead employee', () => {
    const w = makeWorld();
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60, 60).employee;
    emp.alive = false;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(w.damage.deathCount).toBe(0);
    expect(out[0]!.accidents).toEqual([]);
  });

  it('does not injure an already injured employee again', () => {
    const w = makeWorld();
    const radius = secondaryBlastRadiusM(100);
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60 + radius * 0.9, 60).employee;
    emp.injured = true;
    const morale0 = emp.morale;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(emp.morale).toBe(morale0);
    expect(out[0]!.accidents.filter(a => a.entityId === emp.id)).toEqual([]);
  });

  it('chains a stocked warehouse the blast destroys, exactly once', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 63, 60, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.storedExplosivesKg = 50;
    wh.hp = 1; // any blast damage destroys it
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(w.buildings.buildings.some(b => b.id === wh.id)).toBe(false);
    expect(out[0]!.chained).toHaveLength(1);
    expect(out[0]!.chained[0]!.buildingId).toBe(wh.id);
    expect(out[0]!.chained[0]!.explosivesKg).toBe(50);
    // The chained detonation is resolved in turn, once.
    const forWarehouse = out.filter(o => o.event.buildingId === wh.id);
    expect(forWarehouse).toHaveLength(1);
    expect(out).toHaveLength(2);
  });

  it('terminates when two stocked warehouses sit inside each other\'s radius', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 63, 60, GRID, GRID);
    placeBuilding(w.buildings, 'explosive_warehouse', 66, 60, GRID, GRID);
    for (const b of w.buildings.buildings) { b.storedExplosivesKg = 50; b.hp = 1; }
    const ids = w.buildings.buildings.map(b => b.id);
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(out).toHaveLength(3);
    for (const id of ids) expect(out.filter(o => o.event.buildingId === id)).toHaveLength(1);
  });

  it('does not chain a warehouse with no stock', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 63, 60, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.hp = 1;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(out[0]!.chained).toEqual([]);
    expect(out).toHaveLength(1);
  });

  it('resolves several top-level events independently', () => {
    const w = makeWorld();
    const out = resolveSecondaryBlasts(
      [event(100, 20, 20, 1), event(400, 90, 90, 2)],
      w.buildings, w.vehicles, w.employees, w.damage, 7,
    );
    expect(out.map(o => o.event.buildingId)).toEqual([1, 2]);
    expect(out[1]!.radiusM).toBeGreaterThan(out[0]!.radiusM);
  });
});
