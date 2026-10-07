import type { EmployeeState } from '../entities/Employee.js';
import { getLivingEmployees } from '../entities/Employee.js';
import type { BuildingState } from '../entities/Building.js';
import { getTotalOperatingCost } from '../entities/Building.js';
import type { VehicleState } from '../entities/Vehicle.js';
import { getVehicleMaintenanceCostPerTick, getVehicleFuelCostPerTick } from '../entities/Vehicle.js';
import type { FinanceState } from './Finance.js';
import {
  OPERATING_INCOME_CATEGORIES,
  OPERATING_INCOME_WINDOW_TICKS,
  PAY_CYCLE_TICKS,
  TICKS_PER_DAY,
} from '../config/balance.js';

/** Recurring operating cost, all values in $/hour. */
export interface OperatingCostBreakdown {
  payroll: number;
  buildings: number;
  vehicleMaintenance: number;
  fuel: number;
  total: number;
}

type Runway = { kind: 'sustainable' } | { kind: 'days'; days: number };

/** Recurring cost per hour (1 tick = 1 hour): payroll amortised over the pay cycle, upkeep, maintenance, fuel. */
export function getOperatingCostPerHour(s: {
  employees: EmployeeState;
  buildings: BuildingState;
  vehicles: VehicleState;
}): OperatingCostBreakdown {
  let salaries = 0;
  for (const e of getLivingEmployees(s.employees.employees)) salaries += e.salary;
  const payroll = salaries / PAY_CYCLE_TICKS;
  const buildings = getTotalOperatingCost(s.buildings);
  const vehicleMaintenance = getVehicleMaintenanceCostPerTick(s.vehicles);
  const fuel = getVehicleFuelCostPerTick(s.vehicles);
  return { payroll, buildings, vehicleMaintenance, fuel, total: payroll + buildings + vehicleMaintenance + fuel };
}

/** Operating income per hour averaged over the trailing window (sales + contracts). */
export function getOperatingIncomePerHour(
  f: FinanceState,
  nowTick: number,
  windowTicks: number = OPERATING_INCOME_WINDOW_TICKS,
): number {
  const from = nowTick - windowTicks;
  let sum = 0;
  for (let i = f.transactions.length - 1; i >= 0; i--) {
    const t = f.transactions[i]!;
    if (t.tick <= from) break;
    if (t.type === 'income' && (OPERATING_INCOME_CATEGORIES as readonly string[]).includes(t.category)) {
      sum += t.amount;
    }
  }
  return sum / Math.max(1, Math.min(windowTicks, nowTick));
}

export function getOperatingNetPerHour(income: number, cost: number): number {
  return income - cost;
}

export function getRunway(cash: number, costPerHour: number, incomePerHour: number): Runway {
  if (cash <= 0) return { kind: 'days', days: 0 };
  const burn = costPerHour - incomePerHour;
  if (burn <= 0) return { kind: 'sustainable' };
  return { kind: 'days', days: cash / burn / TICKS_PER_DAY };
}
