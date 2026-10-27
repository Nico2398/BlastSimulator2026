// BlastSimulator2026 — Crew cut off from the site (#2095)
// Read-only: names what a blast or an unfinished ramp cut off from the crew, so the player can be told.
// Nothing here moves anyone. Getting them back (a ramp, a cleared path) is the player's job.

import type { GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { canDriveTier } from '../entities/VehicleDriverAssignment.js';
import type { ClimbComponents } from '../nav/NavGridReachability.js';
import { employeeClimbReach } from './OrderReachability.js';

/** Ids of what is cut off from the crew, lowest id first. */
export interface StrandedCrew {
  /** Driverless vehicles no employee licensed for them can walk to. */
  vehicleIds: number[];
  /** On-foot employees outside the largest group of employees that reach one another on foot. */
  employeeIds: number[];
}

/** Groups the alive employees by on-foot reach; the largest group comes first. */
function crewGroups(climb: ClimbComponents, employees: ReadonlyArray<Employee>): Employee[][] {
  const groups: Employee[][] = [];
  for (const emp of employees) {
    const group = groups.find(g => climb.canReach(g[0]!.x, g[0]!.z, emp.x, emp.z));
    if (group === undefined) groups.push([emp]);
    else group.push(emp);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/**
 * What is cut off from the crew right now. A vehicle with someone aboard, a mounted or building-bound
 * employee, and a vehicle nobody on the roster is licensed to drive are never listed: the first two
 * move with their vehicle or building, the last is a hiring problem, not a way-in problem.
 */
export function findStrandedCrew(state: GameState): StrandedCrew {
  const climb = employeeClimbReach(state);
  if (climb === null) return { vehicleIds: [], employeeIds: [] };
  const alive = state.employees.employees.filter(e => e.alive);
  const [, ...rest] = crewGroups(climb, alive);
  const employeeIds = rest.flat().filter(e => e.locomotion.kind === 'on_foot').map(e => e.id).sort((a, b) => a - b);
  const vehicleIds: number[] = [];
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.occupantIds.length > 0) continue;
    const drivers = alive.filter(e => canDriveTier(e, vehicle.type, vehicle.tier));
    if (drivers.length === 0) continue;
    if (!climb.reachableFrom(drivers).has(Math.round(vehicle.x), Math.round(vehicle.z))) vehicleIds.push(vehicle.id);
  }
  return { vehicleIds: vehicleIds.sort((a, b) => a - b), employeeIds };
}
