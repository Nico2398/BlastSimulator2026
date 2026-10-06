// BlastSimulator2026 — Benchmark: queued-order reachability (#1306)
//
// Per-tick cost of judging every queued order must be bounded by the grid
// size and the number of distinct actor pools — never by grid size x number
// of actors. Wall-clock, with a warmup run, like benchmarks.test.ts.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
import { refreshOrderReachability } from '../../../src/core/engine/OrderReachability.js';

const DEFAULT_SIZE = 100;

function makeState(actorCount: number, restOrders = 0, SIZE = DEFAULT_SIZE): GameState {
  const state = createGame({ seed: 42 });
  const cells: NavCell[][] = [];
  for (let z = 0; z < SIZE; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < SIZE; x++) {
      const wall = x === 50 && z % 10 !== 0; // one doorway in ten rows
      row.push({ type: wall ? 'blocked' : 'walkable', moveCost: wall ? Infinity : 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  state.navGrid = new NavGrid(SIZE, SIZE, cells);
  for (let i = 0; i < actorCount; i++) {
    const x = (i * 7) % SIZE;
    const z = (i * 13) % SIZE;
    const { employee } = hireEmployee(state.employees, 'driver', new Random(i + 1), x, z);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    if (i % 3 === 0) purchaseVehicle(state.vehicles, 'rock_digger', x, z);
  }
  const queueOrder = (i: number, extra: object): void => {
    dispatchPendingAction(state, {
      id: state.nextPendingActionId++, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
      targetX: (i * 17) % SIZE, targetZ: (i * 29) % SIZE, targetY: 0, payload: {}, targetEmployeeId: null, ...extra,
    }, { skipQualificationCheck: true });
  };
  for (let i = 0; i < 100; i++) {
    if (i % 3 === 0) queueOrder(i, { type: 'drill_hole', requiredSkill: 'blasting' });
    else if (i % 3 === 1) queueOrder(i, { type: 'level_ground', requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });
    else queueOrder(i, {});
  }
  // ForceShiftRest queues one rest order per tired employee, each aimed at that employee.
  for (const emp of state.employees.employees.slice(0, restOrders)) {
    queueOrder(emp.id, { type: 'rest', targetEmployeeId: emp.id, targetX: (emp.x + 50) % SIZE, targetZ: emp.z });
  }
  return state;
}

function medianMs(state: GameState, runs = 7): number {
  refreshOrderReachability(state); // warmup
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    refreshOrderReachability(state);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[(runs / 2) | 0]!;
}

describe('refreshOrderReachability benchmark (#1306)', () => {
  it('judges 100 queued orders on a 100x100 grid with 200 actors well inside a tick budget', () => {
    const ms = medianMs(makeState(200));
    expect(ms).toBeLessThan(25);
  });

  it('cost with 400 actors stays within 3x of the cost with 4 actors (no grid x actors growth)', () => {
    const few = medianMs(makeState(4));
    const many = medianMs(makeState(400));
    // Floor the denominator: a sub-millisecond baseline would make the ratio noise.
    expect(many).toBeLessThan(Math.max(few, 2) * 3);
  });

  it('cost with 50 targeted rest orders stays within 3x of 2 rest orders (no grid x employees growth)', () => {
    const few = medianMs(makeState(60, 2));
    const many = medianMs(makeState(60, 50));
    expect(many).toBeLessThan(Math.max(few, 2) * 3);
  });

  it('judges 50 targeted rest orders on top of 100 pooled ones well inside a tick budget', () => {
    expect(medianMs(makeState(200, 50))).toBeLessThan(25);
  });
});

describe('refreshOrderReachability steady-state cache benchmark (#1427)', () => {
  const BIG = 160; // treranium_depths-sized grid

  function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[(sorted.length / 2) | 0]!;
  }

  /** Cost of the first call on a fresh state: every fill and labelling is cold. */
  function coldMs(): number {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const state = makeState(200, 50, BIG);
      const t0 = performance.now();
      refreshOrderReachability(state);
      samples.push(performance.now() - t0);
    }
    return median(samples);
  }

  it('an unchanged world re-judges 160x160 with many orders and actors in under 5 ms', () => {
    const state = makeState(200, 50, BIG);
    expect(medianMs(state, 15)).toBeLessThan(5);
  });

  it('an unchanged world costs under 20% of the cold call', () => {
    const cold = coldMs();
    const steady = medianMs(makeState(200, 50, BIG), 15);
    expect(steady).toBeLessThan(cold * 0.2);
  });
});
