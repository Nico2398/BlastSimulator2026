// BlastSimulator2026 — Unit tests: queued-order reachability (#1306)
//
// A queued action's ghost is red when none of the actors able to perform THAT
// action can reach its target, or no such actor exists. These tests exercise
// the module's own surface (orderActorKey, buildOrderReachability,
// judgeQueuedOrders, classifyQueuedOrders, classifyNewOrder,
// refreshOrderReachability); the behaviour through tickEmployees is covered in
// EmployeeDispatch.test.ts and the update paths in
// tests/integration/ghost-reachability.integration.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Count every flood fill the nav layer performs, whichever entry point the
// implementation picks — the cost contract is about fills, not actors.
const fills = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../src/core/nav/NavGridReachability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/nav/NavGridReachability.js')>();
  const wrap = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => { fills.count++; return fn(...args); };
  return {
    ...actual,
    computeReachableSet: wrap(actual.computeReachableSet),
    computeClimbReachableSet: wrap(actual.computeClimbReachableSet),
    computeClimbReachableSetFromSources: wrap(actual.computeClimbReachableSetFromSources),
  };
});

import { createGame, type GameState, type PendingAction, type ActionType } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
import {
  orderActorKey,
  buildOrderReachability,
  judgeQueuedOrders,
  classifyQueuedOrders,
  classifyNewOrder,
  refreshOrderReachability,
} from '../../../src/core/engine/OrderReachability.js';

const WIDTH = 24;
const HEIGHT = 12;
const WALL_X = 10;
const IN_A = { x: 3, z: 5 };
const IN_A_TARGET = { x: 6, z: 6 };
const IN_B = { x: 16, z: 5 };
const IN_B_TARGET = { x: 18, z: 8 };

function makeGrid(wall = true): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < HEIGHT; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < WIDTH; x++) {
      const blocked = wall && x === WALL_X;
      row.push({ type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(WIDTH, HEIGHT, cells);
}

function makeState(wall = true): GameState {
  const state = createGame({ seed: 42 });
  state.navGrid = makeGrid(wall);
  return state;
}

function hire(state: GameState, at: { x: number; z: number }, skills: string[] = []) {
  const { employee } = hireEmployee(state.employees, 'driver', new Random(42 + state.employees.nextId), at.x, at.z);
  for (const skill of skills) assignSkill(state.employees, employee.id, skill as never, 1);
  return employee;
}

function queue(
  state: GameState,
  type: ActionType,
  at: { x: number; z: number },
  extra: Partial<PendingAction> = {},
): number {
  const id = state.nextPendingActionId++;
  dispatchPendingAction(state, {
    id, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: at.x, targetZ: at.z, targetY: 0, payload: {}, targetEmployeeId: null, ...extra,
  }, { skipQualificationCheck: true });
  return id;
}

const ghostOf = (state: GameState, id: number) => state.ghostPreviews.find(g => g.id === id)!;

beforeEach(() => { fills.count = 0; });

describe('orderActorKey (#1306)', () => {
  const base = { requiredSkill: null, requiredVehicleRole: null, targetEmployeeId: null } as const;

  it('is identical for identical skill / vehicle role / target employee', () => {
    expect(orderActorKey({ ...base, requiredSkill: 'blasting' })).toBe(orderActorKey({ ...base, requiredSkill: 'blasting' }));
    expect(orderActorKey(base)).toBe(orderActorKey({ ...base }));
  });

  it('differs when the required skill differs', () => {
    expect(orderActorKey({ ...base, requiredSkill: 'blasting' })).not.toBe(orderActorKey({ ...base, requiredSkill: 'geology' }));
    expect(orderActorKey({ ...base, requiredSkill: 'blasting' })).not.toBe(orderActorKey(base));
  });

  it('differs when the required vehicle role differs', () => {
    expect(orderActorKey({ ...base, requiredVehicleRole: 'rock_digger' })).not.toBe(orderActorKey({ ...base, requiredVehicleRole: 'drill_rig' }));
    expect(orderActorKey({ ...base, requiredVehicleRole: 'rock_digger' })).not.toBe(orderActorKey(base));
  });

  it('differs per named employee, and from an untargeted action with the same skill and role', () => {
    const a = orderActorKey({ ...base, targetEmployeeId: 1 });
    const b = orderActorKey({ ...base, targetEmployeeId: 2 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(orderActorKey(base));
  });

  it('is a function of the three fields only: a skill-different action with the same role gets a different pool', () => {
    expect(orderActorKey({ ...base, requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig' }))
      .not.toBe(orderActorKey({ ...base, requiredSkill: null, requiredVehicleRole: 'drill_rig' }));
  });
});

describe('buildOrderReachability (#1306)', () => {
  it('hasActor is false for an on-foot pool when the roster is empty, true once someone is hired', () => {
    const state = makeState();
    const id = queue(state, 'survey', IN_A_TARGET);
    const action = state.pendingActions.find(a => a.id === id)!;
    const key = orderActorKey(action);
    expect(buildOrderReachability(state, [action]).hasActor(key)).toBe(false);
    hire(state, IN_A);
    expect(buildOrderReachability(state, [action]).hasActor(key)).toBe(true);
  });

  it('canReach follows the wall: an employee in region A reaches A cells, not B cells', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_A_TARGET);
    const action = state.pendingActions.find(a => a.id === id)!;
    const reach = buildOrderReachability(state, [action]);
    const key = orderActorKey(action);
    expect(reach.canReach(key, IN_A_TARGET.x, IN_A_TARGET.z)).toBe(true);
    expect(reach.canReach(key, IN_B_TARGET.x, IN_B_TARGET.z)).toBe(false);
  });

  it('canReach is the union over actors: employees in both regions reach both', () => {
    const state = makeState();
    hire(state, IN_A);
    hire(state, IN_B);
    const id = queue(state, 'survey', IN_A_TARGET);
    const action = state.pendingActions.find(a => a.id === id)!;
    const reach = buildOrderReachability(state, [action]);
    const key = orderActorKey(action);
    expect(reach.canReach(key, IN_A_TARGET.x, IN_A_TARGET.z)).toBe(true);
    expect(reach.canReach(key, IN_B_TARGET.x, IN_B_TARGET.z)).toBe(true);
  });

  it('pools are independent: a skill held only in region B does not extend the skill-free pool', () => {
    const state = makeState();
    hire(state, IN_A);
    hire(state, IN_B, ['geology']);
    const freeId = queue(state, 'survey', IN_A_TARGET);
    const gatedId = queue(state, 'survey', IN_A_TARGET, { requiredSkill: 'geology' });
    const free = state.pendingActions.find(a => a.id === freeId)!;
    const gated = state.pendingActions.find(a => a.id === gatedId)!;
    const reach = buildOrderReachability(state, [free, gated]);
    expect(reach.canReach(orderActorKey(free), IN_A_TARGET.x, IN_A_TARGET.z)).toBe(true);
    expect(reach.canReach(orderActorKey(gated), IN_A_TARGET.x, IN_A_TARGET.z)).toBe(false);
    expect(reach.hasActor(orderActorKey(gated))).toBe(true);
  });

  it('a dead employee is not an actor', () => {
    const state = makeState();
    const emp = hire(state, IN_A);
    const id = queue(state, 'survey', IN_A_TARGET);
    const action = state.pendingActions.find(a => a.id === id)!;
    killEmployee(state.employees, emp.id);
    expect(buildOrderReachability(state, [action]).hasActor(orderActorKey(action))).toBe(false);
  });

  it('an empty action list builds without error', () => {
    const state = makeState();
    expect(() => buildOrderReachability(state, [])).not.toThrow();
  });
});

describe('judgeQueuedOrders (#1306)', () => {
  it('returns a verdict for every queued action id', () => {
    const state = makeState();
    hire(state, IN_A);
    const a = queue(state, 'survey', IN_A_TARGET);
    const b = queue(state, 'survey', IN_B_TARGET);
    const verdicts = judgeQueuedOrders(state);
    expect(verdicts.get(a)).toBe('reachable');
    expect(verdicts.get(b)).toBe('unreachable');
  });

  it('is empty when nothing is queued', () => {
    expect(judgeQueuedOrders(makeState()).size).toBe(0);
  });

  it('does not mutate ghosts, actions or the revision counter', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    const rev = state.ghostPreviewsRevision;
    const before = JSON.stringify([state.ghostPreviews, state.pendingActions]);
    judgeQueuedOrders(state);
    expect(JSON.stringify([state.ghostPreviews, state.pendingActions])).toBe(before);
    expect(state.ghostPreviewsRevision).toBe(rev);
    expect(ghostOf(state, id).unreachable).toBe(true); // born red at dispatch, untouched here
  });

  it('judges a ramp by its first not-done layer for every queued layer', () => {
    const state = makeState();
    hire(state, IN_A, [ROLE_LICENCE_REQUIRED.rock_digger, 'driving.excavator']);
    purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z);
    const ids = [IN_A_TARGET, IN_B_TARGET, IN_B_TARGET].map((at, index) => queue(state, 'dig_ramp_segment', at, {
      requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger',
      payload: { rampId: 1, segmentIndex: index, cells: [], region: null },
    }));
    state.plannedRamps.push({
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'south', length: 3, targetDepth: 6 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: ids.map((actionId, index) => ({ index, actionId, cells: [], region: null, done: false })),
    });
    const verdicts = judgeQueuedOrders(state);
    for (const id of ids) expect(verdicts.get(id)).toBe('reachable');
  });
});

describe('classifyQueuedOrders (#1306)', () => {
  it('reports skill-gated on-foot actions nobody on the roster qualifies for', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'drill_hole', IN_A_TARGET, { requiredSkill: 'blasting' });
    const { unqualifiedIds } = classifyQueuedOrders(state);
    expect(unqualifiedIds.has(id)).toBe(true);
    expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('no_qualified_employee');
  });

  it('never reports a vehicle-gated action as unqualified, but stamps its blockedReason', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'level_ground', IN_A_TARGET, { requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });
    const { unqualifiedIds } = classifyQueuedOrders(state);
    expect(unqualifiedIds.has(id)).toBe(false);
    expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('no_vehicle_in_fleet');
  });

  it('stamps target_unreachable on a stranded order whose actors exist, and clears it once reachable', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    classifyQueuedOrders(state);
    expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('target_unreachable');
    state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    classifyQueuedOrders(state);
    expect(state.pendingActions.find(a => a.id === id)!.blockedReason ?? null).toBeNull();
  });

  it('leaves a reachable, staffed order unblocked and out of unqualifiedIds', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_A_TARGET);
    const { unqualifiedIds } = classifyQueuedOrders(state);
    expect(unqualifiedIds.size).toBe(0);
    expect(state.pendingActions.find(a => a.id === id)!.blockedReason ?? null).toBeNull();
  });
});

describe('classifyNewOrder (#1306)', () => {
  it('colours the ghost of one action without waiting for a tick', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    delete ghostOf(state, id).unreachable;
    classifyNewOrder(state, id);
    expect(ghostOf(state, id).unreachable).toBe(true);
  });

  it('bumps ghostPreviewsRevision only when the colour actually changes', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    const rev = state.ghostPreviewsRevision;
    classifyNewOrder(state, id);
    expect(state.ghostPreviewsRevision).toBe(rev);
    state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    classifyNewOrder(state, id);
    expect(ghostOf(state, id).unreachable).toBe(false);
    expect(state.ghostPreviewsRevision).toBeGreaterThan(rev);
  });

  it('ignores an unknown action id without throwing', () => {
    expect(() => classifyNewOrder(makeState(), 9999)).not.toThrow();
  });
});

describe('refreshOrderReachability (#1306)', () => {
  it('is a no-op on a state with no queued actions', () => {
    const state = makeState();
    const rev = state.ghostPreviewsRevision;
    expect(() => refreshOrderReachability(state)).not.toThrow();
    expect(state.ghostPreviewsRevision).toBe(rev);
  });

  it('refreshes every ghost, in both directions', () => {
    const state = makeState();
    const emp = hire(state, IN_A);
    const near = queue(state, 'survey', IN_A_TARGET);
    const far = queue(state, 'survey', IN_B_TARGET);
    refreshOrderReachability(state);
    expect(ghostOf(state, near).unreachable).toBe(false);
    expect(ghostOf(state, far).unreachable).toBe(true);
    emp.x = IN_B.x;
    emp.z = IN_B.z;
    refreshOrderReachability(state);
    expect(ghostOf(state, near).unreachable).toBe(true);
    expect(ghostOf(state, far).unreachable).toBe(false);
  });
});

describe('every action type is judged by the red rule (#1306)', () => {
  // Compile-time exhaustiveness: adding an ActionType without listing it here
  // fails typecheck, so the rule cannot silently skip a new action type.
  const ALL_ACTION_TYPES: Record<ActionType, true> = {
    drill_hole: true, charge_hole: true, dig_ramp_segment: true, level_ground: true,
    set_sequence: true, place_building: true, demolish_building: true, survey: true,
    fragment_debris: true, haul_debris: true, rest: true, general_work: true,
  };

  it.each(Object.keys(ALL_ACTION_TYPES) as ActionType[])('%s: red with no actor, blue with an actor that reaches it, red when stranded', (type) => {
    const state = makeState();
    const id = queue(state, type, IN_A_TARGET);
    refreshOrderReachability(state);
    expect(ghostOf(state, id).unreachable).toBe(true);

    const emp = hire(state, IN_A);
    refreshOrderReachability(state);
    expect(ghostOf(state, id).unreachable).toBe(false);

    emp.x = IN_B.x;
    emp.z = IN_B.z;
    refreshOrderReachability(state);
    expect(ghostOf(state, id).unreachable).toBe(true);
  });
});

describe('cost does not grow with the number of actors (#1306)', () => {
  function stage(actorCount: number): GameState {
    const state = makeState(false);
    for (let i = 0; i < actorCount; i++) {
      const at = { x: 1 + (i % 8), z: 1 + ((i / 8) | 0) % 10 };
      hire(state, at, [ROLE_LICENCE_REQUIRED.rock_digger, ROLE_LICENCE_REQUIRED.debris_hauler, 'driving.excavator', 'blasting']);
      purchaseVehicle(state.vehicles, i % 2 === 0 ? 'rock_digger' : 'debris_hauler', at.x + 1, at.z);
    }
    queue(state, 'survey', IN_A_TARGET);
    queue(state, 'drill_hole', IN_A_TARGET, { requiredSkill: 'blasting' });
    queue(state, 'level_ground', IN_B_TARGET, { requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });
    queue(state, 'haul_debris', IN_B_TARGET, { requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 1 } });
    queue(state, 'rest', IN_A_TARGET, { targetEmployeeId: 1 });
    // A second order sharing an existing pool must not add a fill of its own.
    queue(state, 'survey', IN_B_TARGET);
    return state;
  }

  it('performs the same number of flood fills with 2 actors as with 40', () => {
    const small = stage(2);
    const large = stage(40);

    fills.count = 0;
    judgeQueuedOrders(small);
    const smallFills = fills.count;

    fills.count = 0;
    judgeQueuedOrders(large);
    const largeFills = fills.count;

    expect(smallFills).toBeGreaterThan(0);
    expect(largeFills).toBe(smallFills);
  });

  it('refreshOrderReachability stays flat in fills as actors grow', () => {
    const small = stage(2);
    const large = stage(40);
    fills.count = 0;
    refreshOrderReachability(small);
    const smallFills = fills.count;
    fills.count = 0;
    refreshOrderReachability(large);
    expect(fills.count).toBe(smallFills);
  });

  it('adding a queued action that shares an actor pool adds no flood fill', () => {
    const state = stage(10);
    fills.count = 0;
    judgeQueuedOrders(state);
    const before = fills.count;
    queue(state, 'general_work', IN_A_TARGET); // same pool as the on-foot surveys
    queue(state, 'survey', { x: 2, z: 2 });
    fills.count = 0;
    judgeQueuedOrders(state);
    expect(fills.count).toBe(before);
  });
});
