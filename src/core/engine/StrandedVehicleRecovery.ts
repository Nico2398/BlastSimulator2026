// BlastSimulator2026 — Stranded recovery (#2085)
// A driverless vehicle that no employee licensed for it can walk to cannot be boarded. When it is the only
// digger on ground a blast cut off, the ramp that would free it can never be dug (fillPool, OrderReachability,
// counts a vehicle as an actor only when a candidate driver reaches it). After a grace period it is towed to
// the licensed crew. A worker walled off from the rest of the crew the same way is walked back to it: left
// in a cut-off pit, he also keeps the blast zone from ever reading clear, which holds every haul order.

import { CREW_SPAWN_SEARCH_RADIUS, CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS, CREW_SPAWN_VEHICLE_SEPARATION, NAV_CLEARANCE_VEHICLE_CELLS, STRANDED_RECOVERY_TICKS } from '../config/balance.js';
import { hasClearance, isCellOccupied } from '../nav/NavGrid.js';
import { countLegalStepNeighbours, type ClimbComponents } from '../nav/NavGridReachability.js';
import { isProgressionSite, type GameState } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { canDriveTier } from '../entities/VehicleDriverAssignment.js';
import { updateVehicleCellOccupancy } from './EntityMovementTick.js';
import { employeeClimbReach } from './OrderReachability.js';

type Cell = { x: number; z: number };

/** First tick each entity (`v<id>` vehicle, `e<id>` employee) was seen stranded, per state; one that is connected again loses its clock. */
const firstSeen = new WeakMap<GameState, Map<string, number>>();

const squaredDistance = (a: Cell, b: Cell): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** Nearest cell to `anchor` (rings of growing radius) that `has` says is reachable and `free` accepts; null when none within the search radius. */
function nearestFreeCell(
  state: GameState,
  anchor: Cell,
  has: (x: number, z: number) => boolean,
  free: (x: number, z: number) => boolean,
): Cell | null {
  const nav = state.navGrid;
  if (nav === null) return null;
  const ax = Math.round(anchor.x);
  const az = Math.round(anchor.z);
  for (let radius = 0; radius <= CREW_SPAWN_SEARCH_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = ax + dx;
        const z = az + dz;
        const cell = nav.cellAt(x, z);
        if (cell != null && has(x, z) && !isCellOccupied(cell) && free(x, z)) return { x, z };
      }
    }
  }
  return null;
}

/** True once `key` has been stranded for STRANDED_RECOVERY_TICKS; starts its clock on first sight. */
function strandedLongEnough(clocks: Map<string, number>, seen: Set<string>, key: string, tick: number): boolean {
  seen.add(key);
  const since = clocks.get(key) ?? tick;
  clocks.set(key, since);
  return tick - since >= STRANDED_RECOVERY_TICKS;
}

/** Tows a driverless vehicle no licensed employee can walk to beside the nearest licensed member of the main crew. */
function recoverVehicles(state: GameState, climb: ClimbComponents, mainCrew: ReadonlyArray<Employee>, clocks: Map<string, number>, seen: Set<string>): void {
  const nav = state.navGrid!;
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.occupantIds.length > 0) continue;
    const licensed = (e: Employee): boolean => e.alive && canDriveTier(e, vehicle.type, vehicle.tier);
    const crew = state.employees.employees.filter(licensed);
    const crewReach = climb.reachableFrom(crew);
    if (crew.length === 0 || crewReach.has(Math.round(vehicle.x), Math.round(vehicle.z))) continue;
    const key = `v${vehicle.id}`;
    if (!strandedLongEnough(clocks, seen, key, state.tickCount)) continue;
    const anchors = mainCrew.filter(licensed);
    if (anchors.length === 0) continue;
    const anchor = anchors.reduce((best, e) => (squaredDistance(e, vehicle) < squaredDistance(best, vehicle) ? e : best));
    const others = state.vehicles.vehicles.filter(o => o !== vehicle);
    // Roomy ground only: a vehicle set down on a thin strip can be sealed in by one building corner.
    const target = nearestFreeCell(state, anchor, (x, z) => crewReach.has(x, z), (x, z) =>
      hasClearance(nav.cellAt(x, z), NAV_CLEARANCE_VEHICLE_CELLS)
      && countLegalStepNeighbours(nav, x, z, NAV_CLEARANCE_VEHICLE_CELLS) >= CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS
      && others.every(o => Math.max(Math.abs(Math.round(o.x) - x), Math.abs(Math.round(o.z) - z)) >= CREW_SPAWN_VEHICLE_SEPARATION));
    if (target === null) continue;
    const prevX = Math.round(vehicle.x);
    const prevZ = Math.round(vehicle.z);
    vehicle.x = target.x;
    vehicle.z = target.z;
    updateVehicleCellOccupancy(state, vehicle, true, true, prevX, prevZ);
    clocks.delete(key);
    seen.delete(key);
  }
}

/** Groups the on-foot-reachable employees; the largest group is the main crew. */
function crewGroups(climb: ClimbComponents, employees: ReadonlyArray<Employee>): Employee[][] {
  const groups: Employee[][] = [];
  for (const emp of employees) {
    const group = groups.find(g => climb.canReach(g[0]!.x, g[0]!.z, emp.x, emp.z));
    if (group === undefined) groups.push([emp]);
    else group.push(emp);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/** Walks every on-foot employee outside the largest reachable group of employees back beside it; returns that main group. */
function recoverEmployees(state: GameState, climb: ClimbComponents, clocks: Map<string, number>, seen: Set<string>): Employee[] {
  const crew = state.employees.employees.filter(e => e.alive);
  const [main = [], ...rest] = crewGroups(climb, crew);
  if (main.length === 0) return main;
  const mainReach = climb.reachableFrom(main);
  for (const emp of rest.flat()) {
    if (emp.locomotion.kind !== 'on_foot') continue;
    const key = `e${emp.id}`;
    if (!strandedLongEnough(clocks, seen, key, state.tickCount)) continue;
    const anchor = main.reduce((best, e) => (squaredDistance(e, emp) < squaredDistance(best, emp) ? e : best));
    const target = nearestFreeCell(state, anchor, (x, z) => mainReach.has(x, z), () => true);
    if (target === null) continue;
    emp.x = target.x;
    emp.z = target.z;
    emp.isMoveStuck = false;
    emp.moveConsecutiveFailures = 0;
    clocks.delete(key);
    seen.delete(key);
  }
  return main;
}

/**
 * Brings back whatever a blast or an unfinished ramp cut off from the crew for STRANDED_RECOVERY_TICKS:
 * a driverless vehicle no licensed employee can walk to is towed beside the nearest licensed one; an
 * on-foot employee outside the largest group of mutually reachable employees is walked to the nearest free
 * cell beside it. Progression sites only; never touches a mounted or building-bound employee, or a vehicle
 * with anyone aboard.
 */
export function recoverStranded(state: GameState): void {
  const climb = employeeClimbReach(state);
  if (climb === null || !isProgressionSite(state)) return;
  const clocks = firstSeen.get(state) ?? new Map<string, number>();
  firstSeen.set(state, clocks);
  const seen = new Set<string>();
  const mainCrew = recoverEmployees(state, climb, clocks, seen);
  recoverVehicles(state, climb, mainCrew, clocks, seen);
  for (const key of [...clocks.keys()]) if (!seen.has(key)) clocks.delete(key);
}
