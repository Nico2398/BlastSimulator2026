// BlastSimulator2026 — Employee system
// Workers with roles, morale, union status, and injury tracking.

import { Random } from '../math/Random.js';
import type { NeedKey } from './EmployeeNeeds.js';
import type { ActionType } from '../state/GameState.js';
import { HIRING_COSTS as _HIRING_COSTS, BASE_SALARIES as _BASE_SALARIES, PAY_CYCLE_TICKS as _PAY_CYCLE_TICKS, QUALIFICATION_SALARY_BONUS } from '../config/balance.js';

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

// ── Skills & Training ──

export type SkillCategory =
  | 'driving.truck'
  | 'driving.excavator'
  | 'driving.drill_rig'
  | 'blasting'
  | 'management'
  | 'geology';

/**
 * The qualification each role arrives with, at Rookie level.
 *
 * `driver` gets the truck licence; excavator and drill-rig licences are raised
 * through training rather than hiring.
 */
export const ROLE_STARTING_QUALIFICATION: Record<EmployeeRole, SkillCategory> = {
  surveyor: 'geology',
  driller: 'blasting',
  blaster: 'blasting',
  driver: 'driving.truck',
  manager: 'management',
};

export interface SkillQualification {
  category: SkillCategory;
  proficiencyLevel: 1 | 2 | 3 | 4 | 5;
  xp: number;
}

export interface TrainingState {
  buildingId: number;
  skill: SkillCategory;
  ticksRemaining: number;
  fee: number;
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
  /** Tick this employee was hired at, for the Crew panel's "hired since" line. Optional: many existing call sites construct an Employee directly without it, and old saves predate the field — the UI falls back to an "unknown" label when absent. */
  hiredAtTick?: number;
  /** Grid position. */
  x: number;
  z: number;
  qualifications: SkillQualification[];
  trainingState: TrainingState | null;
  /** ID of the PendingAction currently claimed by this employee, or null if idle. */
  activeActionId: number | null;
  hunger: number;    // 0-100
  fatigue: number;   // 0-100
  breakNeed: number; // 0-100
  collapsing: boolean;
  interruptedActionPayload: Record<string, unknown> | null;
  /** Number of ticks the employee has worked in the current shift. */
  ticksWorked: number;
  /** Ticks of rest remaining when employee is in bunkhouse rest mode, or null if not resting. */
  restTicksRemaining: number | null;
  /** Ticks remaining on the employee's currently dispatched task, or null if no task is in progress. */
  taskTicksRemaining: number | null;
  /**
   * Total ticks the in-progress task was assigned at claim (mirrors
   * taskTicksRemaining's lifecycle: set together on arrival, cleared together
   * on completion) — the Crew panel's task progress bar needs both the
   * remaining and the original total to show a real percentage; remaining
   * alone can only count down. Optional: many existing call sites construct
   * an Employee directly without it, and old saves predate the field — the
   * UI omits the progress bar when absent instead of fabricating one.
   */
  activeTaskTotalTicks?: number;
  /**
   * Skill category of the in-progress dispatched task (mirrors taskTicksRemaining
   * lifecycle: set together on claim, cleared together on completion). Null when
   * no task is in progress, or when the in-progress task required no skill.
   */
  activeTaskSkill: SkillCategory | null;
  /**
   * Which need gauge the in-progress rest is restoring, or null when the
   * employee is not resting or is resting under the Bunkhouse Tier 2+ shift
   * cycle (which processShiftCycle owns end to end). Set alongside
   * restTicksRemaining and cleared with it — the two are the rest's whole
   * state, and the key decides which completion path owns the employee.
   */
  restNeedKey: NeedKey | null;
  /**
   * Grid position the employee is currently walking toward (set from a claimed
   * PendingAction's targetX/targetZ, or a self-claimed rest action's building
   * location), or null when the employee has nowhere to walk. Consumed by
   * tickEmployeeMovement in EntityMovementTick.ts — cleared on arrival.
   */
  destinationX: number | null;
  destinationZ: number | null;
  /** Consecutive ticks tickEmployeeMovement failed to find a path to destinationX/Z. */
  moveConsecutiveFailures: number;
  /** True once moveConsecutiveFailures reaches STUCK_THRESHOLD — idle, morale −2/tick until the path clears. */
  isMoveStuck: boolean;
  /**
   * Rest duration (ticks) to start once the employee arrives at the rest
   * destination, or null when no rest arrival is pending. Set alongside
   * destinationX/destinationZ by the claim step; consumed by
   * ArrivalGate.tickArrivalGate on arrival, which moves it into
   * restTicksRemaining.
   */
  pendingRestDuration: number | null;
  /** Need gauge the pending rest (above) will restore, or null. */
  pendingRestNeedKey: NeedKey | null;
  /**
   * Task duration (ticks) to start once the employee arrives at the task
   * destination, or null when no task arrival is pending. Consumed by
   * ArrivalGate.tickArrivalGate on arrival, which moves it into
   * taskTicksRemaining.
   */
  pendingTaskDuration: number | null;
  /** Action type of the pending task-on-arrival (above), or null. */
  pendingActionType: ActionType | null;
  /** Free-form payload for the pending task-on-arrival (above), or null. */
  pendingActionPayload: Record<string, unknown> | null;
  /**
   * Vehicle ID the employee has requested to board once they arrive at its
   * position, or null when no boarding is pending. Consumed by
   * ArrivalGate.tickArrivalGate on arrival.
   */
  pendingDriverVehicleId: number | null;
  /**
   * IDs of PendingActions queued for this employee beyond the one currently
   * claimed (#549 cost-based dispatch), bounded by
   * MAX_EMPLOYEE_TASK_QUEUE_DEPTH. Executed in cheapest-next order,
   * recomputed from the employee's current position — ordering is not fixed
   * at enqueue time. Empty when the employee has no queued follow-up work.
   */
  taskQueue: number[];
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
  tickCount: number = 0,
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
    hiredAtTick: tickCount,
    x, z,
    // A hire arrives qualified for the job they were hired to do, at Rookie
    // level. Hiring used to grant nothing, which made every role interchangeable
    // and every skill-gated action unreachable: a surveyor could not survey and
    // a driver could not drive, because the only way to grant a qualification
    // was the `employee assign_skill` console command. Training raises
    // proficiency from here.
    qualifications: [{ category: ROLE_STARTING_QUALIFICATION[role], proficiencyLevel: 1, xp: 0 }],
    trainingState: null,
    activeActionId: null,
    hunger: 100,
    fatigue: 100,
    breakNeed: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    restNeedKey: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    taskQueue: [],
  };
  // Keep the stored salary consistent with the qualification just granted —
  // calculateSalary() sums qualification bonuses, so a base-only salary would
  // disagree with it from the moment of hire.
  employee.salary = calculateSalary(employee);

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

/** Calculate the total salary for an employee: base salary + sum of qualification bonuses. */
export function calculateSalary(employee: Employee): number {
  return BASE_SALARIES[employee.role] +
    employee.qualifications.reduce((sum, q) => sum + QUALIFICATION_SALARY_BONUS[q.proficiencyLevel], 0);
}

/**
 * The living roster — every employee still `alive`. Shared filter for any
 * aggregate/threshold computed over the roster (headcount-style stats,
 * event-eligibility gates, living-quarters capacity) so a death doesn't
 * silently skew it — see computeAverageMorale's own doc comment above for
 * the shape of the bug this closes. `killEmployee` never splices
 * `employees` (only `fireEmployee` does), so a corpse's frozen fields stay
 * in the array forever unless the reader excludes them explicitly.
 */
export function getLivingEmployees(employees: readonly Employee[]): Employee[] {
  return employees.filter(e => e.alive);
}

/**
 * Average morale across the LIVING roster, for feeding ScoreManager's
 * wellBeing input. A dead employee is never spliced from `employees` (only
 * fireEmployee does that — killEmployee just sets alive:false, same as
 * processPayCycle already treats above), so an unfiltered average keeps
 * counting a corpse's morale, frozen at whatever it was the instant they
 * died, forever after — permanently depressing wellBeing even once the rest
 * of a fully-recovered crew is back at 100 morale, with no way to ever clear
 * it (no UI control fires a dead employee; there is nothing to click).
 * Defaults to the neutral 50 when nobody is alive, matching the pre-hire
 * zero-employee default the caller already relied on.
 */
export function computeAverageMorale(employees: readonly Employee[]): number {
  const living = getLivingEmployees(employees);
  if (living.length === 0) return 50;
  return living.reduce((sum, e) => sum + e.morale, 0) / living.length;
}

/** Get effectiveness multiplier based on morale (0.5–1.2). */
export function getEffectiveness(employee: Employee): number {
  if (employee.injured || !employee.alive || employee.collapsing) return 0;
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
// ── Skill & Training functions ──

/** Add or replace a qualification for an employee. Returns false if employee not found. */
export function assignSkill(
  state: EmployeeState,
  employeeId: number,
  category: SkillCategory,
  level: 1 | 2 | 3 | 4 | 5,
): boolean {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return false;

  const idx = emp.qualifications.findIndex(q => q.category === category);
  const qual: SkillQualification = { category, proficiencyLevel: level, xp: 0 };
  if (idx >= 0) {
    emp.qualifications[idx] = qual;
  } else {
    emp.qualifications.push(qual);
  }
  emp.salary = calculateSalary(emp);
  return true;
}

export type { GainXpResult } from './EmployeeGainXp.js';
export { gainXp } from './EmployeeGainXp.js';
export type { NeedKey } from './EmployeeNeeds.js';
export { tickNeeds, tickNeedGauges, getNeedMultiplier, tickNeedMorale, replenishNeed, needsMoraleEffect, checkCollapse } from './EmployeeNeeds.js';
export { computeTaskDuration } from './EmployeeTaskDuration.js';
export type {
  ProficiencyLevel, TrainingPlan, StartTrainingResult, TrainingCompletion,
} from './EmployeeTraining.js';
export {
  MAX_PROFICIENCY, trainableSkills, isTrainingBuilding, schoolFor,
  planTraining, startTraining, enrolInTraining, tickTraining,
} from './EmployeeTraining.js';
