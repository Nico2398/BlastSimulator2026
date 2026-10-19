// BlastSimulator2026 — Unit tests: buried drill orders carry a blocked reason (#1937)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
import { classifyQueuedOrders } from '../../../src/core/engine/OrderReachability.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function grid(): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < 30; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 30; x++) row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false });
    cells.push(row);
  }
  return new NavGrid(30, 30, cells);
}

function frag(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, shapeSeed: id, origin: { x, y: 0, z },
  };
}

/** Fully staffed drill site with one queued drill order on hole H1 at (15, 15). */
function setup(progression: boolean): { state: GameState; id: number } {
  const state = createGame({ seed: 42 });
  state.navGrid = grid();
  if (progression) state.grade = createGradeState();
  const { employee } = hireEmployee(state.employees, 'driller', new Random(42), 3, 3);
  assignSkill(state.employees, employee.id, 'blasting', 1);
  assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
  purchaseVehicle(state.vehicles, 'drill_rig', 3, 3);
  state.plannedDrillHoles.push({ id: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089 });
  const id = state.nextPendingActionId++;
  dispatchPendingAction(state, {
    id, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
    targetX: 15, targetZ: 15, targetY: 0,
    payload: { holeId: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089, durationTicks: 10 }, targetEmployeeId: null,
  }, { skipQualificationCheck: true });
  return { state, id };
}

const reasonOf = (state: GameState, id: number) => state.pendingActions.find(a => a.id === id)!.blockedReason;

describe('buried_under_rubble blocked reason (#1937)', () => {
  it('is stamped on a drill order whose hole lies under on-ground rubble', () => {
    const { state, id } = setup(true);
    addBlastFragments(state.logistics, [frag(1, 15, 15)]);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBe('buried_under_rubble');
  });

  it('is cleared once the rubble is gone', () => {
    const { state, id } = setup(true);
    addBlastFragments(state.logistics, [frag(1, 15, 15)]);
    classifyQueuedOrders(state);
    state.logistics.fragments.splice(0, 1);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).not.toBe('buried_under_rubble');
  });

  it('is absent when the rubble lies elsewhere', () => {
    const { state, id } = setup(true);
    addBlastFragments(state.logistics, [frag(1, 25, 25)]);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).not.toBe('buried_under_rubble');
  });

  it('is never stamped on a non-progression site', () => {
    const { state, id } = setup(false);
    addBlastFragments(state.logistics, [frag(1, 15, 15)]);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).not.toBe('buried_under_rubble');
  });
});
