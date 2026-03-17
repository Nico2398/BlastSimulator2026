// BlastSimulator2026 — Employee system
// Workers with roles, morale, union status, and injury tracking.

import { Random } from '../math/Random.js';
import { HIRING_COSTS as _HIRING_COSTS, BASE_SALARIES as _BASE_SALARIES, PAY_CYCLE_TICKS as _PAY_CYCLE_TICKS } from '../config/balance.js';

// ── Roles ──

export type EmployeeRole = 'driller' | 'blaster' | 'driver' | 'surveyor' | 'manager';

// ── Config (imported from centralized balance) ──

/** Hiring cost by role ($). */
const HIRING_COSTS: Record<EmployeeRole, number> = { ..._HIRING_COSTS };

/** Base salary per pay cycle by role ($). */
const BASE_SALARIES: Record<EmployeeRole, number> = { ..._BASE_SALARIES };

/** Ticks between pay cycles. */
export const PAY_CYCLE_TICKS = _PAY_CYCLE_TICKS;

// ── Name generation ──

const FIRST_NAMES = [
  'Bob', 'Chuck', 'Dave', 'Earl', 'Frank',
  'Gus', 'Hank', 'Ivan', 'Jake', 'Kurt',
  'Lars', 'Mike', 'Nick', 'Otto', 'Pete',
  'Rick', 'Stan', 'Tony', 'Vic', 'Walt',
];

const LAST_NAMES = [
  'Blaster', 'Diggins', 'McBoom', 'Rockwell', 'Gravel',
  'Dusty', 'Crater', 'Boulder', 'Rubble', 'Miner',
  'Stoneface', 'Hardhat', 'Pickaxe', 'Dynamite', 'Shale',
  'Quartzman', 'Slagheap', 'Bedrock', 'Pitman', 'Drillbit',
];

function generateName(rng: Random): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

// ── Employee instance ──

export interface Employee {
  id: number;
  name: string;
  role: EmployeeRole;
  salary: number;
  morale: number; // 0-100
  unionized: boolean;
  injured: boolean;
  alive: boolean;
  /** Grid position. */
  x: number;
  z: number;
}

// ── Employee state ──

export interface EmployeeState {
  employees: Employee[];
  nextId: number;
  /** Ticks since last pay cycle. */
  ticksSincePayday: number;
}

export function createEmployeeState(): EmployeeState {
  return { employees: [], nextId: 1, ticksSincePayday: 0 };
}

// ── Operations ──

export interface HireResult {
  employee: Employee;
  hiringCost: number;
}

/** Hire a new employee. */
export function hireEmployee(
  state: EmployeeState,
  role: EmployeeRole,
  rng: Random,
  x: number = 0,
  z: number = 0,
): HireResult {
  const employee: Employee = {
    id: state.nextId++,
    name: generateName(rng),
    role,
    salary: BASE_SALARIES[role],
    morale: 60, // Neutral-positive starting morale
    unionized: rng.chance(0.3), // 30% chance of being unionized
    injured: false,
    alive: true,
    x, z,
  };
  state.employees.push(employee);
  return { employee, hiringCost: HIRING_COSTS[role] };
}

/** Give an employee a raise. Increases salary and morale. */
export function giveRaise(
  state: EmployeeState,
  employeeId: number,
  amount: number,
): boolean {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) return false;

  emp.salary += amount;
  // Morale boost proportional to raise relative to current salary
  const moraleBoost = Math.min(20, Math.round((amount / emp.salary) * 50));
  emp.morale = Math.min(100, emp.morale + moraleBoost);
  return true;
}

/** Fire an employee. Returns error if unionized. */
export function fireEmployee(
  state: EmployeeState,
  employeeId: number,
): { success: boolean; error?: string } {
  const idx = state.employees.findIndex(e => e.id === employeeId);
  if (idx < 0) return { success: false, error: 'Employee not found' };

  const emp = state.employees[idx]!;
  if (emp.unionized) {
    return { success: false, error: 'Cannot fire unionized employee' };
  }

  state.employees.splice(idx, 1);
  return { success: true };
}

/**
 * Process pay cycle. Returns total salaries paid.
 * Call each tick; only pays when cycle completes.
 */
export function processPayCycle(state: EmployeeState): number {
  state.ticksSincePayday++;
  if (state.ticksSincePayday < PAY_CYCLE_TICKS) return 0;

  state.ticksSincePayday = 0;
  let totalSalaries = 0;
  for (const emp of state.employees) {
    if (emp.alive) {
      totalSalaries += emp.salary;
    }
  }
  return totalSalaries;
}

/** Get effectiveness multiplier based on morale (0.5–1.2). */
export function getEffectiveness(employee: Employee): number {
  if (employee.injured || !employee.alive) return 0;
  // Linear scale: morale 0 → 0.5, morale 100 → 1.2
  return 0.5 + (employee.morale / 100) * 0.7;
}

/** Injure an employee. */
export function injureEmployee(state: EmployeeState, employeeId: number): boolean {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) return false;
  emp.injured = true;
  emp.morale = Math.max(0, emp.morale - 20);
  return true;
}

/** Heal an employee. */
export function healEmployee(state: EmployeeState, employeeId: number): boolean {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) return false;
  emp.injured = false;
  return true;
}

/** Kill an employee. */
export function killEmployee(state: EmployeeState, employeeId: number): boolean {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) return false;
  emp.alive = false;
  emp.injured = false;
  return true;
}

export { HIRING_COSTS, BASE_SALARIES };
