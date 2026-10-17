// BlastSimulator2026 — Tests for AgentOccupancy (src/core/nav/AgentOccupancy.ts, #1206)
//
// Generalizes the vehicle-only occupancy check (Locomotion.ts's
// isOccupiedByOtherVehicle/nextGridStep/handleOccupancyBlock — vehicle vs.
// vehicle, immediate next hop only) to every agent, foot or vehicle: one
// ground cell holds at most one occupant, tracked by this O(1) two-way index.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { hireEmployee, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { board, alight } from '../../../src/core/engine/Mount.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import {
  AgentOccupancy,
  rebuildAgentOccupancy,
  reconcileAgentOccupancy,
  type Occupant,
  type OccupantKind,
} from '../../../src/core/nav/AgentOccupancy.js';

const SEED = 42;

function emp(id: number): Occupant {
  const kind: OccupantKind = 'employee';
  return { kind, id };
}

function vehicle(id: number): Occupant {
  return { kind: 'vehicle', id };
}

describe('AgentOccupancy', () => {
  describe('tryMove', () => {
    it('claims a free cell for a fresh occupant', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);

      const granted = occupancy.tryMove(a, 3, 4);

      expect(granted).toBe(true);
      expect(occupancy.holderOf(3, 4)).toEqual(a);
      expect(occupancy.cellOfOccupant(a)).toEqual({ x: 3, z: 4 });
    });

    it('releases the occupant\'s previous cell when it moves onto a new free one', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      const granted = occupancy.tryMove(a, 5, 6);

      expect(granted).toBe(true);
      expect(occupancy.holderOf(3, 4)).toBeNull();
      expect(occupancy.holderOf(5, 6)).toEqual(a);
      expect(occupancy.cellOfOccupant(a)).toEqual({ x: 5, z: 6 });
    });

    it('fails to move onto a cell held by a DIFFERENT occupant, changing nothing', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      const b = emp(2);
      occupancy.tryMove(a, 3, 4);
      occupancy.tryMove(b, 1, 1);

      const granted = occupancy.tryMove(b, 3, 4);

      expect(granted).toBe(false);
      // The target cell's holder is unchanged.
      expect(occupancy.holderOf(3, 4)).toEqual(a);
      // The requester's own cell is unchanged too.
      expect(occupancy.cellOfOccupant(b)).toEqual({ x: 1, z: 1 });
    });

    it('re-entering its own already-held cell is a no-op grant, not a failure', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      const granted = occupancy.tryMove(a, 3, 4);

      expect(granted).toBe(true);
      expect(occupancy.holderOf(3, 4)).toEqual(a);
    });
  });

  describe('release', () => {
    it('releases the cell an occupant holds', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      occupancy.release(a);

      expect(occupancy.holderOf(3, 4)).toBeNull();
      expect(occupancy.cellOfOccupant(a)).toBeNull();
    });

    it('is a no-op for an occupant holding nothing — does not throw', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);

      expect(() => occupancy.release(a)).not.toThrow();
      expect(occupancy.cellOfOccupant(a)).toBeNull();
    });
  });

  describe('isFreeFor', () => {
    it('is true for an unheld cell', () => {
      const occupancy = new AgentOccupancy();
      expect(occupancy.isFreeFor(emp(1), 3, 4)).toBe(true);
    });

    it('is true when the cell is already held by the requester itself', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      expect(occupancy.isFreeFor(a, 3, 4)).toBe(true);
    });

    it('is false when the cell is held by a different occupant', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      const b = emp(2);
      occupancy.tryMove(a, 3, 4);

      expect(occupancy.isFreeFor(b, 3, 4)).toBe(false);
    });
  });

  describe('holderOf', () => {
    it('returns the occupant holding a cell', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      expect(occupancy.holderOf(3, 4)).toEqual(a);
    });

    it('returns null for an unheld cell', () => {
      const occupancy = new AgentOccupancy();
      expect(occupancy.holderOf(9, 9)).toBeNull();
    });
  });

  describe('cellOfOccupant', () => {
    it('returns the cell an occupant holds', () => {
      const occupancy = new AgentOccupancy();
      const a = emp(1);
      occupancy.tryMove(a, 3, 4);

      expect(occupancy.cellOfOccupant(a)).toEqual({ x: 3, z: 4 });
    });

    it('returns null for an occupant holding no cell', () => {
      const occupancy = new AgentOccupancy();
      expect(occupancy.cellOfOccupant(emp(1))).toBeNull();
    });
  });
});

describe('rebuildAgentOccupancy', () => {
  it('places every alive on-foot employee and every live vehicle onto the ledger, and holds no cell for a mounted or inside-building employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: onFoot } = hireEmployee(state.employees, 'driller', rng, 2, 3);

    const { vehicle: v1 } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5, 1);
    const { employee: mounted } = hireEmployee(state.employees, 'driver', rng, 5, 5);
    mounted.locomotion = { kind: 'mounted', vehicleId: v1.id };

    const { employee: inside } = hireEmployee(state.employees, 'driller', rng, 8, 8);
    inside.locomotion = { kind: 'inside', buildingId: 999 };

    const { vehicle: v2 } = purchaseVehicle(state.vehicles, 'drill_rig', 7, 7, 1);

    const occupancy = rebuildAgentOccupancy(state);

    expect(occupancy.cellOfOccupant(emp(onFoot.id))).toEqual({ x: onFoot.x, z: onFoot.z });
    expect(occupancy.cellOfOccupant(emp(mounted.id))).toBeNull();
    expect(occupancy.cellOfOccupant(emp(inside.id))).toBeNull();
    expect(occupancy.cellOfOccupant(vehicle(v1.id))).toEqual({ x: v1.x, z: v1.z });
    expect(occupancy.cellOfOccupant(vehicle(v2.id))).toEqual({ x: v2.x, z: v2.z });
  });

  it('excludes a dead employee from the ledger', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: dead } = hireEmployee(state.employees, 'driller', rng, 2, 3);
    killEmployee(state.employees, dead.id);

    const occupancy = rebuildAgentOccupancy(state);

    expect(occupancy.cellOfOccupant(emp(dead.id))).toBeNull();
    expect(occupancy.holderOf(2, 3)).toBeNull();
  });

  it('boundary: an empty roster and fleet builds an empty ledger with every queried cell free', () => {
    const state = createGame({ seed: SEED });

    const occupancy = rebuildAgentOccupancy(state);

    expect(occupancy.holderOf(0, 0)).toBeNull();
    expect(occupancy.isFreeFor(emp(1), 0, 0)).toBe(true);
  });
});

describe('reconcileAgentOccupancy', () => {
  it('releases a holder whose entity no longer exists, and leaves a live one untouched', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: gone } = hireEmployee(state.employees, 'driller', rng, 2, 3);
    const { employee: stillHere } = hireEmployee(state.employees, 'driller', rng, 9, 9);

    const occupancy = rebuildAgentOccupancy(state);
    expect(occupancy.cellOfOccupant(emp(gone.id))).toEqual({ x: 2, z: 3 });
    expect(occupancy.cellOfOccupant(emp(stillHere.id))).toEqual({ x: 9, z: 9 });

    // Removed outright — not merely killed — mirroring an entity that no
    // longer exists in state at all by the time reconciliation runs.
    state.employees.employees = state.employees.employees.filter(e => e.id !== gone.id);

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.holderOf(2, 3)).toBeNull();
    expect(occupancy.cellOfOccupant(emp(gone.id))).toBeNull();
    // The still-live occupant's own cell is untouched.
    expect(occupancy.cellOfOccupant(emp(stillHere.id))).toEqual({ x: 9, z: 9 });
  });

  it('releases a holder that was killed but stays present in state.employees.employees', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: killed } = hireEmployee(state.employees, 'driller', rng, 2, 3);
    const { employee: stillHere } = hireEmployee(state.employees, 'driller', rng, 9, 9);

    const occupancy = rebuildAgentOccupancy(state);
    expect(occupancy.cellOfOccupant(emp(killed.id))).toEqual({ x: 2, z: 3 });

    // Killed, not removed — `killEmployee` sets `alive: false` and leaves the
    // entity in the roster array (Employee.ts), unlike the outright-removal
    // case above.
    killEmployee(state.employees, killed.id);
    expect(state.employees.employees.some(e => e.id === killed.id)).toBe(true);

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.holderOf(2, 3)).toBeNull();
    expect(occupancy.cellOfOccupant(emp(killed.id))).toBeNull();
    // The still-live occupant's own cell is untouched.
    expect(occupancy.cellOfOccupant(emp(stillHere.id))).toEqual({ x: 9, z: 9 });
  });

  it('releases a vehicle holder that no longer exists in state.vehicles', () => {
    const state = createGame({ seed: SEED });
    const { vehicle: gone } = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 4, 1);

    const occupancy = rebuildAgentOccupancy(state);
    expect(occupancy.cellOfOccupant(vehicle(gone.id))).toEqual({ x: 4, z: 4 });

    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== gone.id);

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.holderOf(4, 4)).toBeNull();
  });

  it('boundary: reconciling an already up-to-date ledger changes nothing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: onFoot } = hireEmployee(state.employees, 'driller', rng, 6, 6);

    const occupancy = rebuildAgentOccupancy(state);

    expect(() => reconcileAgentOccupancy(state, occupancy)).not.toThrow();
    expect(occupancy.cellOfOccupant(emp(onFoot.id))).toEqual({ x: 6, z: 6 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Live upkeep vs. rebuild (#1869)
//
// The live map (state.agentOccupancy) is kept incrementally and rebuilt only
// lazily, so it must hold every agent a rebuild from the same state would hold.
// An employee who alights and stands still never "moves", so nothing registers
// them — a hauler then drives through their cell live, but waits for them after
// a save/load rebuilds the map.
// ═══════════════════════════════════════════════════════════════════════════════

/** Sorted "kind:id@x,z" pairs for every held cell — the (occupant, cell) set. */
function heldPairs(occupancy: AgentOccupancy): string[] {
  return occupancy.heldOccupants()
    .map(h => `${h.occupant.kind}:${h.occupant.id}@${h.x},${h.z}`)
    .sort();
}

/** A state with a solid nav grid, a hauler and a licensed driver standing beside it, live map already built. */
function stateWithDriverAndHauler(): { state: GameState; driverId: number; haulerId: number } {
  const state = createGame({ seed: SEED });
  const grid = new VoxelGrid(20, 20);
  for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++) for (let y = 0; y <= 4; y++) {
    grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
  }
  state.navGrid = NavGrid.buildNavGrid(grid, [], []);
  const rng = new Random(SEED);
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 10, 10, 1);
  const { employee } = hireEmployee(state.employees, 'driver', rng, 10, 11);
  state.agentOccupancy = rebuildAgentOccupancy(state);
  return { state, driverId: employee.id, haulerId: vehicle.id };
}

describe('live occupancy after alighting (#1869)', () => {
  it('an employee who alights and stands still holds their cell, matching rebuildAgentOccupancy', () => {
    const { state, driverId, haulerId } = stateWithDriverAndHauler();
    expect(board(state, haulerId, driverId).success).toBe(true);
    expect(alight(state, haulerId).success).toBe(true);
    const driver = state.employees.employees.find(e => e.id === driverId)!;
    expect(driver.locomotion.kind).toBe('on_foot');

    // No tick runs between alighting and the check: nothing "moved" them.
    const live = state.agentOccupancy!;
    const cell = { x: Math.round(driver.x), z: Math.round(driver.z) };
    expect(live.cellOfOccupant(emp(driverId))).toEqual(cell);
    expect(live.holderOf(cell.x, cell.z)).toEqual(emp(driverId));
    expect(heldPairs(live)).toEqual(heldPairs(rebuildAgentOccupancy(state)));
  });

  it('the vehicle keeps its own cell while its former driver stands beside it', () => {
    const { state, driverId, haulerId } = stateWithDriverAndHauler();
    board(state, haulerId, driverId);
    alight(state, haulerId);
    const vehicleCell = state.agentOccupancy!.cellOfOccupant(vehicle(haulerId));
    expect(vehicleCell).toEqual({ x: 10, z: 10 });
  });
});

describe('reconcileAgentOccupancy registers agents a rebuild would register (#1869)', () => {
  it('registers an on-foot employee the live map does not hold', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 6, 7);
    const occupancy = new AgentOccupancy();

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.cellOfOccupant(emp(employee.id))).toEqual({ x: 6, z: 7 });
    expect(heldPairs(occupancy)).toEqual(heldPairs(rebuildAgentOccupancy(state)));
  });

  it('registers a vehicle that never moved', () => {
    const state = createGame({ seed: SEED });
    const { vehicle: v } = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 5, 1);
    const occupancy = new AgentOccupancy();

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.cellOfOccupant(vehicle(v.id))).toEqual({ x: 4, z: 5 });
  });

  it('registers the employee at the rounded position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 6.4, 7.6);
    const occupancy = new AgentOccupancy();

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.cellOfOccupant(emp(employee.id))).toEqual({ x: 6, z: 8 });
  });

  it('does not register a mounted employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { vehicle: v } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5, 1);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 5, 5);
    employee.locomotion = { kind: 'mounted', vehicleId: v.id };
    const occupancy = new AgentOccupancy();

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.cellOfOccupant(emp(employee.id))).toBeNull();
    expect(occupancy.holderOf(5, 5)).toEqual(vehicle(v.id));
  });

  it('does not register a dead employee, and still releases a dead or removed holder', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee: dead } = hireEmployee(state.employees, 'driller', rng, 2, 3);
    const { vehicle: gone } = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 4, 1);
    const occupancy = rebuildAgentOccupancy(state);
    killEmployee(state.employees, dead.id);
    state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.id !== gone.id);

    reconcileAgentOccupancy(state, occupancy);

    expect(occupancy.cellOfOccupant(emp(dead.id))).toBeNull();
    expect(occupancy.cellOfOccupant(vehicle(gone.id))).toBeNull();
    expect(heldPairs(occupancy)).toEqual([]);
  });

  it('boundary: reconciling an up-to-date map leaves the held pairs identical to a rebuild', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    hireEmployee(state.employees, 'driller', rng, 6, 6);
    purchaseVehicle(state.vehicles, 'drill_rig', 7, 7, 1);
    const occupancy = rebuildAgentOccupancy(state);
    const before = heldPairs(occupancy);

    reconcileAgentOccupancy(state, occupancy);

    expect(heldPairs(occupancy)).toEqual(before);
  });
});
