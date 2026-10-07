import type { EmployeeState } from '../entities/Employee.js';
import type { BuildingState } from '../entities/Building.js';
import type { VehicleState } from '../entities/Vehicle.js';
import type { FinanceState } from './Finance.js';

/** Recurring operating cost, all values in $/hour. */
export interface OperatingCostBreakdown {
  payroll: number;
  buildings: number;
  vehicleMaintenance: number;
  fuel: number;
  total: number;
}

export type Runway = { kind: 'sustainable' } | { kind: 'days'; days: number };

export function getOperatingCostPerHour(_s: {
  employees: EmployeeState;
  buildings: BuildingState;
  vehicles: VehicleState;
}): OperatingCostBreakdown {
  // TODO: implement
  return { payroll: 0, buildings: 0, vehicleMaintenance: 0, fuel: 0, total: 0 };
}

export function getOperatingIncomePerHour(_f: FinanceState, _nowTick: number, _windowTicks?: number): number {
  // TODO: implement
  return 0;
}

export function getOperatingNetPerHour(_income: number, _cost: number): number {
  // TODO: implement
  return 0;
}

export function getRunway(_cash: number, _costPerHour: number, _incomePerHour: number): Runway {
  // TODO: implement
  return { kind: 'sustainable' };
}
