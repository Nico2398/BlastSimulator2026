// BlastSimulator2026 — AgentOccupancy (#1206)
// Generalizes the vehicle-only occupancy check the old Locomotion.ts had
// (isOccupiedByOtherVehicle/nextGridStep/handleOccupancyBlock — vehicle vs.
// vehicle, immediate next hop only) to every agent, foot or vehicle: without
// it, nothing stops two employees walking through each other. Unconditional
// (#1207) — every game builds and reconciles this index.
//
// One ground cell holds at most one occupant. `AgentOccupancy` is the single
// index of that relationship: cell -> occupant and occupant -> cell, kept in
// step with each other so both directions are O(1) rather than a scan over
// every employee/vehicle. Built lazily, once (`rebuildAgentOccupancy`), then
// reconciled each tick (`reconcileAgentOccupancy`): a liveness sweep releases
// holders that no longer exist and a registration sweep registers agents not
// yet held, so the live map holds what a rebuild from the same state would —
// save/load safe. Reconcile is therefore linear in agent count per tick; only
// the full rebuild is one-shot, never repeated per tick.

import type { GameState } from '../state/GameState.js';
import { isOccupyingHost } from '../entities/EmployeeLocomotion.js';

/** The two kinds of entity that can hold ground-cell occupancy — an employee on foot, or a vehicle. */
export type OccupantKind = 'employee' | 'vehicle';

/** An occupant identity: which kind of agent, and its own entity id (Employee.id or Vehicle.id). */
export interface Occupant {
  readonly kind: OccupantKind;
  readonly id: number;
}

/**
 * O(1) two-way index between ground cells and the single occupant holding
 * each one. Never rebuilt per tick — see this file's own header comment.
 */
export class AgentOccupancy {
  private readonly cellToOccupant = new Map<string, Occupant>();
  private readonly occupantToCell = new Map<string, { x: number; z: number }>();

  private static cellKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  private static occupantKey(occupant: Occupant): string {
    return `${occupant.kind}:${occupant.id}`;
  }

  /** The occupant currently holding (x, z), or null when the cell is free. */
  holderOf(x: number, z: number): Occupant | null {
    return this.cellToOccupant.get(AgentOccupancy.cellKey(x, z)) ?? null;
  }

  /** Whether (x, z) is free for `requester` — free outright, or already held by `requester` itself. */
  isFreeFor(requester: Occupant, x: number, z: number): boolean {
    const holder = this.holderOf(x, z);
    if (holder === null) return true;
    return holder.kind === requester.kind && holder.id === requester.id;
  }

  /** The cell `occupant` currently holds, or null when it holds none. */
  cellOfOccupant(occupant: Occupant): { x: number; z: number } | null {
    return this.occupantToCell.get(AgentOccupancy.occupantKey(occupant)) ?? null;
  }

  /** Attempts to move `occupant` onto (x, z): releases its prior cell and claims the new one iff it was free. Returns whether the move was granted. */
  tryMove(occupant: Occupant, x: number, z: number): boolean {
    if (!this.isFreeFor(occupant, x, z)) return false;

    this.release(occupant);
    this.cellToOccupant.set(AgentOccupancy.cellKey(x, z), occupant);
    this.occupantToCell.set(AgentOccupancy.occupantKey(occupant), { x, z });
    return true;
  }

  /** Releases whatever cell `occupant` currently holds. No-op when it holds none. */
  release(occupant: Occupant): void {
    const occupantKey = AgentOccupancy.occupantKey(occupant);
    const cell = this.occupantToCell.get(occupantKey);
    if (cell === undefined) return;

    this.occupantToCell.delete(occupantKey);
    this.cellToOccupant.delete(AgentOccupancy.cellKey(cell.x, cell.z));
  }

  /**
   * Every occupant currently holding a cell, with the cell it holds — used
   * only by `reconcileAgentOccupancy`'s liveness sweep below. One pass over
   * the held set, not the whole grid.
   */
  heldOccupants(): Array<{ occupant: Occupant; x: number; z: number }> {
    const out: Array<{ occupant: Occupant; x: number; z: number }> = [];
    for (const [key, occupant] of this.cellToOccupant) {
      const commaIndex = key.indexOf(',');
      out.push({ occupant, x: Number(key.slice(0, commaIndex)), z: Number(key.slice(commaIndex + 1)) });
    }
    return out;
  }
}

/**
 * Builds a fresh `AgentOccupancy` from every alive employee's and every live
 * vehicle's current position in `state`. Called once per tick batch, never
 * per tick — see this file's own header comment. An employee mounted in a
 * vehicle or inside a building holds no cell of their own — their vehicle (if
 * any) already claims one, and a building has its own separate ring/interior
 * model.
 */
export function rebuildAgentOccupancy(state: GameState): AgentOccupancy {
  const occupancy = new AgentOccupancy();
  registerUnheldAgents(state, occupancy);
  return occupancy;
}

/**
 * Claims the ground cell (Math.round of x/z, first claim wins: on-foot alive
 * employees, then vehicles) for every agent `occupancy` does not already
 * hold. The one claim order shared by rebuild and reconcile.
 */
function registerUnheldAgents(state: GameState, occupancy: AgentOccupancy): void {
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (isOccupyingHost(emp.locomotion)) continue;
    if (occupancy.cellOfOccupant({ kind: 'employee', id: emp.id }) !== null) continue;
    occupancy.tryMove({ kind: 'employee', id: emp.id }, Math.round(emp.x), Math.round(emp.z));
  }

  for (const vehicle of state.vehicles.vehicles) {
    if (occupancy.cellOfOccupant({ kind: 'vehicle', id: vehicle.id }) !== null) continue;
    occupancy.tryMove({ kind: 'vehicle', id: vehicle.id }, Math.round(vehicle.x), Math.round(vehicle.z));
  }
}

/**
 * Reconciles `occupancy` against `state`'s current agent positions after a
 * batch of moves — incremental upkeep, not a rebuild (see this file's own
 * header comment on the cost distinction). Releases any holder whose entity
 * no longer exists (a destroyed vehicle) or is no longer alive (a dead
 * employee). Alive-employee-id/vehicle-id sets are built once so this stays
 * linear in agent count rather than an O(held × employees) scan.
 */
export function reconcileAgentOccupancy(state: GameState, occupancy: AgentOccupancy): void {
  const aliveEmployeeIds = new Set<number>();
  for (const emp of state.employees.employees) {
    if (emp.alive) aliveEmployeeIds.add(emp.id);
  }
  const vehicleIds = new Set<number>();
  for (const vehicle of state.vehicles.vehicles) {
    vehicleIds.add(vehicle.id);
  }

  for (const held of occupancy.heldOccupants()) {
    const exists = held.occupant.kind === 'employee'
      ? aliveEmployeeIds.has(held.occupant.id)
      : vehicleIds.has(held.occupant.id);
    if (!exists) occupancy.release(held.occupant);
  }

  registerUnheldAgents(state, occupancy);
}
