// BlastSimulator2026 — Unit tests for secondary blasts (#1394).
// A destroyed explosive warehouse holding stock detonates and hurts what is near it.

import { describe, it, expect } from 'vitest';
import {
  secondaryBlastRadiusM,
  secondaryBlastEventFor,
  secondaryCraterPlan,
  resolveSecondaryBlasts,
  type SecondaryBlastEvent,
} from '../../../src/core/entities/SecondaryBlast.js';
import { createDamageState } from '../../../src/core/entities/Damage.js';
import { createBuildingState, placeBuilding, buildingCenter, getBuildingDef } from '../../../src/core/entities/Building.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import {
  SECONDARY_BLAST_RADIUS_BASE_M,
  SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M,
  SECONDARY_BLAST_RADIUS_MAX_M,
  SECONDARY_BLAST_DEATH_RADIUS_FRACTION,
  SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION,
  SECONDARY_BLAST_CRATER_HOLE_DEPTH_M,
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
  return { buildingId, x, z, explosivesKg: kg, stock: { boomite: kg } };
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

  it('damages a building by maxHp * fraction * (1 - d/r), measured from its centre', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'living_quarters', 62, 60, GRID, GRID);
    const b = w.buildings.buildings[0]!;
    const maxHp = getBuildingDef(b.type, b.tier).maxHp;
    const hp0 = b.hp;
    const radius = secondaryBlastRadiusM(100);
    const { cx, cz } = buildingCenter(b);
    const d = Math.hypot(cx - 60, cz - 60);
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    const expected = maxHp * SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION * (1 - d / radius);
    expect(w.buildings.buildings.some(x => x.id === b.id)).toBe(true);
    expect(hp0 - b.hp).toBeCloseTo(expected, 6);
    const rec = w.damage.accidents.find(a => a.type === 'building_damage' && a.entityId === b.id);
    expect(rec).toBeDefined();
    expect(rec!.entityLabel).toBe(b.type);
    expect(out[0]!.accidents).toContainEqual(rec);
  });

  it('a full-HP building survives one detonation even at the epicentre', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'living_quarters', 60, 60, GRID, GRID);
    const b = w.buildings.buildings[0]!;
    resolveSecondaryBlasts([event(100, b.x, b.z)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(w.buildings.buildings.some(x => x.id === b.id)).toBe(true);
    expect(b.hp).toBeGreaterThan(0);
  });

  it('injures occupants of a destroyed building and records the destruction', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'living_quarters', 62, 60, GRID, GRID);
    const b = w.buildings.buildings[0]!;
    b.hp = 1;
    // Far outside the blast radius so only the building-collapse path can injure them.
    const emp = hireEmployee(w.employees, 'driller', w.rng, 120, 120).employee;
    b.occupantIds.push(emp.id);
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);

    expect(w.buildings.buildings.some(x => x.id === b.id)).toBe(false);
    expect(emp.injured).toBe(true);
    expect(emp.alive).toBe(true);
    expect(out[0]!.accidents.some(a => a.type === 'building_destroyed' && a.entityId === b.id && a.entityLabel === 'living_quarters')).toBe(true);
    expect(out[0]!.accidents.some(a => a.type === 'injury' && a.entityId === emp.id)).toBe(true);
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

  it('kills an already injured employee inside the death radius', () => {
    const w = makeWorld();
    const radius = secondaryBlastRadiusM(100);
    const emp = hireEmployee(w.employees, 'driller', w.rng, 60 + radius * SECONDARY_BLAST_DEATH_RADIUS_FRACTION * 0.5, 60).employee;
    emp.injured = true;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(emp.alive).toBe(false);
    expect(w.damage.deathCount).toBe(1);
    expect(w.damage.lawsuitPending).toBe(true);
    expect(out[0]!.accidents.some(a => a.type === 'death' && a.entityId === emp.id)).toBe(true);
  });

  it('chains a stocked warehouse the blast destroys, exactly once', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 63, 60, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.storedExplosives = { anfo: 50 };
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
    for (const b of w.buildings.buildings) { b.storedExplosives = { anfo: 50 }; b.hp = 1; }
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


// ── Crater (#1896) ────────────────────────────────────────────────────────────

describe('secondaryBlastEventFor stock (#1896)', () => {
  it('records the stored kg per explosive', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 20, 20, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.storedExplosives = { boomite: 120, krackle: 30 };
    const ev = secondaryBlastEventFor(wh)!;
    expect(ev.explosivesKg).toBe(150);
    expect(ev.stock).toEqual({ boomite: 120, krackle: 30 });
  });

  it('copies the stock so later changes to the building do not alter the event', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 20, 20, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.storedExplosives = { boomite: 100 };
    const ev = secondaryBlastEventFor(wh)!;
    wh.storedExplosives.boomite = 0;
    expect(ev.stock).toEqual({ boomite: 100 });
  });

  it('yields no event for an empty warehouse, so no crater', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 20, 20, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    expect(secondaryBlastEventFor(wh)).toBeNull();
    wh.storedExplosives = { boomite: 0 };
    expect(secondaryBlastEventFor(wh)).toBeNull();
  });
});

describe('secondaryCraterPlan (#1896)', () => {
  const ev = (stock: Record<string, number>, x = 20.5, z = 30.5): SecondaryBlastEvent => ({
    buildingId: 5, x, z, explosivesKg: Object.values(stock).reduce((a, b) => a + b, 0), stock,
  });

  it('is one hole at the footprint centre column', () => {
    const plan = secondaryCraterPlan(ev({ boomite: 100 }));
    expect(plan.holes).toHaveLength(1);
    expect(Math.floor(plan.holes[0]!.x)).toBe(20);
    expect(Math.floor(plan.holes[0]!.z)).toBe(30);
  });

  it('drills SECONDARY_BLAST_CRATER_HOLE_DEPTH_M deep', () => {
    const plan = secondaryCraterPlan(ev({ boomite: 100 }));
    expect(plan.holes[0]!.depth).toBe(SECONDARY_BLAST_CRATER_HOLE_DEPTH_M);
    expect(plan.holes[0]!.diameter).toBeGreaterThan(0);
  });

  it('charges the hole once, with no stemming', () => {
    const plan = secondaryCraterPlan(ev({ boomite: 100 }));
    const id = plan.holes[0]!.id;
    expect(Object.keys(plan.charges)).toEqual([id]);
    expect(plan.charges[id]!.stemmingM).toBe(0);
  });

  it('charges the whole stored mass', () => {
    const plan = secondaryCraterPlan(ev({ boomite: 300 }));
    expect(plan.charges[plan.holes[0]!.id]!.amountKg).toBe(300);
    expect(plan.charges[plan.holes[0]!.id]!.explosiveId).toBe('boomite');
  });

  it('uses the heaviest stocked explosive and sums every kind into the amount', () => {
    const plan = secondaryCraterPlan(ev({ krackle: 40, boomite: 120, anfo: 10 }));
    const charge = plan.charges[plan.holes[0]!.id]!;
    expect(charge.explosiveId).toBe('boomite');
    expect(charge.amountKg).toBe(170);
  });

  it('is deterministic for the same event', () => {
    expect(secondaryCraterPlan(ev({ boomite: 100 }))).toEqual(secondaryCraterPlan(ev({ boomite: 100 })));
  });

  it('is carried on every outcome', () => {
    const w = makeWorld();
    const out = resolveSecondaryBlasts([event(100, 20, 20, 1), event(400, 90, 90, 2)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(out).toHaveLength(2);
    for (const o of out) {
      expect(o.craterPlan).toEqual(secondaryCraterPlan(o.event));
      expect(o.craterPlan.holes).toHaveLength(1);
    }
    expect(out[1]!.craterPlan.charges[out[1]!.craterPlan.holes[0]!.id]!.amountKg).toBe(400);
  });

  it('is carried on chained outcomes too', () => {
    const w = makeWorld();
    placeBuilding(w.buildings, 'explosive_warehouse', 63, 60, GRID, GRID);
    const wh = w.buildings.buildings[0]!;
    wh.storedExplosives = { anfo: 50 };
    wh.hp = 1;
    const out = resolveSecondaryBlasts([event(100)], w.buildings, w.vehicles, w.employees, w.damage, 7);
    expect(out).toHaveLength(2);
    const chained = out.find(o => o.event.buildingId === wh.id)!;
    expect(chained.craterPlan.holes).toHaveLength(1);
    expect(chained.craterPlan.charges[chained.craterPlan.holes[0]!.id]!.explosiveId).toBe('anfo');
  });

  describe('fired on a grid', () => {
    function rockGrid(): VoxelGrid {
      const grid = new VoxelGrid(40, 40);
      for (let z = 0; z < 40; z++) for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
      return grid;
    }
    function fire(kg: number) {
      const grid = rockGrid();
      const plan = secondaryCraterPlan(ev({ boomite: kg }, 20.5, 20.5));
      const result = executeBlast(plan, grid, []);
      return { grid, result };
    }

    it('breaks rock and lowers the surface at the centre', () => {
      const before = computeVoxelColumnSurfaceY(rockGrid(), 20, 20)!;
      const { grid, result } = fire(200);
      expect(result).not.toBeNull();
      expect(result!.clearedVoxels).toBeGreaterThan(0);
      expect(computeVoxelColumnSurfaceY(grid, 20, 20)!).toBeLessThan(before);
    });

    it('more stock breaks more rock', () => {
      const small = fire(100).result!;
      const big = fire(400).result!;
      expect(big.clearedVoxels).toBeGreaterThan(small.clearedVoxels);
    });

    it('leaves rock far from the warehouse untouched', () => {
      const { grid } = fire(100);
      expect(computeVoxelColumnSurfaceY(grid, 2, 2)).toBe(computeVoxelColumnSurfaceY(rockGrid(), 2, 2));
    });
  });
});
