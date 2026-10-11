// BlastSimulator2026 — Unit tests: queued-order reachability (#1306)
//
// A queued action's ghost is red when none of the actors able to perform THAT
// action can reach its target, or no such actor exists. These tests exercise
// the module's own surface (orderActorKey, buildOrderReachability,
// judgeQueuedOrders, classifyQueuedOrders, classifyNewOrder,
// refreshOrderReachability); the behaviour through tickEmployees is covered in
// EmployeeDispatch.test.ts and the update paths in
// tests/integration/ghost-reachability.integration.test.ts.

import { setFreightRoom, setFreightRoomExact } from "../../helpers/freightWarehouse.js";
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Count every flood fill the nav layer performs, whichever entry point the
// implementation picks — the cost contract is about fills, not actors.
const fills = vi.hoisted(() => ({ count: 0, labels: 0 }));
vi.mock('../../../src/core/nav/NavGridReachability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/nav/NavGridReachability.js')>();
  const wrap = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => { fills.count++; return fn(...args); };
  return {
    ...actual,
    computeReachableSet: wrap(actual.computeReachableSet),
    computeClimbReachableSet: wrap(actual.computeClimbReachableSet),
    computeClimbReachableSetFromSources: wrap(actual.computeClimbReachableSetFromSources),
    // Whole-grid component labelling is counted apart from fills (#1427).
    computeClimbComponents: (...args: Parameters<typeof actual.computeClimbComponents>) => {
      fills.labels++;
      return actual.computeClimbComponents(...args);
    },
  };
});

import { createGame, type GameState, type PendingAction, type ActionType } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, fireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
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

beforeEach(() => { fills.count = 0; fills.labels = 0; });

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

  it('ignores a vehicle tier no candidate is licensed to drive (#1524)', () => {
    const state = makeState();
    const driver = hire(state, IN_A, [ROLE_LICENCE_REQUIRED.rock_digger, 'driving.excavator']); // level 1 licence
    purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z, 1);
    const tier3 = purchaseVehicle(state.vehicles, 'rock_digger', IN_B.x, IN_B.z, 3).vehicle;
    tier3.occupantIds = [driver.id]; // would make the far-side vehicle usable were its tier not filtered out
    const id = queue(state, 'level_ground', IN_B_TARGET, { requiredSkill: 'driving.excavator', requiredVehicleRole: 'rock_digger' });
    expect(judgeQueuedOrders(state).get(id)).toBe('unreachable');
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

  describe('availability reasons for a vehicle-gated drill_hole order (#1386)', () => {
    const DRILL = { requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig' } as const;
    const licence = ROLE_LICENCE_REQUIRED.drill_rig;
    const reasonOf = (state: GameState, id: number) => state.pendingActions.find(a => a.id === id)!.blockedReason;

    it('stamps no_dual_qualified_employee when skill and licence sit on different employees, without a modal', () => {
      const state = makeState();
      hire(state, IN_A, ['blasting']);
      hire(state, IN_A, [licence]);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      const { unqualifiedIds } = classifyQueuedOrders(state);
      expect(reasonOf(state, id)).toBe('no_dual_qualified_employee');
      expect(unqualifiedIds.has(id)).toBe(false);
    });

    it('keeps no_qualified_employee when licensed drivers exist but nobody holds the skill', () => {
      const state = makeState();
      hire(state, IN_A, [licence]);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      classifyQueuedOrders(state);
      expect(reasonOf(state, id)).toBe('no_qualified_employee');
    });

    it('keeps no_licensed_driver when a skill holder exists but nobody is licensed', () => {
      const state = makeState();
      hire(state, IN_A, ['blasting']);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      classifyQueuedOrders(state);
      expect(reasonOf(state, id)).toBe('no_licensed_driver');
    });

    it('keeps no_vehicle_in_fleet when no drill_rig is owned, even with a split skill and licence', () => {
      const state = makeState();
      hire(state, IN_A, ['blasting']);
      hire(state, IN_A, [licence]);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      classifyQueuedOrders(state);
      expect(reasonOf(state, id)).toBe('no_vehicle_in_fleet');
    });

    it('is no_qualified_employee, not the dual reason, when the only skill holder is ineligible (injured)', () => {
      const state = makeState();
      const holder = hire(state, IN_A, ['blasting']);
      hire(state, IN_A, [licence]);
      holder.injured = true;
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      classifyQueuedOrders(state);
      expect(reasonOf(state, id)).toBe('no_qualified_employee');
    });

    it('leaves the order unblocked when one eligible employee holds both', () => {
      const state = makeState();
      hire(state, IN_A, ['blasting', licence]);
      purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const id = queue(state, 'drill_hole', IN_A_TARGET, DRILL);
      classifyQueuedOrders(state);
      expect(reasonOf(state, id) ?? null).toBeNull();
    });
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
    place_building: true, demolish_building: true, survey: true,
    fragment_debris: true, haul_debris: true, rest: true, general_work: true,
    repair_vehicle: true,
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

  // The whole cost is one labelling per clearance a changed grid needs (#1603):
  // no flood fill at all, however many actors or orders there are.
  it('labels as often with 2 actors as with 40, and never fills', () => {
    const small = stage(2);
    const large = stage(40);
    fills.labels = 0; fills.count = 0;

    small.navGrid!.bumpRevision(); // cold cache: count what a changed grid costs
    judgeQueuedOrders(small);
    const smallLabels = fills.labels;

    fills.labels = 0;
    large.navGrid!.bumpRevision();
    judgeQueuedOrders(large);

    expect(smallLabels).toBe(2); // employee and vehicle clearance
    expect(fills.labels).toBe(smallLabels);
    expect(fills.count).toBe(0);
  });

  it('refreshOrderReachability stays flat in labellings as actors grow', () => {
    const small = stage(2);
    const large = stage(40);
    fills.labels = 0; fills.count = 0;
    small.navGrid!.bumpRevision();
    refreshOrderReachability(small);
    const smallLabels = fills.labels;
    fills.labels = 0;
    large.navGrid!.bumpRevision();
    refreshOrderReachability(large);
    expect(fills.labels).toBe(smallLabels);
    expect(fills.count).toBe(0);
  });

  it('adding queued actions on a known grid costs no labelling', () => {
    const state = stage(10);
    judgeQueuedOrders(state);
    fills.labels = 0;
    queue(state, 'general_work', IN_A_TARGET); // same pool as the on-foot surveys
    queue(state, 'survey', { x: 2, z: 2 });
    judgeQueuedOrders(state);
    expect(fills.labels).toBe(0);
    expect(fills.count).toBe(0);
  });
});

describe('haul orders carry freight-warehouse gating reasons (#1369)', () => {
  function fragment(id: number, mass: number): FragmentData {
    return {
      id, position: { x: IN_A_TARGET.x, y: 0, z: IN_A_TARGET.z }, volume: 0.3, mass, rockId: 'cruite',
      oreDensities: { blingite: 0.5 }, initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1, origin: { x: IN_A_TARGET.x, y: 0, z: IN_A_TARGET.z },
    };
  }

  /** A haul order with a licensed driver and a hauler both reachable, so only storage can block it. */
  function stageHaul(mass = 400): { state: GameState; id: number } {
    const state = makeState();
    hire(state, IN_A, [ROLE_LICENCE_REQUIRED.debris_hauler]);
    purchaseVehicle(state.vehicles, 'debris_hauler', IN_A.x + 1, IN_A.z);
    addBlastFragments(state.logistics, [fragment(1, mass)]);
    const id = queue(state, 'haul_debris', IN_A_TARGET, { requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 1 } });
    return { state, id };
  }
  const reasonOf = (state: GameState, id: number) => state.pendingActions.find(a => a.id === id)!.blockedReason ?? null;
  const addWarehouse = (state: GameState) => {
    const r = placeBuilding(state.buildings, 'freight_warehouse', 20, 8, 64, 64);
    if (!r.success) throw new Error(r.error);
  };

  it('stamps no_freight_warehouse on a haul order when no warehouse exists', () => {
    const { state, id } = stageHaul();
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBe('no_freight_warehouse');
  });

  it('clears the reason once a warehouse is built with room', () => {
    const { state, id } = stageHaul();
    classifyQueuedOrders(state);
    addWarehouse(state);
    setFreightRoom(state, 5000);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBeNull();
  });

  it('stamps storage_full when a warehouse exists but the fragment exceeds the room', () => {
    const { state, id } = stageHaul(400);
    addWarehouse(state);
    setFreightRoomExact(state, 200);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBe('storage_full');
  });

  it('clears storage_full when room frees up', () => {
    const { state, id } = stageHaul(400);
    addWarehouse(state);
    setFreightRoomExact(state, 200);
    classifyQueuedOrders(state);
    state.logistics.fragments = state.logistics.fragments.filter(f => f.state !== 'stored'); // filler gone
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBeNull();
  });

  it('no_vehicle_in_fleet wins over the warehouse reason', () => {
    const state = makeState();
    hire(state, IN_A, [ROLE_LICENCE_REQUIRED.debris_hauler]);
    addBlastFragments(state.logistics, [fragment(1, 400)]);
    const id = queue(state, 'haul_debris', IN_A_TARGET, { requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 1 } });
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBe('no_vehicle_in_fleet');
  });

  it('no_licensed_driver wins over the warehouse reason', () => {
    const state = makeState();
    // A driller holds no truck licence (the 'driver' role is granted one at hire).
    hireEmployee(state.employees, 'driller', new Random(42), IN_A.x, IN_A.z);
    purchaseVehicle(state.vehicles, 'debris_hauler', IN_A.x + 1, IN_A.z);
    addBlastFragments(state.logistics, [fragment(1, 400)]);
    const id = queue(state, 'haul_debris', IN_A_TARGET, { requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 1 } });
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBe('no_licensed_driver');
  });

  it('classifyNewOrder stamps the warehouse reason on a fresh haul order', () => {
    const { state, id } = stageHaul();
    state.pendingActions.find(a => a.id === id)!.blockedReason = null;
    classifyNewOrder(state, id);
    expect(reasonOf(state, id)).toBe('no_freight_warehouse');
  });

  it('never stamps warehouse reasons on fragment_debris', () => {
    const state = makeState();
    hire(state, IN_A, [ROLE_LICENCE_REQUIRED.rock_fragmenter]);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', IN_A.x + 1, IN_A.z);
    addBlastFragments(state.logistics, [fragment(1, 400)]);
    const id = queue(state, 'fragment_debris', IN_A_TARGET, { requiredVehicleRole: 'rock_fragmenter', payload: { fragmentId: 1 } });
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBeNull();
  });

  it('never stamps warehouse reasons on non-haul orders', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_A_TARGET);
    classifyQueuedOrders(state);
    expect(reasonOf(state, id)).toBeNull();
  });
});

describe('classifyQueuedOrders — a temporarily unavailable holder is not nobody (#1380)', () => {
  /** A queued survey and the roster's only geology holder, put in `condition`. */
  function setup(condition: (e: ReturnType<typeof hire>) => void) {
    const state = makeState();
    const holder = hire(state, IN_A, ['geology']);
    const id = queue(state, 'survey', IN_A_TARGET, { requiredSkill: 'geology' });
    condition(holder);
    return { state, id };
  }

  it('does not report the order when the only holder is mid-course', () => {
    const { state, id } = setup(e => { e.trainingState = { buildingId: 1, skill: 'blasting', ticksRemaining: 10, fee: 100 }; });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(false);
  });

  it('does not report the order when the only holder is walking to a course', () => {
    const { state, id } = setup(e => { e.pendingTrainingState = { buildingId: 1, skill: 'blasting', ticksRemaining: 10, fee: 100 }; });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(false);
  });

  it('does not report the order when the only holder is injured', () => {
    const { state, id } = setup(e => { e.injured = true; });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(false);
  });

  it('still stamps blockedReason no_qualified_employee while the holder is unavailable', () => {
    for (const condition of [
      (e: ReturnType<typeof hire>) => { e.injured = true; },
      (e: ReturnType<typeof hire>) => { e.trainingState = { buildingId: 1, skill: 'blasting', ticksRemaining: 10, fee: 100 }; },
    ]) {
      const { state, id } = setup(condition);
      classifyQueuedOrders(state);
      expect(state.pendingActions.find(a => a.id === id)!.blockedReason).toBe('no_qualified_employee');
    }
  });

  it('reports the order when the only holder is dead', () => {
    const { state, id } = setup(e => { e.alive = false; });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(true);
  });

  it('reports the order when nobody on the roster holds the skill at all', () => {
    const state = makeState();
    hire(state, IN_A, ['blasting']);
    const id = queue(state, 'survey', IN_A_TARGET, { requiredSkill: 'geology' });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(true);
  });

  it('reports the order again once the injured holder is gone for good', () => {
    const { state, id } = setup(e => { e.injured = true; });
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(false);
    state.employees.employees[0]!.alive = false;
    expect(classifyQueuedOrders(state).unqualifiedIds.has(id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Caching (#1427): fills and labellings are reused until their inputs change.
// ─────────────────────────────────────────────────────────────────────────────

describe('reachability cache (#1427)', () => {
  /** Two pools: skill-free (everyone) and geology (one holder). Employees start in region A. */
  function stage() {
    const state = makeState();
    const plain = hire(state, IN_A);
    const geo = hire(state, { x: 4, z: 7 }, ['geology']);
    const free = queue(state, 'survey', IN_A_TARGET);
    const gated = queue(state, 'survey', IN_A_TARGET, { requiredSkill: 'geology' });
    return { state, plain, geo, free, gated };
  }
  const verdicts = (state: GameState) => Object.fromEntries(judgeQueuedOrders(state));

  it('a second call with nothing changed performs no fills and no labellings', () => {
    const { state } = stage();
    queue(state, 'rest', IN_A_TARGET, { targetEmployeeId: state.employees.employees[0]!.id });
    judgeQueuedOrders(state);
    expect(fills.labels).toBeGreaterThan(0);
    fills.count = 0; fills.labels = 0;
    judgeQueuedOrders(state);
    refreshOrderReachability(state);
    classifyQueuedOrders(state);
    expect(fills.count).toBe(0);
    expect(fills.labels).toBe(0);
  });

  it('buildOrderReachability reuses the labelling across calls', () => {
    const { state } = stage();
    const actions = state.pendingActions.filter(a => a.status === 'queued');
    buildOrderReachability(state, actions);
    fills.labels = 0;
    buildOrderReachability(state, actions);
    expect(fills.labels).toBe(0);
  });

  it('ticks of unrelated state (ghost churn, new orders on known keys) do not relabel', () => {
    const { state } = stage();
    judgeQueuedOrders(state);
    fills.labels = 0;
    queue(state, 'survey', IN_B_TARGET);
    judgeQueuedOrders(state);
    expect(fills.labels).toBe(0);
  });

  it('moving actors costs no fill and no labelling, and the verdicts follow them', () => {
    const { state, plain, geo, free, gated } = stage();
    const far = queue(state, 'survey', IN_B_TARGET);
    judgeQueuedOrders(state);
    fills.labels = 0;
    plain.x = IN_B.x; plain.z = IN_B.z; // holds no skill: only the skill-free pool contains it
    let v = verdicts(state);
    expect(v[free]).toBe('reachable'); // geology holder is still in A, so A stays covered
    expect(v[gated]).toBe('reachable');
    expect(v[far]).toBe('reachable');
    geo.x = IN_B.x; geo.z = IN_B.z;
    v = verdicts(state);
    expect(v[free]).toBe('unreachable');
    expect(v[gated]).toBe('unreachable');
    expect(fills.labels).toBe(0);
    expect(fills.count).toBe(0);
  });

  it('a verdict follows a lone actor that moves across the wall', () => {
    const state = makeState();
    const emp = hire(state, IN_A);
    const id = queue(state, 'survey', IN_A_TARGET);
    expect(verdicts(state)[id]).toBe('reachable');
    emp.x = IN_B.x; emp.z = IN_B.z;
    expect(verdicts(state)[id]).toBe('unreachable');
    emp.x = IN_A.x; emp.z = IN_A.z;
    expect(verdicts(state)[id]).toBe('reachable');
  });

  it('hiring a new candidate is seen on the next call, and so is firing it', () => {
    const { state } = stage();
    const far = queue(state, 'survey', IN_B_TARGET);
    expect(verdicts(state)[far]).toBe('unreachable');
    const extra = hire(state, IN_B);
    expect(verdicts(state)[far]).toBe('reachable');
    expect(fireEmployee(state.employees, extra.id).success).toBe(true);
    expect(verdicts(state)[far]).toBe('unreachable');
  });

  it('killing the only candidate of a key is seen on the next call', () => {
    const { state, geo, gated } = stage();
    expect(verdicts(state)[gated]).toBe('reachable');
    killEmployee(state.employees, geo.id);
    expect(verdicts(state)[gated]).toBe('unreachable');
    expect(buildOrderReachability(state, state.pendingActions.filter(a => a.id === gated)).hasActor(
      orderActorKey(state.pendingActions.find(a => a.id === gated)!),
    )).toBe(false);
  });

  it('a nav-grid cell edit invalidates the cached labelling', () => {
    const { state, free } = stage();
    const far = queue(state, 'survey', IN_B_TARGET);
    expect(verdicts(state)[far]).toBe('unreachable');
    fills.labels = 0;
    state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    const v = verdicts(state);
    expect(fills.labels).toBe(1);
    expect(v[free]).toBe('reachable');
    expect(v[far]).toBe('reachable');
  });

  it('a nav edit opening a doorway flips an unreachable verdict', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    expect(verdicts(state)[id]).toBe('unreachable');
    state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    expect(verdicts(state)[id]).toBe('reachable');
  });

  it('an edit that bypasses setCellAt but calls bumpRevision invalidates too', () => {
    const state = makeState();
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    expect(verdicts(state)[id]).toBe('unreachable');
    state.navGrid!.cellAt(WALL_X, 5)!.type = 'walkable';
    state.navGrid!.cellAt(WALL_X, 5)!.moveCost = 1.0;
    state.navGrid!.bumpRevision();
    expect(verdicts(state)[id]).toBe('reachable');
  });

  it('fragment and vehicle occupancy writes do not invalidate', () => {
    const { state } = stage();
    judgeQueuedOrders(state);
    fills.count = 0; fills.labels = 0;
    state.navGrid!.addFragmentOccupant(8, 8);
    state.navGrid!.removeFragmentOccupant(8, 8);
    state.navGrid!.cellAt(7, 7)!.vehicleOccupied = true;
    judgeQueuedOrders(state);
    expect(fills.count).toBe(0);
    expect(fills.labels).toBe(0);
  });

  it('replacing the nav grid with an identical-looking one invalidates', () => {
    const { state } = stage();
    judgeQueuedOrders(state);
    fills.labels = 0;
    state.navGrid = makeGrid(true);
    judgeQueuedOrders(state);
    expect(fills.labels).toBe(1);
  });

  it('replacing the nav grid changes verdicts to match the new grid', () => {
    const state = makeState(true);
    hire(state, IN_A);
    const id = queue(state, 'survey', IN_B_TARGET);
    expect(verdicts(state)[id]).toBe('unreachable');
    state.navGrid = makeGrid(false);
    expect(verdicts(state)[id]).toBe('reachable');
  });

  it('clearing the nav grid yields no verdicts, and restoring it recomputes', () => {
    const { state } = stage();
    judgeQueuedOrders(state);
    const grid = state.navGrid;
    state.navGrid = null;
    expect(judgeQueuedOrders(state).size).toBe(0);
    state.navGrid = grid;
    expect(judgeQueuedOrders(state).size).toBe(2);
  });

  it('separate game states never share cached pools', () => {
    const a = makeState();
    const b = makeState();
    hire(a, IN_A);
    hire(b, IN_B);
    const ida = queue(a, 'survey', IN_A_TARGET);
    const idb = queue(b, 'survey', IN_A_TARGET);
    expect(verdicts(a)[ida]).toBe('reachable');
    expect(verdicts(b)[idb]).toBe('unreachable');
  });

  describe('foot component labelling', () => {
    function stageRest() {
      const state = makeState();
      const a = hire(state, IN_A);
      const b = hire(state, IN_B);
      const ra = queue(state, 'rest', IN_B_TARGET, { targetEmployeeId: a.id });
      const rb = queue(state, 'rest', IN_B_TARGET, { targetEmployeeId: b.id });
      return { state, a, b, ra, rb };
    }

    it('labels once for many targeted orders, and never fills for them', () => {
      const { state } = stageRest();
      judgeQueuedOrders(state);
      expect(fills.labels).toBe(1);
      expect(fills.count).toBe(0);
    });

    it('is reused on the next call', () => {
      const { state } = stageRest();
      judgeQueuedOrders(state);
      fills.labels = 0;
      judgeQueuedOrders(state);
      expect(fills.labels).toBe(0);
    });

    it('survives an actor move (position is read live) and the verdict follows', () => {
      const { state, a, ra } = stageRest();
      expect(verdicts(state)[ra]).toBe('unreachable');
      fills.labels = 0;
      a.x = IN_B.x; a.z = IN_B.z;
      expect(verdicts(state)[ra]).toBe('reachable');
      expect(fills.labels).toBe(0);
    });

    it('is recomputed after a nav edit', () => {
      const { state, ra } = stageRest();
      expect(verdicts(state)[ra]).toBe('unreachable');
      fills.labels = 0;
      state.navGrid!.setCellAt(WALL_X, 5, { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
      expect(verdicts(state)[ra]).toBe('reachable');
      expect(fills.labels).toBe(1);
    });

    it('is recomputed when the nav grid is replaced', () => {
      const { state } = stageRest();
      judgeQueuedOrders(state);
      fills.labels = 0;
      state.navGrid = makeGrid(true);
      judgeQueuedOrders(state);
      expect(fills.labels).toBe(1);
    });
  });

  describe('vehicle-gated pools', () => {
    function stageVehicle() {
      const state = makeState();
      const driver = hire(state, IN_A, [ROLE_LICENCE_REQUIRED.rock_digger]);
      const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x + 1, IN_A.z);
      const id = queue(state, 'level_ground', IN_A_TARGET, { requiredVehicleRole: 'rock_digger' });
      return { state, driver, vehicle, id };
    }

    it('labels the vehicle clearance once and reuses it while the grid stands', () => {
      const { state } = stageVehicle();
      judgeQueuedOrders(state);
      expect(fills.labels).toBe(2); // employee and vehicle clearance
      fills.labels = 0;
      judgeQueuedOrders(state);
      expect(fills.labels).toBe(0);
      expect(fills.count).toBe(0);
    });

    it('moving the vehicle to another cell updates the verdict without relabelling', () => {
      const { state, vehicle, id } = stageVehicle();
      expect(verdicts(state)[id]).toBe('reachable');
      fills.labels = 0;
      vehicle.x = IN_B.x; vehicle.z = IN_B.z; // parked across the wall, nobody driving it
      expect(verdicts(state)[id]).toBe('unreachable');
      expect(fills.labels).toBe(0);
    });

    it('a driver change on the vehicle is seen on the next call', () => {
      const { state, driver, vehicle, id } = stageVehicle();
      vehicle.x = IN_B.x; vehicle.z = IN_B.z;
      expect(verdicts(state)[id]).toBe('unreachable');
      // Driver boards: the vehicle is usable wherever it is, and sits in B.
      vehicle.occupantIds = [driver.id];
      driver.x = IN_B.x; driver.z = IN_B.z;
      expect(verdicts(state)[id]).toBe('unreachable'); // target is in A, vehicle and driver are in B
      vehicle.x = IN_A.x + 1; vehicle.z = IN_A.z;
      driver.x = IN_A.x + 1; driver.z = IN_A.z;
      expect(verdicts(state)[id]).toBe('reachable');
    });

    it('purchasing a further vehicle is seen without a stale cache', () => {
      const { state, vehicle, id } = stageVehicle();
      vehicle.x = IN_B.x; vehicle.z = IN_B.z;
      expect(verdicts(state)[id]).toBe('unreachable');
      purchaseVehicle(state.vehicles, 'rock_digger', IN_A.x, IN_A.z + 1);
      expect(verdicts(state)[id]).toBe('reachable');
    });
  });

});

describe('cached verdicts equal fresh verdicts over random mutation sequences (#1427)', () => {
  const walkable = (): NavCell => ({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
  const blockedCell = (): NavCell => ({ type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false });

  function cloneGrid(g: NavGrid): NavGrid {
    return new NavGrid(g.width, g.height, g.cells.map(r => r.map(c => ({ ...c }))), g.maxSurfaceY, g.originX, g.originZ, g.maxClimbY);
  }

  /** Oracle: a shallow twin has its own cache (new WeakMap key) and a fresh grid object. */
  function fresh(state: GameState): Record<number, string> {
    const twin = { ...state, navGrid: cloneGrid(state.navGrid!) } as GameState;
    return Object.fromEntries(judgeQueuedOrders(twin));
  }

  const SKILLS = [null, 'geology', 'blasting'] as const;
  const ROLES = [null, 'rock_digger'] as const;

  it.each([1, 2, 3, 4, 5, 6])('seed %i: judgements agree after each mutation', (seed) => {
    const rng = new Random(seed);
    const pickInt = (n: number): number => Math.min(n - 1, Math.floor(rng.next() * n));
    const state = makeState(true);
    for (let i = 0; i < 4; i++) {
      hire(state, { x: pickInt(WIDTH), z: pickInt(HEIGHT) }, [ROLE_LICENCE_REQUIRED.rock_digger, 'geology']);
    }
    purchaseVehicle(state.vehicles, 'rock_digger', pickInt(WIDTH), pickInt(HEIGHT));

    for (let step = 0; step < 60; step++) {
      const emps = state.employees.employees;
      switch (pickInt(8)) {
        case 0: { // move an actor to a fresh cell
          const e = emps[pickInt(Math.max(1, emps.length))];
          if (e) { e.x = pickInt(WIDTH); e.z = pickInt(HEIGHT); }
          break;
        }
        case 1: { // jitter within a cell
          const e = emps[pickInt(Math.max(1, emps.length))];
          if (e) { e.x += (rng.next() - 0.5) * 0.4; e.z += (rng.next() - 0.5) * 0.4; }
          break;
        }
        case 2: // hire
          hire(state, { x: pickInt(WIDTH), z: pickInt(HEIGHT) }, rng.next() < 0.5 ? ['geology'] : [ROLE_LICENCE_REQUIRED.rock_digger]);
          break;
        case 3: { // fire or kill
          const e = emps[pickInt(Math.max(1, emps.length))];
          if (e) { if (rng.next() < 0.5) fireEmployee(state.employees, e.id); else killEmployee(state.employees, e.id); }
          break;
        }
        case 4: // nav edit
          state.navGrid!.setCellAt(pickInt(WIDTH), pickInt(HEIGHT), rng.next() < 0.5 ? blockedCell() : walkable());
          break;
        case 5: { // queue an order
          const skill = SKILLS[pickInt(SKILLS.length)]!;
          const role = ROLES[pickInt(ROLES.length)]!;
          queue(state, 'survey', { x: pickInt(WIDTH), z: pickInt(HEIGHT) }, { requiredSkill: skill as never, requiredVehicleRole: role });
          break;
        }
        case 6: { // drop an order, or buy / move a vehicle
          if (rng.next() < 0.5 && state.pendingActions.length > 0) {
            state.pendingActions.splice(pickInt(state.pendingActions.length), 1);
          } else if (state.vehicles.vehicles.length === 0 || rng.next() < 0.3) {
            purchaseVehicle(state.vehicles, 'rock_digger', pickInt(WIDTH), pickInt(HEIGHT));
          } else {
            const v = state.vehicles.vehicles[pickInt(state.vehicles.vehicles.length)]!;
            v.x = pickInt(WIDTH); v.z = pickInt(HEIGHT);
          }
          break;
        }
        default: // rest order aimed at one employee
          if (emps.length > 0) {
            queue(state, 'rest', { x: pickInt(WIDTH), z: pickInt(HEIGHT) }, { targetEmployeeId: emps[pickInt(emps.length)]!.id });
          }
      }
      expect(Object.fromEntries(judgeQueuedOrders(state)), `seed ${seed} step ${step}`).toEqual(fresh(state));
    }
  });
});
