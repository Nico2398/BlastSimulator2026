// BlastSimulator2026 — AgentOccupancy (#1206)
// Generalizes the vehicle-only occupancy check (Locomotion.ts's
// isOccupiedByOtherVehicle/nextGridStep/handleOccupancyBlock — vehicle vs.
// vehicle, immediate next hop only) to every agent, foot or vehicle: nothing
// today stops two employees walking through each other. Lands switched off
// by default (GameState.agentOccupancyEnabled, AGENT_OCCUPANCY_ENABLED_DEFAULT
// in balance.ts) — #1207 turns it on.
//
// One ground cell holds at most one occupant. `AgentOccupancy` is the single
// index of that relationship: cell -> occupant and occupant -> cell, kept in
// step with each other so both directions are O(1) rather than a scan over
// every employee/vehicle. Built once per tick batch (`rebuildAgentOccupancy`)
// and reconciled incrementally as movement resolves (`reconcileAgentOccupancy`)
// — never rebuilt from scratch per tick, which would make its cost scale with
// total agent count on every single step instead of with the moves actually
// made this tick.

import type { GameState } from '../state/GameState.js';

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
  /** The occupant currently holding (x, z), or null when the cell is free. */
  holderOf(_x: number, _z: number): Occupant | null {
    throw new Error('not implemented');
  }

  /** Whether (x, z) is free for `requester` — free outright, or already held by `requester` itself. */
  isFreeFor(_requester: Occupant, _x: number, _z: number): boolean {
    throw new Error('not implemented');
  }

  /** The cell `occupant` currently holds, or null when it holds none. */
  cellOfOccupant(_occupant: Occupant): { x: number; z: number } | null {
    throw new Error('not implemented');
  }

  /** Attempts to move `occupant` onto (x, z): releases its prior cell and claims the new one iff it was free. Returns whether the move was granted. */
  tryMove(_occupant: Occupant, _x: number, _z: number): boolean {
    throw new Error('not implemented');
  }

  /** Releases whatever cell `occupant` currently holds. No-op when it holds none. */
  release(_occupant: Occupant): void {
    throw new Error('not implemented');
  }
}

/**
 * Builds a fresh `AgentOccupancy` from every alive employee's and every live
 * vehicle's current position in `state`. Called once per tick batch, never
 * per tick — see this file's own header comment.
 */
export function rebuildAgentOccupancy(_state: GameState): AgentOccupancy {
  throw new Error('not implemented');
}

/**
 * Reconciles `occupancy` against `state`'s current agent positions after a
 * batch of moves — incremental upkeep, not a rebuild (see this file's own
 * header comment on the cost distinction).
 */
export function reconcileAgentOccupancy(_state: GameState, _occupancy: AgentOccupancy): void {
  throw new Error('not implemented');
}
