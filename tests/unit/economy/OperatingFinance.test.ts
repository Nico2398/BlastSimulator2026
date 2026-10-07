import { describe, it, expect } from 'vitest';
import {
  getOperatingCostPerHour,
  getOperatingIncomePerHour,
  getOperatingSummary,
  getRunway,
} from '../../../src/core/economy/OperatingFinance.js';
import { createFinanceState, addIncome, addExpense } from '../../../src/core/economy/Finance.js';
import { createEmployeeState, hireEmployee, killEmployee, PAY_CYCLE_TICKS } from '../../../src/core/entities/Employee.js';
import { createBuildingState, getBuildingDef, type Building } from '../../../src/core/entities/Building.js';
import { createVehicleState, purchaseVehicle, getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { OPERATING_INCOME_WINDOW_TICKS, TICKS_PER_DAY } from '../../../src/core/config/balance.js';
import { Random } from '../../../src/core/math/Random.js';

function emptySite() {
  return { employees: createEmployeeState(), buildings: createBuildingState(), vehicles: createVehicleState() };
}

function addBuilding(s: ReturnType<typeof emptySite>, active: boolean): Building {
  const b: Building = { id: s.buildings.buildings.length + 1, type: 'living_quarters', tier: 1, x: 0, z: 0, hp: 100, active, occupantIds: [] };
  s.buildings.buildings.push(b);
  return b;
}

describe('getOperatingCostPerHour', () => {
  it('is zero for an empty site', () => {
    const c = getOperatingCostPerHour(emptySite());
    expect(c).toEqual({ payroll: 0, buildings: 0, vehicleMaintenance: 0, fuel: 0, total: 0 });
  });

  it('payroll is alive salaries spread over the pay cycle', () => {
    const s = emptySite();
    const rng = new Random(42);
    const a = hireEmployee(s.employees, 'driller', rng).employee;
    const b = hireEmployee(s.employees, 'manager', rng).employee;
    const c = getOperatingCostPerHour(s);
    expect(c.payroll).toBeCloseTo((a.salary + b.salary) / PAY_CYCLE_TICKS, 5);
    expect(c.payroll).toBeGreaterThan(0);
  });

  it('excludes dead employees from payroll', () => {
    const s = emptySite();
    const rng = new Random(42);
    const a = hireEmployee(s.employees, 'driller', rng).employee;
    const b = hireEmployee(s.employees, 'manager', rng).employee;
    killEmployee(s.employees, b.id);
    expect(getOperatingCostPerHour(s).payroll).toBeCloseTo(a.salary / PAY_CYCLE_TICKS, 5);
  });

  it('counts upkeep of active buildings only', () => {
    const s = emptySite();
    addBuilding(s, true);
    addBuilding(s, false);
    const expected = getBuildingDef('living_quarters', 1).operatingCostPerTick;
    expect(expected).toBeGreaterThan(0);
    expect(getOperatingCostPerHour(s).buildings).toBe(expected);
  });

  it('bills maintenance for every vehicle but fuel only for reserved ones', () => {
    const s = emptySite();
    const h = purchaseVehicle(s.vehicles, 'debris_hauler').vehicle;
    purchaseVehicle(s.vehicles, 'rock_digger');
    const hDef = getVehicleDefByTier('debris_hauler', 1);
    const dDef = getVehicleDefByTier('rock_digger', 1);
    let c = getOperatingCostPerHour(s);
    expect(c.vehicleMaintenance).toBe(hDef.maintenanceCostPerTick + dDef.maintenanceCostPerTick);
    expect(c.fuel).toBe(0);
    reserveVehicle(s.vehicles, h.id, 7);
    c = getOperatingCostPerHour(s);
    expect(c.fuel).toBe(hDef.fuelCostPerTick);
  });

  it('total is the sum of the four parts', () => {
    const s = emptySite();
    const rng = new Random(1);
    hireEmployee(s.employees, 'blaster', rng);
    addBuilding(s, true);
    const v = purchaseVehicle(s.vehicles, 'drill_rig').vehicle;
    reserveVehicle(s.vehicles, v.id, 3);
    const c = getOperatingCostPerHour(s);
    expect(c.total).toBeCloseTo(c.payroll + c.buildings + c.vehicleMaintenance + c.fuel, 8);
    expect(c.payroll).toBeGreaterThan(0);
    expect(c.buildings).toBeGreaterThan(0);
    expect(c.vehicleMaintenance).toBeGreaterThan(0);
    expect(c.fuel).toBeGreaterThan(0);
  });

  it('buying a vehicle changes cost only by its maintenance', () => {
    const s = emptySite();
    addBuilding(s, true);
    const before = getOperatingCostPerHour(s);
    purchaseVehicle(s.vehicles, 'rock_fragmenter');
    const after = getOperatingCostPerHour(s);
    expect(after.total - before.total).toBeCloseTo(getVehicleDefByTier('rock_fragmenter', 1).maintenanceCostPerTick, 8);
    expect(after.payroll).toBe(before.payroll);
    expect(after.buildings).toBe(before.buildings);
  });
});

describe('getOperatingIncomePerHour', () => {
  it('is zero with no transactions', () => {
    expect(getOperatingIncomePerHour(createFinanceState(0), 100)).toBe(0);
  });

  it('averages sales and contracts income over the window span', () => {
    const f = createFinanceState(0);
    addIncome(f, 360, 'sales', 's', 90);
    addIncome(f, 360, 'contracts', 'c', 95);
    expect(getOperatingIncomePerHour(f, 100)).toBeCloseTo(720 / OPERATING_INCOME_WINDOW_TICKS, 5);
  });

  it('span is tickCount while the game is younger than the window', () => {
    const f = createFinanceState(0);
    addIncome(f, 240, 'sales', 's', 9);
    expect(getOperatingIncomePerHour(f, 10)).toBeCloseTo(24, 5);
  });

  it('span is at least one tick', () => {
    const f = createFinanceState(0);
    expect(getOperatingIncomePerHour(f, 0)).toBe(0);
    addIncome(f, 50, 'sales', 's', 0);
    expect(getOperatingIncomePerHour(f, 0)).toBeCloseTo(50, 5);
  });

  it('ignores non-operating income (bonus, refund, smuggling)', () => {
    const f = createFinanceState(0);
    addIncome(f, 1000, 'bonus', 'b', 95);
    addIncome(f, 1000, 'refund', 'r', 95);
    addIncome(f, 1000, 'smuggling', 'm', 95);
    expect(getOperatingIncomePerHour(f, 100)).toBe(0);
  });

  it('ignores expenses, including one-off purchases', () => {
    const f = createFinanceState(100000);
    addExpense(f, 35000, 'equipment', 'rig', 99);
    addExpense(f, 500, 'fuel', 'f', 99);
    expect(getOperatingIncomePerHour(f, 100)).toBe(0);
  });

  it('ignores income older than the window', () => {
    const f = createFinanceState(0);
    addIncome(f, 99999, 'sales', 'old', 1);
    expect(getOperatingIncomePerHour(f, 1000)).toBe(0);
  });

  it('honours an explicit window argument', () => {
    const f = createFinanceState(0);
    addIncome(f, 900, 'sales', 'older', 50);
    addIncome(f, 100, 'sales', 's', 98);
    expect(getOperatingIncomePerHour(f, 100, 10)).toBeCloseTo(10, 5);
  });
});

describe('getOperatingSummary', () => {
  it('bundles cost, trailing income and net', () => {
    const site = { ...emptySite(), finances: createFinanceState(0), tickCount: 100 };
    hireEmployee(site.employees, 'manager', new Random(1));
    addIncome(site.finances, 100, 'sales', 's', 99);
    const cost = getOperatingCostPerHour(site);
    const income = getOperatingIncomePerHour(site.finances, 100);
    const summary = getOperatingSummary(site);
    expect(summary.cost).toEqual(cost);
    expect(summary.income).toBe(income);
    expect(summary.net).toBeCloseTo(income - cost.total, 8);
  });
});

describe('getRunway', () => {
  it('is zero days with no cash', () => {
    expect(getRunway(0, 10, 0)).toEqual({ kind: 'days', days: 0 });
  });

  it('is zero days with negative cash while burning', () => {
    expect(getRunway(-50, 100, 10)).toEqual({ kind: 'days', days: 0 });
  });

  it('is sustainable with negative cash when income covers cost', () => {
    expect(getRunway(-50, 10, 100)).toEqual({ kind: 'sustainable' });
  });

  it('is sustainable when income covers cost', () => {
    expect(getRunway(1000, 10, 10)).toEqual({ kind: 'sustainable' });
    expect(getRunway(1000, 10, 25)).toEqual({ kind: 'sustainable' });
    expect(getRunway(1000, 0, 0)).toEqual({ kind: 'sustainable' });
  });

  it('counts days from cash over net burn per hour', () => {
    const r = getRunway(2400, 100, 0);
    expect(r.kind).toBe('days');
    if (r.kind === 'days') expect(r.days).toBeCloseTo(2400 / 100 / TICKS_PER_DAY, 8);
  });

  it('uses net burn (cost minus income)', () => {
    const r = getRunway(480, 100, 90);
    expect(r.kind).toBe('days');
    if (r.kind === 'days') expect(r.days).toBeCloseTo(480 / 10 / TICKS_PER_DAY, 8);
  });
});
